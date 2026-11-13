import type { WeightSaveResponse } from '@pt/contracts';
import { addDays, applyLatestWeight, targetsOnly } from '@pt/core';
import type { Deps, WeightState, WeightWrite } from '../deps';

/**
 * Stores or deletes a weight entry and, when the user's most recent weight changed, evaluates the profile
 * again with it (spec 003 AC10–AC13). Returns null when the user has no profile yet.
 */
export async function writeWeight(
  deps: Deps,
  userId: string,
  write: Omit<WeightWrite, 'recentFrom'>,
  today: string,
): Promise<WeightSaveResponse | null> {
  let targetsChange: WeightSaveResponse['targetsChange'] = null;

  const decide = ({ profile, targets, latest, recent }: WeightState) => {
    const change = applyLatestWeight(
      profile,
      targets && targetsOnly(targets),
      latest,
      today,
      recent,
    );
    if (!change) return null;
    targetsChange = change.targetsChange;
    return {
      weightKg: change.weightKg,
      goal: change.goal,
      safetyFlags: change.safetyFlags,
      ...(change.targetsChange ? { newTargets: change.targetsChange.current } : {}),
    };
  };

  // The last 7 days: the low-BMI recovery rule reads their average (AC12).
  const recentFrom = addDays(today, -6);
  const result = await deps.store.writeWeight(userId, { ...write, recentFrom }, decide, deps.now());
  if (!result) return null;
  return { entry: result.entry, targetsChange };
}
