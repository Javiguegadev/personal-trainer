import type {
  JobActivity,
  Profile,
  ProfileInput,
  ReportedHealthFlag,
  SafetyEvaluation,
  SafetyFlag,
  Targets,
  TargetsBreakdown,
} from '@pt/contracts';
import { buildContextSnapshot } from '../context/snapshot';
import { isPlausibleClientDate } from '../dates';
import { trainingMinutesPerWeek } from '../nutrition/activity';
import { computeTargets } from '../nutrition/targets';
import { evaluateProfileSafety } from '../safety/profile';
import { withWeightOnDay } from '../weight/apply-day';
import { weightTrend, type WeightPoint } from '../weight/trend';

export type ProfileEvaluation =
  | { kind: 'invalid'; fields: Record<string, string> }
  | { kind: 'blocked' }
  | {
      kind: 'ok';
      safety: SafetyEvaluation;
      targets: Targets | null;
      breakdown: TargetsBreakdown | null;
      /** What gets stored in `profiles.safety_flags`. */
      flags: SafetyFlag[];
    };

/** Request-level checks that Zod cannot do alone (they need the server clock). */
export function checkClientDates(
  input: { today: string; birthDate?: string },
  now: Date,
): Record<string, string> | null {
  if (!isPlausibleClientDate(input.today, now.toISOString())) return { today: 'implausible' };
  if (input.birthDate !== undefined && input.birthDate > input.today) {
    return { birthDate: 'in_future' };
  }
  return null;
}

/**
 * Safety rules + targets for a confirmed profile (AC13–AC22). Runs on both the preview and the save, so
 * nothing the client sends can bypass these rules. `now` is the server clock.
 */
/** The stored weight log, for the low-BMI recovery rule (spec 003 AC12). */
export interface WeightHistory {
  /** The weight stored on the profile now (the latest entry), or null without a profile. */
  storedWeightKg: number | null;
  /** The user's entries of at least the last 7 days. */
  entries: readonly WeightPoint[];
}

export function evaluateProfileInput(
  input: ProfileInput,
  previousFlags: readonly SafetyFlag[],
  now: Date,
  history?: WeightHistory,
  /** The stored calibration of the weekly reviews (spec 014): a profile save keeps it. */
  energyCalibrationKcal = 0,
): ProfileEvaluation {
  const invalid = checkClientDates(input, now);
  if (invalid) return { kind: 'invalid', fields: invalid };
  // Saving another weight also stores it as today's entry (spec 003 AC13): judge the log as it will be.
  const entries =
    history && history.storedWeightKg !== input.weightKg
      ? withWeightOnDay(history.entries, input.today, input.weightKg)
      : (history?.entries ?? []);
  return evaluate(
    input,
    previousFlags,
    input.today,
    weightTrend(entries, input.today).averageKg,
    energyCalibrationKcal,
  );
}

type EvaluatedFields = Pick<
  ProfileInput,
  | 'sex'
  | 'birthDate'
  | 'heightCm'
  | 'weightKg'
  | 'targetWeightKg'
  | 'goal'
  | 'healthFlags'
  | 'injuries'
  | 'jobActivity'
  | 'plannedActivities'
  | 'trainingFocus'
>;

function evaluate(
  input: EvaluatedFields,
  previousFlags: readonly SafetyFlag[],
  today: string,
  weightAverageKg: number | null,
  energyCalibrationKcal: number,
): Exclude<ProfileEvaluation, { kind: 'invalid' }> {
  const safety = evaluateProfileSafety(
    {
      birthDate: input.birthDate,
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      targetWeightKg: input.targetWeightKg,
      goal: input.goal,
      healthFlags: input.healthFlags,
      injuries: input.injuries,
      trainingMinutesPerWeek: trainingMinutesPerWeek(input.plannedActivities),
      previousFlags,
      weightAverageKg,
    },
    today,
  );
  if (safety.status === 'blocked') return { kind: 'blocked' };

  const snapshot = buildContextSnapshot(
    {
      profile: input,
      safetyFlags: safety.flags,
      jobActivity: input.jobActivity,
      plannedActivities: input.plannedActivities,
      trainingFocus: input.trainingFocus,
      energyCalibrationKcal,
    },
    today,
  );
  const computed = safety.targetsAllowed ? computeTargets(snapshot, safety) : null;
  const flags = [...safety.flags];
  if (computed?.targets.clampedReason === 'calorie_floor') flags.push('calorie_floor');

  return {
    kind: 'ok',
    safety,
    targets: computed?.targets ?? null,
    breakdown: computed?.breakdown ?? null,
    flags,
  };
}

const REPORTED_FLAGS: readonly SafetyFlag[] = ['pregnancy', 'ed_soft_stop', 'medical_condition'];

/**
 * The stored profile evaluated again with a new weight (spec 003 AC10, AC12): the same safety rules and
 * targets as a profile save, with the goal the user asked for and the health facts they reported.
 * `entries` is the weight log after the write (at least the last 7 days).
 */
export function evaluateStoredProfile(
  profile: Profile & { jobActivity: JobActivity },
  weightKg: number,
  today: string,
  entries: readonly WeightPoint[] = [],
): Exclude<ProfileEvaluation, { kind: 'invalid' }> {
  return evaluate(
    {
      sex: profile.sex,
      birthDate: profile.birthDate,
      heightCm: profile.heightCm,
      weightKg,
      targetWeightKg: profile.targetWeightKg,
      goal: profile.requestedGoal,
      healthFlags: profile.safetyFlags.filter((flag): flag is ReportedHealthFlag =>
        REPORTED_FLAGS.includes(flag),
      ),
      injuries: profile.injuries,
      jobActivity: profile.jobActivity,
      plannedActivities: profile.plannedActivities,
      // Never null after the backfill of migration 0004 (spec 004 AC13); if it were, the form's default.
      trainingFocus: profile.trainingFocus ?? 'general_fitness',
    },
    profile.safetyFlags,
    today,
    weightTrend(entries, today).averageKg,
    profile.energyCalibrationKcal ?? 0,
  );
}

/** Only the targets, from a stored row that also carries its validity dates. */
export function targetsOnly(row: Targets): Targets {
  return {
    kcal: row.kcal,
    proteinG: row.proteinG,
    carbsG: row.carbsG,
    fatG: row.fatG,
    fiberG: row.fiberG,
    formulaVersion: row.formulaVersion,
    clampedReason: row.clampedReason,
  };
}

/** Whether two sets of targets are the same numbers (spec 003 AC10). Null = no numeric targets. */
export function sameTargets(a: Targets | null, b: Targets | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.kcal === b.kcal &&
    a.proteinG === b.proteinG &&
    a.carbsG === b.carbsG &&
    a.fatG === b.fatG &&
    a.fiberG === b.fiberG &&
    a.formulaVersion === b.formulaVersion &&
    a.clampedReason === b.clampedReason
  );
}
