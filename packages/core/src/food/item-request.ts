import type {
  FoodInputMethod,
  Locale,
  MealItem,
  MealItemUpsertRequest,
  MealType,
  Portion,
} from '@pt/contracts';

/** Where and when an item is written: its day and meal, the device time and the user's date. */
export interface ItemPlacement {
  localDate: string;
  mealType: MealType;
  recordedAt: string;
  today: string;
  locale: Locale;
  /** The planned item the write logs (spec 013); a move or an undo keeps the item's own link. */
  plannedItemId?: string | null;
}

/** The portion an item was logged with: the servings when it has them, else its grams. */
export function itemPortion(item: MealItem): Portion | null {
  if (item.servingId !== null && item.servings !== null) {
    return { kind: 'serving', servingId: item.servingId, servings: item.servings };
  }
  return item.grams !== null ? { kind: 'grams', grams: item.grams } : null;
}

/**
 * The write that stores a logged item again (spec 005): moved to another meal (AC11), restored by an undo
 * (AC11, AC13) or copied (AC13). A catalog item keeps its portion, so the API computes its snapshot again;
 * a quick add, or an item whose food left the catalog, is written from its snapshot.
 */
export function itemToRequest(
  item: MealItem,
  placement: ItemPlacement,
  inputMethod: FoodInputMethod = item.inputMethod,
): MealItemUpsertRequest {
  const portion = itemPortion(item);
  if (item.foodId !== null && portion !== null && inputMethod !== 'quick_add') {
    return { kind: 'food', foodId: item.foodId, portion, inputMethod, ...placement };
  }
  const n = item.nutrients;
  return {
    kind: 'quick_add',
    label: item.label,
    kcal: n.kcal,
    proteinG: n.proteinG,
    carbsG: n.carbsG,
    fatG: n.fatG,
    inputMethod: inputMethod === 'repeat' || inputMethod === 'plan' ? inputMethod : 'quick_add',
    ...placement,
  };
}
