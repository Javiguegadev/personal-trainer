import type { SafetyEvaluation, Targets } from '@pt/contracts';

/**
 * Safety notices shown on the summary and in Settings (AC14, AC18–AC21). Each maps to the i18n key
 * `safety.<notice>`. Ordered from most to least important.
 */
export type ProfileNotice =
  | 'pregnancy'
  | 'ed_soft_stop'
  | 'low_bmi'
  | 'low_target_bmi'
  | 'teen_limited'
  | 'calorie_floor'
  | 'medical_condition';

const ORDER: readonly ProfileNotice[] = [
  'pregnancy',
  'ed_soft_stop',
  'low_bmi',
  'low_target_bmi',
  'teen_limited',
  'calorie_floor',
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
  return ORDER.filter((notice) => notices.has(notice));
}
