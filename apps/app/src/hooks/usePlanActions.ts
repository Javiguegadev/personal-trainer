import { saveItemVariables } from '@pt/api-client';
import type {
  Food,
  MealType,
  PlannedMealItem,
  PlannedMealItemUpsert,
  PlannedWorkout,
  Portion,
} from '@pt/contracts';
import {
  EMPTY_PLAN_CHANGES,
  logPlannedItems,
  plannedMealItemFromUpsert,
  stampChanges,
  type PlanChanges,
} from '@pt/core';
import { useSaveMealItem, useSavePlanChanges } from '@/lib/api';
import { offerFoodUndo } from '@/lib/foodUndo';
import { newId } from '@/lib/id';
import { clearPlanUndo, offerPlanUndo, type PlanUndo } from '@/lib/planUndo';
import { useI18n } from './useI18n';
import { useToday } from './useToday';

/** A planned item to add: an upsert without the id and the time, which the write sets. */
export type NewPlannedItem = PlannedMealItemUpsert extends infer U
  ? U extends PlannedMealItemUpsert
    ? Omit<U, 'id' | 'recordedAt'>
    : never
  : never;

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

    /**
     * "Añadir al plan" (AC5): a catalog food with its portion (`food`) or a quick add (`food` null),
     * its snapshot computed by `@pt/core` as the API will; with an undo that removes it. Returns the
     * planned row, or null when the portion does not fit the food.
     */
    addItem(
      upsert: NewPlannedItem,
      food: Food | null,
      message: (row: PlannedMealItem) => string,
    ): PlannedMealItem | null {
      const recordedAt = now();
      const row = plannedMealItemFromUpsert({ ...upsert, id: newId(), recordedAt }, food);
      if ('error' in row) return null;
      actions.saveWithUndo(
        { ...EMPTY_PLAN_CHANGES, mealItems: { upserts: [row], deletes: [] } },
        {
          ...EMPTY_PLAN_CHANGES,
          mealItems: { upserts: [], deletes: [{ id: row.id, recordedAt }] },
        },
        message(row),
      );
      return row;
    },

    /**
     * A planned item of a future day changed (AC6): another portion of its catalog food (`food` and
     * `portion`), or the same item in another meal or day.
     */
    changeItem(
      item: PlannedMealItem,
      placement: { localDate: string; mealType: MealType },
      next: { food: Food; portion: Portion } | null,
    ): void {
      const recordedAt = now();
      const moved = { ...item, ...placement, recordedAt };
      const row = next
        ? plannedMealItemFromUpsert(
            {
              kind: 'food',
              foodId: next.food.id,
              portion: next.portion,
              ...placement,
              id: item.id,
              recordedAt,
            },
            next.food,
          )
        : moved;
      actions.save({
        ...EMPTY_PLAN_CHANGES,
        mealItems: { upserts: ['error' in row ? moved : row], deletes: [] },
      });
    },

    /** A planned session or activity, new or changed (AC10, AC12). */
    saveSession(row: PlannedWorkout): void {
      actions.save({ ...EMPTY_PLAN_CHANGES, workouts: { upserts: [row], deletes: [] } });
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
