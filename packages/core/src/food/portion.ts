import {
  FOOD_LOG_LIMITS,
  type Food,
  type Locale,
  type MealItem,
  type Nutrients,
  type Portion,
  type QuantityUnit,
} from '@pt/contracts';
import { formatDecimal, formatNumber, parseDecimal } from '../format';
import type { FormErrorCode } from '../profile/form';
import { itemNutrition, portionGrams } from './nutrition';

/** Grams the portion sheet opens with for a food without household servings. */
const DEFAULT_GRAMS = 100;

/**
 * The portion the sheet opens with (spec 005 AC8): the serving and quantity (or the grams) used the last
 * time for that food, else one of its first serving.
 */
export function initialPortion(food: Pick<Food, 'servings'>, last: Portion | null): Portion {
  if (last?.kind === 'grams') return last;
  if (last && food.servings.some((s) => s.id === last.servingId)) return last;
  const first = food.servings[0];
  return first
    ? { kind: 'serving', servingId: first.id, servings: 1 }
    : { kind: 'grams', grams: DEFAULT_GRAMS };
}

/** A portion as the log stores it: how it was entered, its grams and its energy and macros. */
export interface PortionPreview {
  servings: number | null;
  servingLabel: string | null;
  /** In `unit`. */
  grams: number;
  unit: QuantityUnit;
  nutrients: Nutrients;
}

/** What a portion of a food adds (AC8), computed like the stored snapshot (AC9). Null for an unknown serving. */
export function portionPreview(
  food: Pick<Food, 'per100g' | 'servings' | 'unit'>,
  portion: Portion,
): PortionPreview | null {
  const grams = portionGrams(portion, food.servings);
  if (grams === null) return null;
  const serving =
    portion.kind === 'serving' ? food.servings.find((s) => s.id === portion.servingId) : undefined;
  return {
    servings: portion.kind === 'serving' ? portion.servings : null,
    servingLabel: serving?.label ?? null,
    grams,
    unit: food.unit,
    nutrients: itemNutrition(food.per100g, grams),
  };
}

/**
 * A portion in words: "1 huevo mediano (60 g)", "1,5 × 1 taza (300 g)", "150 g" or "330 ml". Null for a
 * quick add, which has no grams.
 */
export function formatPortion(
  portion: Pick<MealItem, 'servings' | 'servingLabel' | 'grams' | 'unit'>,
  locale: Locale,
): string | null {
  if (portion.grams === null) return null;
  const grams = `${formatNumber(portion.grams, locale, 1)} ${portion.unit}`;
  if (portion.servings === null || portion.servingLabel === null) return grams;
  const serving =
    portion.servings === 1
      ? portion.servingLabel
      : `${formatDecimal(portion.servings, locale, 1)} × ${portion.servingLabel}`;
  return `${serving} (${grams})`;
}

export type ParsedGramsField = { ok: true; grams: number } | { ok: false; error: FormErrorCode };

/** The grams typed in the portion sheet (AC8): 1–2000 g, to one decimal. */
export function parseGramsField(text: string): ParsedGramsField {
  if (text.trim() === '') return { ok: false, error: 'required' };
  const parsed = parseDecimal(text);
  if (parsed === null) return { ok: false, error: 'invalid_number' };
  const grams = Math.round(parsed * 10) / 10;
  if (grams < FOOD_LOG_LIMITS.gramsMin) return { ok: false, error: 'too_small' };
  if (grams > FOOD_LOG_LIMITS.gramsMax) return { ok: false, error: 'too_big' };
  return { ok: true, grams };
}

/** The grams field when the user switches to "Gramos": the grams of the portion chosen so far. */
export function gramsFieldFromPortion(
  food: Pick<Food, 'servings'>,
  portion: Portion,
  locale: Locale,
): string {
  const grams = portionGrams(portion, food.servings) ?? DEFAULT_GRAMS;
  return formatDecimal(Math.min(grams, FOOD_LOG_LIMITS.gramsMax), locale, 1);
}

/** Share of a target already eaten, for the summary bars (AC16): 0 to 1, full when above the target. */
export function targetProgress(eaten: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(1, Math.max(0, eaten / target));
}
