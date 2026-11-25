import type { CappedFeature, PlanId } from '@pt/contracts';
import { canUse } from '@pt/core';
import type { Deps } from '../deps';
import { utcDayStart } from '../images';

/** Every user is on the beta plan until E6 adds `entitlements` (spec 014 AC14). */
const planOf = (_userId: string): PlanId => 'beta';

/**
 * Whether the user may call an AI feature once more today (UTC day): the plan's cap against the
 * `ai_usage` rows of the day, failed calls included (each feature's spec).
 */
export async function withinDailyCap(
  deps: Pick<Deps, 'store' | 'now'>,
  userId: string,
  feature: CappedFeature,
): Promise<boolean> {
  const used = await deps.store.countAiUsage(userId, feature, utcDayStart(deps.now()));
  return canUse(planOf(userId), feature, used).allowed;
}
