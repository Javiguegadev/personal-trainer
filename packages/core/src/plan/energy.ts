import type { MealItem, PlannedMealItem, SafetyFlag } from '@pt/contracts';
import { dailyTotals, showsFoodNumbers } from '../food/nutrition';
import { pendingPlannedItems } from './status';

export type PlanEnergyItem = Pick<PlannedMealItem, 'id' | 'localDate' | 'nutrients'>;
export type PlanEnergyLog = Pick<MealItem, 'localDate' | 'nutrients'> & {
  plannedItemId?: MealItem['plannedItemId'];
};

/**
 * "Plan: 2.150 / 2.200 kcal" (spec 013 AC2, AC4): the energy of a planned day, rounded. On today the
 * logged items and the pending planned ones count, each once (a planned item logged with a bigger
 * portion counts as logged). Null on a past day (the week view shows only the logs there), on a day
 * without a plan, and with `ed_soft_stop` (AC3). `targetKcal` is null without numeric targets
 * (pregnancy), and then the line has no target. Nothing here judges the plan (no colour, no gap).
 */
export function plannedDayEnergy(input: {
  date: string;
  today: string;
  planned: readonly PlanEnergyItem[];
  logged: readonly PlanEnergyLog[];
  flags: readonly SafetyFlag[];
  targetKcal: number | null;
}): { kcal: number; targetKcal: number | null } | null {
  if (input.date < input.today || !showsFoodNumbers(input.flags)) return null;
  const planned = input.planned.filter((p) => p.localDate === input.date);
  if (planned.length === 0) return null;
  const logged = input.logged.filter((i) => i.localDate === input.date);
  const pending = pendingPlannedItems(planned, logged);
  return {
    kcal: Math.round(dailyTotals([...logged, ...pending]).kcal),
    targetKcal: input.targetKcal === null ? null : Math.round(input.targetKcal),
  };
}
