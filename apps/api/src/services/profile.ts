import type { MeResponse, ProfileInput } from '@pt/contracts';
import type { ProfileEvaluation } from '@pt/core';
import type { Deps, MeRecord } from '../deps';

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
        jobActivity: input.jobActivity,
        plannedActivities: input.plannedActivities,
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
