import { saveItemVariables } from '@pt/api-client';
import type { Food, PlannedMealItem, PlannedWorkout, Portion } from '@pt/contracts';
import { EMPTY_PLAN_CHANGES, logPlannedItems, stampChanges, type PlanChanges } from '@pt/core';
import { useSaveMealItem, useSavePlanChanges } from '@/lib/api';
import { offerFoodUndo } from '@/lib/foodUndo';
import { newId } from '@/lib/id';
import { clearPlanUndo, offerPlanUndo, type PlanUndo } from '@/lib/planUndo';
import { useI18n } from './useI18n';
import { useToday } from './useToday';

/**
 * Every write of the weekly planner (spec 013): optimistic and queued offline by `@pt/api-client`, so the
 * screens call these and close without waiting (AC22). Changes come from `@pt/core`.
 */
export function usePlanActions() {
  const { locale } = useI18n();
  const today = useToday();
  const savePlan = useSavePlanChanges();
  const saveItem = useSaveMealItem();
  const now = () => new Date().toISOString();

  const actions = {
    save: (changes: PlanChanges) => savePlan(changes, locale),

    /** A change with 5 seconds to undo it (AC6, AC11, AC12, AC20). */
    saveWithUndo(changes: PlanChanges, undo: PlanChanges, message: string) {
      savePlan(changes, locale);
      offerPlanUndo({ message, undo });
    },

    /** "Deshacer": the undo stamped now, so it wins over the change it undoes. */
    undo(offer: PlanUndo) {
      clearPlanUndo();
      savePlan(stampChanges(offer.undo, now()), locale);
    },

    /** "Quitar del plan" (AC6, AC9): removed at once, with an undo. */
    removeItems(rows: readonly PlannedMealItem[], message: string) {
      const recordedAt = now();
      actions.saveWithUndo(
        {
          ...EMPTY_PLAN_CHANGES,
          mealItems: { upserts: [], deletes: rows.map((r) => ({ id: r.id, recordedAt })) },
        },
        { ...EMPTY_PLAN_CHANGES, mealItems: { upserts: [...rows], deletes: [] } },
        message,
      );
    },

    /** A planned session removed (AC12), with an undo. */
    removeSessions(rows: readonly PlannedWorkout[], message: string) {
      const recordedAt = now();
      actions.saveWithUndo(
        {
          ...EMPTY_PLAN_CHANGES,
          workouts: { upserts: [], deletes: rows.map((r) => ({ id: r.id, recordedAt })) },
        },
        { ...EMPTY_PLAN_CHANGES, workouts: { upserts: [...rows], deletes: [] } },
        message,
      );
    },

    /**
     * "Registrar" from the portion sheet (AC9): the planned catalog food with the portion chosen there,
     * linked to the planned item; with the food log's undo.
     */
    logPlannedPortion(item: PlannedMealItem, food: Food, portion: Portion) {
      const variables = saveItemVariables(
        newId(),
        {
          kind: 'food',
          foodId: food.id,
          portion,
          inputMethod: 'plan',
          localDate: item.localDate,
          mealType: item.mealType,
          recordedAt: now(),
          today,
          locale,
          plannedItemId: item.id,
        },
        food,
      );
      saveItem.mutate(variables);
      offerFoodUndo({ kind: 'added', items: [variables.preview] });
    },

    /**
     * "Registrar lo planificado" (AC8): each pending planned item becomes a log item linked to it, with
     * the food log's undo (deleting the logs makes the plan pending again).
     */
    logPlanned(items: readonly PlannedMealItem[]) {
      const logs = logPlannedItems(items, { recordedAt: now(), today, locale, newId });
      for (const log of logs) saveItem.mutate(log);
      if (logs.length > 0) offerFoodUndo({ kind: 'added', items: logs.map((l) => l.preview) });
    },
  };
  return actions;
}
