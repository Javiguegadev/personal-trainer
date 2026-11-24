import { saveItemVariables } from '@pt/api-client';
import type { Food, FoodInputMethod, MealItem, MealType, Portion } from '@pt/contracts';
import {
  addDays,
  itemToRequest,
  repeatMeal,
  type ItemPlacement,
  type QuickAddValues,
} from '@pt/core';
import { useDeleteMealItem, useSaveMealItem } from '@/lib/api';
import { clearFoodUndo, offerFoodUndo, type FoodUndo } from '@/lib/foodUndo';
import { newId } from '@/lib/id';
import { useI18n } from './useI18n';
import { useToday } from './useToday';

/**
 * Every write of the food log (spec 005): optimistic and queued offline by `@pt/api-client`, so the
 * screens call these and close without waiting (AC19).
 */
export function useFoodLogActions() {
  const { locale } = useI18n();
  const today = useToday();
  const save = useSaveMealItem();
  const remove = useDeleteMealItem();

  const now = () => new Date().toISOString();
  const placement = (localDate: string, mealType: MealType): ItemPlacement => ({
    localDate,
    mealType,
    recordedAt: now(),
    today,
    locale,
    plannedItemId: null,
  });

  /** Writes the item again where it is, or in another meal (AC11): also the undo of a delete. */
  const rewrite = (item: MealItem, mealType: MealType) => {
    const at = { ...placement(item.localDate, mealType), plannedItemId: item.plannedItemId };
    save.mutate({
      id: item.id,
      request: itemToRequest(item, at),
      preview: { ...item, mealType, recordedAt: at.recordedAt },
    });
  };

  const actions = {
    /**
     * AC8: a portion of a food: of the catalog, a scanned product or one of the user's own (spec 006).
     * Returns the item as the log shows it.
     */
    addFood(
      food: Food,
      portion: Portion,
      inputMethod: Exclude<FoodInputMethod, 'quick_add' | 'repeat'>,
      localDate: string,
      mealType: MealType,
    ): MealItem {
      const variables = saveItemVariables(
        newId(),
        { kind: 'food', foodId: food.id, portion, inputMethod, ...placement(localDate, mealType) },
        food,
      );
      save.mutate(variables);
      return variables.preview;
    },

    /** AC10: a name and its calories, for something that is not in the catalog. */
    addQuick(
      values: QuickAddValues & { label: string },
      localDate: string,
      mealType: MealType,
    ): MealItem {
      const variables = saveItemVariables(
        newId(),
        {
          kind: 'quick_add',
          ...values,
          inputMethod: 'quick_add',
          ...placement(localDate, mealType),
        },
        null,
      );
      save.mutate(variables);
      return variables.preview;
    },

    /** AC11: a new portion (and meal) for a logged catalog food. */
    changePortion(item: MealItem, food: Food, portion: Portion, mealType: MealType): void {
      const inputMethod = item.inputMethod === 'quick_add' ? 'search' : item.inputMethod;
      save.mutate(
        saveItemVariables(
          item.id,
          {
            kind: 'food',
            foodId: food.id,
            portion,
            inputMethod,
            ...placement(item.localDate, mealType),
          },
          food,
        ),
      );
    },

    /** AC11: the same item in another meal. */
    move: rewrite,

    /** AC11: deleted at once, with an undo instead of a confirmation. */
    remove(item: MealItem): void {
      remove.mutate({ id: item.id, recordedAt: now() });
      offerFoodUndo({ kind: 'deleted', item });
    },

    /** AC13: copies the meal of the day before `day` to `day`, as new items. */
    repeatYesterday(items: readonly MealItem[], mealType: MealType, day: string): void {
      const from = addDays(day, -1);
      const count = items.filter((i) => i.mealType === mealType && i.localDate === from).length;
      const copies = repeatMeal({
        items,
        mealType,
        from,
        to: day,
        ids: Array.from({ length: count }, newId),
        recordedAt: now(),
        today,
        locale,
      });
      for (const copy of copies) save.mutate(copy);
      if (copies.length > 0) {
        offerFoodUndo({ kind: 'repeated', items: copies.map((copy) => copy.preview) });
      }
    },

    /**
     * Spec 007 AC8: every entry of a reviewed draft, in order, as new items of one meal, with one undo
     * for all of them. Queued offline like any other item.
     */
    addDraft(
      entries: readonly (
        | { kind: 'food'; food: Food; portion: Portion }
        | { kind: 'quick'; values: QuickAddValues & { label: string } }
      )[],
      inputMethod: 'photo' | 'text',
      localDate: string,
      mealType: MealType,
    ): MealItem[] {
      const items = entries.map((entry) =>
        entry.kind === 'food'
          ? actions.addFood(entry.food, entry.portion, inputMethod, localDate, mealType)
          : actions.addQuick(entry.values, localDate, mealType),
      );
      if (items.length > 0) offerFoodUndo({ kind: 'added', items });
      return items;
    },

    /** A deleted item is written again with a later time, which wins over the delete (AC20). */
    undo(undo: FoodUndo): void {
      clearFoodUndo();
      if (undo.kind === 'deleted') rewrite(undo.item, undo.item.mealType);
      else for (const item of undo.items) remove.mutate({ id: item.id, recordedAt: now() });
    },
  };
  return actions;
}
