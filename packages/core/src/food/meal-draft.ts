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
  /** The quantity was changed, guessed or is implausible: the draft shows "Revisa la cantidad". */
  doubtful: boolean;
}

/**
 * The grams above which a portion is implausible for one person at one meal (domain review
 * 2026-11-17): more than four of the food's largest servings.
 */
const PLAUSIBLE_SERVINGS = 4;
/** The energy above which one item of a meal is implausible. */
const PLAUSIBLE_KCAL = 1500;

/**
 * An oil the photo cannot see (AC5) is kept only within these bounds, whatever the model says: a fat
 * of the catalog (group `f-` of the curated keys), at most this many grams, one per draft, and only
 * from a photo.
 */
const INFERRED_FAT_KEY = /^f-/;
const INFERRED_GRAMS_MAX = 10;

function defaultPortion(food: Food): CheckedPortion {
  const first = food.servings[0];
  return first
    ? {
        portion: { kind: 'serving', servingId: first.id, servings: 1 },
        quantityAssumed: true,
        doubtful: false,
      }
    : // No household serving to fall back on: 100 g is only a placeholder.
      { portion: { kind: 'grams', grams: DEFAULT_GRAMS }, quantityAssumed: true, doubtful: true };
}

const roundServings = (value: number) =>
  clamp(
    Math.round(value / FOOD_LOG_LIMITS.servingsStep) * FOOD_LOG_LIMITS.servingsStep,
    FOOD_LOG_LIMITS.servingsMin,
    FOOD_LOG_LIMITS.servingsMax,
  );
const servingsOutOfRange = (value: number) =>
  value < FOOD_LOG_LIMITS.servingsMin - FOOD_LOG_LIMITS.servingsStep / 2 ||
  value > FOOD_LOG_LIMITS.servingsMax;

/** The portion of one item, kept within the limits of the food log (spec 005 AC8, spec 007 AC9). */
function checkPortion(item: MealReadingItem, food: Food): CheckedPortion {
  const serving =
    item.servingId === null ? undefined : food.servings.find((s) => s.id === item.servingId);
  if (serving) {
    const asked = usable(item.servings) ? item.servings : 1;
    return {
      portion: { kind: 'serving', servingId: serving.id, servings: roundServings(asked) },
      quantityAssumed: item.quantityAssumed,
      doubtful: servingsOutOfRange(asked),
    };
  }
  if (usable(item.grams)) {
    const asked = Math.round(item.grams * 10) / 10;
    const grams = clamp(asked, FOOD_LOG_LIMITS.gramsMin, FOOD_LOG_LIMITS.gramsMax);
    return {
      portion: { kind: 'grams', grams },
      quantityAssumed: item.quantityAssumed,
      doubtful: grams !== asked,
    };
  }
  // A count with a serving that is not the food's: the count of its first serving, to check.
  const first = food.servings[0];
  if (first && usable(item.servings)) {
    return {
      portion: { kind: 'serving', servingId: first.id, servings: roundServings(item.servings) },
      quantityAssumed: false,
      doubtful: true,
    };
  }
  return defaultPortion(food);
}

/** More than a person eats of that food at one meal (domain review): worth a second look. */
function implausible(food: Food, portion: Portion): boolean {
  const grams = portionGrams(portion, food.servings);
  if (grams === null) return false;
  const largest = Math.max(0, ...food.servings.map((s) => s.grams));
  if (largest > 0 && grams > PLAUSIBLE_SERVINGS * largest) return true;
  return itemNutrition(food.per100g, grams).kcal > PLAUSIBLE_KCAL;
}

/** Whether a "probable" item the model added stays in the draft (AC5, AC9). */
function keepInferred(food: Food, portion: Portion, source: 'text' | 'photo', kept: number) {
  const grams = portionGrams(portion, food.servings);
  return (
    source === 'photo' &&
    kept === 0 &&
    INFERRED_FAT_KEY.test(food.key) &&
    grams !== null &&
    grams <= INFERRED_GRAMS_MAX
  );
}

/**
 * The editable draft of a plate photo or a sentence (spec 007 AC4–AC6, AC9, AC10). The model chose
 * the foods; this keeps only the ids the `search_foods` tool returned in that request (`candidates`),
 * checks each portion against the food log limits and the food's own servings, marks doubtful
 * portions, keeps at most one small probable oil from a photo, and turns every other mention into an
 * unresolved one for the user to search. Nothing here is saved: the user saves the draft item by item
 * with the normal log write, which computes the snapshots again.
 */
export function mealDraft(
  reading: MealReading,
  candidates: ReadonlyMap<string, Food>,
  source: 'text' | 'photo',
): MealDraftResponse {
  if (reading.status !== 'ok') return { status: 'unreadable', reason: reading.status };

  const items: DraftItem[] = [];
  const unresolved: { mention: string }[] = [];
  for (const entry of reading.items) {
    if (items.length + unresolved.length >= MEAL_DRAFT_LIMITS.itemsMax) break;
    const mention = entry.mention.trim().slice(0, MEAL_DRAFT_LIMITS.mentionMax);
    const food = entry.foodId === null ? undefined : candidates.get(entry.foodId);
    if (!food) {
      if (mention && !entry.inferred) unresolved.push({ mention });
      continue;
    }
    const { portion, quantityAssumed, doubtful } = checkPortion(entry, food);
    if (entry.inferred) {
      const kept = items.filter((i) => i.inferred).length;
      if (!keepInferred(food, portion, source, kept)) continue;
    }
    items.push({
      food,
      portion,
      mention: mention || food.name,
      confidence: doubtful || implausible(food, portion) ? 'low' : entry.confidence,
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

/**
 * The portion a draft item keeps when the user picks another food for it (AC7): the same count of a
 * serving with the same name ("2 × 1 huevo mediano"), else the same grams, within the log limits.
 */
export function portionForReplacement(
  portion: Portion,
  from: Pick<Food, 'servings'>,
  to: Pick<Food, 'servings'>,
): Portion {
  if (portion.kind === 'serving') {
    const label = from.servings.find((s) => s.id === portion.servingId)?.label;
    const same = label === undefined ? undefined : to.servings.find((s) => s.label === label);
    if (same) return { kind: 'serving', servingId: same.id, servings: portion.servings };
  }
  const grams = portionGrams(portion, from.servings) ?? DEFAULT_GRAMS;
  return {
    kind: 'grams',
    grams: clamp(Math.round(grams * 10) / 10, FOOD_LOG_LIMITS.gramsMin, FOOD_LOG_LIMITS.gramsMax),
  };
}
