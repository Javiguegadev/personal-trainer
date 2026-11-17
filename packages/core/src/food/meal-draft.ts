import {
  FOOD_LOG_LIMITS,
  MEAL_DRAFT_LIMITS,
  type DraftItem,
  type Food,
  type MealDraftResponse,
  type MealReading,
  type MealReadingItem,
  type Nutrients,
  type Portion,
} from '@pt/contracts';
import { itemNutrition, portionGrams } from './nutrition';

/** Grams of a food without household servings when no quantity was said (AC4). */
const DEFAULT_GRAMS = 100;

const usable = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface CheckedPortion {
  portion: Portion;
  quantityAssumed: boolean;
  /** The model's quantity was outside the log limits and was changed. */
  clamped: boolean;
}

function defaultPortion(food: Food): CheckedPortion {
  const first = food.servings[0];
  return {
    portion: first
      ? { kind: 'serving', servingId: first.id, servings: 1 }
      : { kind: 'grams', grams: DEFAULT_GRAMS },
    quantityAssumed: true,
    clamped: false,
  };
}

/** The portion of one item, kept within the limits of the food log (spec 005 AC8, spec 007 AC9). */
function checkPortion(item: MealReadingItem, food: Food): CheckedPortion {
  const serving =
    item.servingId === null ? undefined : food.servings.find((s) => s.id === item.servingId);
  if (serving) {
    const asked = usable(item.servings) ? item.servings : 1;
    const servings = clamp(
      Math.round(asked / FOOD_LOG_LIMITS.servingsStep) * FOOD_LOG_LIMITS.servingsStep,
      FOOD_LOG_LIMITS.servingsMin,
      FOOD_LOG_LIMITS.servingsMax,
    );
    const clamped =
      asked < FOOD_LOG_LIMITS.servingsMin - FOOD_LOG_LIMITS.servingsStep / 2 ||
      asked > FOOD_LOG_LIMITS.servingsMax;
    return {
      portion: { kind: 'serving', servingId: serving.id, servings },
      quantityAssumed: item.quantityAssumed,
      clamped,
    };
  }
  if (usable(item.grams)) {
    const grams = clamp(
      Math.round(item.grams * 10) / 10,
      FOOD_LOG_LIMITS.gramsMin,
      FOOD_LOG_LIMITS.gramsMax,
    );
    return {
      portion: { kind: 'grams', grams },
      quantityAssumed: item.quantityAssumed,
      clamped: grams !== Math.round(item.grams * 10) / 10,
    };
  }
  return defaultPortion(food);
}

/**
 * The editable draft of a plate photo or a sentence (spec 007 AC4–AC6, AC9, AC10). The model chose
 * the foods; this keeps only the ids the `search_foods` tool returned in that request (`candidates`),
 * checks each portion against the food log limits and the food's own servings, and turns every other
 * mention into an unresolved one for the user to search. Nothing here is saved: the user saves the
 * draft item by item with the normal log write, which computes the snapshots again.
 */
export function mealDraft(
  reading: MealReading,
  candidates: ReadonlyMap<string, Food>,
): MealDraftResponse {
  if (reading.status !== 'ok') return { status: 'unreadable', reason: reading.status };

  const items: DraftItem[] = [];
  const unresolved: { mention: string }[] = [];
  for (const entry of reading.items) {
    if (items.length + unresolved.length >= MEAL_DRAFT_LIMITS.itemsMax) break;
    const mention = entry.mention.trim().slice(0, MEAL_DRAFT_LIMITS.mentionMax);
    const food = entry.foodId === null ? undefined : candidates.get(entry.foodId);
    if (!food) {
      if (mention) unresolved.push({ mention });
      continue;
    }
    const { portion, quantityAssumed, clamped } = checkPortion(entry, food);
    items.push({
      food,
      portion,
      mention: mention || food.name,
      confidence: clamped ? 'low' : entry.confidence,
      quantityAssumed,
      inferred: entry.inferred,
    });
  }
  if (items.length === 0 && unresolved.length === 0) {
    return { status: 'unreadable', reason: 'not_food' };
  }
  return { status: 'ok', items, unresolved };
}

const ZERO: Nutrients = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null };

/** Energy and macros of a draft as it stands (AC7), unrounded; fiber sums the known values. */
export function draftTotals(items: readonly Pick<DraftItem, 'food' | 'portion'>[]): Nutrients {
  return items.reduce<Nutrients>((sum, { food, portion }) => {
    const grams = portionGrams(portion, food.servings);
    if (grams === null) return sum;
    const n = itemNutrition(food.per100g, grams);
    return {
      kcal: sum.kcal + n.kcal,
      proteinG: sum.proteinG + n.proteinG,
      carbsG: sum.carbsG + n.carbsG,
      fatG: sum.fatG + n.fatG,
      fiberG: n.fiberG === null ? sum.fiberG : (sum.fiberG ?? 0) + n.fiberG,
    };
  }, ZERO);
}
