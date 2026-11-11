import type {
  MeResponse,
  ProfileInput,
  SafetyEvaluation,
  SafetyFlag,
  Targets,
  TargetsBreakdown,
} from '@pt/contracts';
import { computeTargets, evaluateProfileSafety, isPlausibleClientDate } from '@pt/core';
import type { Deps, MeRecord } from '../deps';

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
 * nothing the client or the AI sends can bypass @pt/core.
 */
export function evaluateProfileInput(
  input: ProfileInput,
  previousFlags: readonly SafetyFlag[],
  now: Date,
): ProfileEvaluation {
  const invalid = checkClientDates(input, now);
  if (invalid) return { kind: 'invalid', fields: invalid };

  const safety = evaluateProfileSafety(
    {
      birthDate: input.birthDate,
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      targetWeightKg: input.targetWeightKg,
      goal: input.goal,
      healthFlags: input.healthFlags,
      injuries: input.injuries,
      previousFlags,
    },
    input.today,
  );
  if (safety.status === 'blocked') return { kind: 'blocked' };

  const computed = safety.targetsAllowed ? computeTargets(input, safety, input.today) : null;
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

/** Persists an evaluated profile (AC10, AC16). Returns the fresh `/me` view. */
export async function saveProfile(
  deps: Deps,
  userId: string,
  input: ProfileInput,
  evaluation: Extract<ProfileEvaluation, { kind: 'ok' }>,
): Promise<MeResponse> {
  await deps.store.saveProfile(
    userId,
    {
      profile: {
        sex: input.sex,
        birthDate: input.birthDate,
        heightCm: input.heightCm,
        weightKg: input.weightKg,
        targetWeightKg: input.targetWeightKg,
        activityLevel: input.activityLevel,
        requestedGoal: input.goal,
        goal: evaluation.safety.appliedGoal,
        safetyFlags: evaluation.flags,
        injuries: input.injuries?.trim() || null,
        units: input.units,
        locale: input.locale,
      },
      dietaryPrefs: input.dietaryPrefs,
      targets: evaluation.targets,
    },
    deps.now(),
  );
  return toMeResponse(userId, await deps.store.getMe(userId));
}

export function toMeResponse(userId: string, record: MeRecord): MeResponse {
  return {
    userId,
    consent: { healthData: record.consentVersion !== null, version: record.consentVersion },
    onboardingCompleted: record.profile?.onboardingCompletedAt != null,
    profile: record.profile,
    dietaryPrefs: record.dietaryPrefs,
    targets: record.targets,
  };
}
