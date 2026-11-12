import type { SafetyEvaluation, Targets } from '@pt/contracts';

/**
 * Safety notices shown on the summary and in Settings (spec 001 AC14, AC18–AC21; spec 002 AC10, AC11). Each maps to the i18n key
 * `safety.<notice>`. Ordered from most to least important.
 */
export type ProfileNotice =
  | 'pregnancy'
  | 'ed_soft_stop'
  | 'low_bmi'
  | 'low_target_bmi'
  | 'teen_limited'
  | 'calorie_floor'
  | 'high_training_load'
  | 'activity_ceiling'
  | 'medical_condition';

const ORDER: readonly ProfileNotice[] = [
  'pregnancy',
  'ed_soft_stop',
  'low_bmi',
  'low_target_bmi',
  'teen_limited',
  'calorie_floor',
  'high_training_load',
  'activity_ceiling',
  'medical_condition',
];

export function profileNotices(
  safety: Pick<SafetyEvaluation, 'flags'>,
  targets: Pick<Targets, 'clampedReason'> | null,
): ProfileNotice[] {
  const notices = new Set<ProfileNotice>();
  for (const flag of safety.flags) {
    // A reported condition and free-text injuries get the same "see a professional" notice (AC21).
    if (flag === 'injury' || flag === 'medical_condition') notices.add('medical_condition');
    else notices.add(flag);
  }
  if (targets?.clampedReason === 'calorie_floor') notices.add('calorie_floor');
  if (targets?.clampedReason === 'activity_ceiling') notices.add('activity_ceiling');
  return ORDER.filter((notice) => notices.has(notice));
}
