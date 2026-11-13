import type { Profile, SafetyFlag, Targets, TargetsChange } from '@pt/contracts';
import { checkClientDates, evaluateStoredProfile, sameTargets } from '../profile/evaluate';
import { checkWeightDate } from './form';
import type { WeightPoint } from './trend';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Request-level checks of a weight write that need the server clock (spec 003 AC7, AC20). Returns the
 * field errors, or null.
 */
export function checkWeightWrite(
  write: { localDate: string; today: string; recordedAt?: string },
  now: Date,
): Record<string, string> | null {
  const invalid = checkClientDates({ today: write.today }, now);
  if (invalid) return invalid;
  if (write.recordedAt === undefined) return null;
  const dateError = checkWeightDate(write.localDate, write.today);
  if (dateError) return { localDate: dateError };
  // A device clock far ahead would win every later conflict.
  if (Date.parse(write.recordedAt) > now.getTime() + DAY_MS) return { recordedAt: 'in_future' };
  return null;
}

/** What the profile becomes when the user's most recent weight changes (spec 003 AC10). */
export interface LatestWeightChange {
  weightKg: number;
  /** The goal applied after the safety rules. */
  goal: Profile['goal'];
  safetyFlags: SafetyFlag[];
  /** Null when the targets are the same numbers: no new targets row, and no notice (AC11). */
  targetsChange: TargetsChange | null;
}

/**
 * The stored profile evaluated again with the user's most recent weight entry (spec 003 AC10–AC13).
 * Returns null when nothing changes: no entries left, the same weight, or a profile that cannot be
 * evaluated yet (an account from before spec 002 that has not filled in the form again).
 */
export function applyLatestWeight(
  profile: Profile,
  targets: Targets | null,
  latest: WeightPoint | null,
  today: string,
): LatestWeightChange | null {
  if (!latest || latest.weightKg === profile.weightKg) return null;
  const { jobActivity } = profile;
  if (jobActivity === null) return null;
  const evaluation = evaluateStoredProfile({ ...profile, jobActivity }, latest.weightKg, today);
  if (evaluation.kind === 'blocked') return null;
  return {
    weightKg: latest.weightKg,
    goal: evaluation.safety.appliedGoal,
    safetyFlags: evaluation.flags,
    targetsChange: sameTargets(targets, evaluation.targets)
      ? null
      : { previous: targets, current: evaluation.targets, safety: evaluation.safety },
  };
}
