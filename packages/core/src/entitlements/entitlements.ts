import {
  FEEDBACK_LIMITS,
  LABEL_SCAN_LIMITS,
  MEAL_DRAFT_LIMITS,
  WORKOUT_DRAFT_LIMITS,
  type CappedFeature,
  type PlanId,
} from '@pt/contracts';

/**
 * What each plan allows (spec 014 AC14): the daily cap of every AI feature, per user and UTC day. Only
 * `beta` until E6 adds the paid plans; its caps are the ones each feature's spec set.
 */
export const PLANS: Record<PlanId, Record<CappedFeature, number>> = {
  beta: {
    label_scan: LABEL_SCAN_LIMITS.perDay,
    meal_photo: MEAL_DRAFT_LIMITS.photosPerDay,
    meal_text: MEAL_DRAFT_LIMITS.textsPerDay,
    daily_feedback: FEEDBACK_LIMITS.aiPerDay,
    workout_text: WORKOUT_DRAFT_LIMITS.textsPerDay,
  },
};

/** Whether the plan allows one more use of `feature` after `usedToday` uses this UTC day. */
export function canUse(
  plan: PlanId,
  feature: CappedFeature,
  usedToday: number,
): { allowed: boolean; remaining: number; cap: number } {
  const cap = PLANS[plan][feature];
  const remaining = Math.max(0, cap - usedToday);
  return { allowed: remaining > 0, remaining, cap };
}
