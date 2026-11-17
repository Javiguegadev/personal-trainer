import type { Locale, MealItem, MealItemUpsertRequest, MealType } from '@pt/contracts';
import { addDays } from '../dates';
import { itemToRequest } from './item-request';

const itemsOf = (items: readonly MealItem[], mealType: MealType, localDate: string) =>
  items
    .filter((i) => i.mealType === mealType && i.localDate === localDate)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

/**
 * "Repetir lo de ayer" (spec 005 AC13): offered when the meal is empty on `day` and had items the day
 * before. Returns how many items and their kcal, or null.
 */
export function repeatableMeal(
  items: readonly MealItem[],
  mealType: MealType,
  day: string,
): { count: number; kcal: number } | null {
  if (itemsOf(items, mealType, day).length > 0) return null;
  const previous = itemsOf(items, mealType, addDays(day, -1));
  if (previous.length === 0) return null;
  const kcal = previous.reduce((sum, i) => sum + i.nutrients.kcal, 0);
  return { count: previous.length, kcal: Math.round(kcal) };
}

export interface RepeatMealInput {
  items: readonly MealItem[];
  mealType: MealType;
  from: string;
  to: string;
  /** One new client id per copied item. */
  ids: readonly string[];
  recordedAt: string;
  today: string;
  /** Language of the snapshots of the copies. */
  locale?: Locale;
}

export interface RepeatedItem {
  id: string;
  request: MealItemUpsertRequest;
  /** The copy as the log shows it until the API answers (its snapshot is the source item's). */
  preview: MealItem;
}

/**
 * The writes that copy a meal of `from` to `to` (AC13): catalog items keep their portion, so the API
 * computes the snapshot again; quick adds (and items whose food left the catalog) are copied as they are.
 */
export function repeatMeal(input: RepeatMealInput): RepeatedItem[] {
  const source = itemsOf(input.items, input.mealType, input.from);
  if (input.ids.length < source.length) throw new Error('repeatMeal needs one id per item');
  const placement = {
    localDate: input.to,
    mealType: input.mealType,
    recordedAt: input.recordedAt,
    today: input.today,
    locale: input.locale ?? 'es',
  };
  return source.map((item, index) => {
    const id = input.ids[index]!;
    return {
      id,
      request: itemToRequest(item, placement, 'repeat'),
      preview: {
        ...item,
        id,
        localDate: input.to,
        recordedAt: input.recordedAt,
        inputMethod: 'repeat',
      },
    };
  });
}
