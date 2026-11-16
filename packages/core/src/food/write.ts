import {
  FOOD_LOG_LIMITS,
  type Food,
  type MealItem,
  type MealItemUpsertRequest,
} from '@pt/contracts';
import { addDays, daysBetween } from '../dates';
import { checkClientDates } from '../profile/evaluate';
import { itemNutrition, portionGrams } from './nutrition';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Request-level checks of a food-log write that need the server clock (spec 005, same rules as the
 * weight log): `today` within ±1 day of the server, no future day, at most a year back, and a device
 * clock at most one day ahead. Returns the field errors, or null.
 */
export function checkFoodLogWrite(
  write: { localDate: string; today: string; recordedAt: string },
  now: Date,
): Record<string, string> | null {
  const invalid = checkClientDates({ today: write.today }, now);
  if (invalid) return invalid;
  if (write.localDate > write.today) return { localDate: 'in_future' };
  if (write.localDate < addDays(write.today, -FOOD_LOG_LIMITS.historyDays)) {
    return { localDate: 'too_old' };
  }
  if (Date.parse(write.recordedAt) > now.getTime() + DAY_MS) return { recordedAt: 'in_future' };
  return null;
}

/** `GET /me/food-log?from&to`: at most 31 days. */
export function checkFoodLogRange(from: string, to: string): Record<string, string> | null {
  if (from > to) return { from: 'after_to' };
  if (daysBetween(from, to) > FOOD_LOG_LIMITS.listDaysMax) return { to: 'too_big' };
  return null;
}

/**
 * The stored item for a write (AC9, AC10). A catalog item's snapshot is computed from the catalog food,
 * never from client values; `food` is the catalog food in the user's locale, or null when unknown.
 */
export function mealItemFromRequest(
  id: string,
  request: MealItemUpsertRequest,
  food: Food | null,
): MealItem | { error: 'food_not_found' | 'serving_not_found' } {
  const base = {
    id,
    localDate: request.localDate,
    mealType: request.mealType,
    inputMethod: request.inputMethod,
    recordedAt: request.recordedAt,
  };
  if (request.kind === 'quick_add') {
    return {
      ...base,
      foodId: null,
      servingId: null,
      servings: null,
      servingLabel: null,
      grams: null,
      unit: 'g',
      label: request.label,
      nutrients: {
        kcal: request.kcal,
        proteinG: request.proteinG ?? 0,
        carbsG: request.carbsG ?? 0,
        fatG: request.fatG ?? 0,
        fiberG: null,
      },
    };
  }
  if (!food || food.id !== request.foodId) return { error: 'food_not_found' };
  const grams = portionGrams(request.portion, food.servings);
  if (grams === null) return { error: 'serving_not_found' };
  const serving =
    request.portion.kind === 'serving'
      ? (food.servings.find((s) => s.id === (request.portion as { servingId: string }).servingId) ??
        null)
      : null;
  return {
    ...base,
    foodId: food.id,
    servingId: serving?.id ?? null,
    servings: request.portion.kind === 'serving' ? request.portion.servings : null,
    servingLabel: serving?.label ?? null,
    grams,
    unit: food.unit,
    label: food.name,
    nutrients: itemNutrition(food.per100g, grams),
  };
}

/**
 * Last write wins by device time (AC20): a write applies when nothing is stored yet, or when it is not
 * older than what is stored (a live item or a delete's tombstone). The same write sent twice applies twice
 * with the same result.
 */
export function writeWins(storedRecordedAt: string | null, incomingRecordedAt: string): boolean {
  if (storedRecordedAt === null) return true;
  return Date.parse(incomingRecordedAt) >= Date.parse(storedRecordedAt);
}
