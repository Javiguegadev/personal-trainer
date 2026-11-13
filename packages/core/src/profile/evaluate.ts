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
export function evaluateProfileInput(
  input: ProfileInput,
  previousFlags: readonly SafetyFlag[],
  now: Date,
): ProfileEvaluation {
  const invalid = checkClientDates(input, now);
  if (invalid) return { kind: 'invalid', fields: invalid };
  return evaluate(input, previousFlags, input.today);
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
>;

function evaluate(
  input: EvaluatedFields,
  previousFlags: readonly SafetyFlag[],
  today: string,
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
 */
export function evaluateStoredProfile(
  profile: Profile & { jobActivity: JobActivity },
  weightKg: number,
  today: string,
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
    },
    profile.safetyFlags,
    today,
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
