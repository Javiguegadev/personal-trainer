import {
  CUSTOM_FOOD_LIMITS,
  PRODUCT_LIMITS,
  type Nutrients,
  type QuantityUnit,
} from '@pt/contracts';

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const KJ_PER_KCAL = 4.184;

/** Kilojoules to kilocalories, to two decimals (spec 006 AC4, AC15). */
export function kcalFromKj(kj: number): number {
  return round2(kj / KJ_PER_KCAL);
}

type Per100 = Pick<Nutrients, 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG'>;

/** Energy of the macros: 4 kcal/g for protein and carbohydrates, 9 for fat, 2 for fiber (EU 1169/2011). */
export function macroEnergy(values: Omit<Per100, 'kcal'>): number {
  return 4 * values.proteinG + 4 * values.carbsG + 9 * values.fatG + 2 * (values.fiberG ?? 0);
}

/** Differences below this many kcal per 100 g are rounding (water, diet drinks, vegetables). */
const ENERGY_NOISE_KCAL = 10;

/**
 * True when the stated energy is away from the energy of the macros by more than `tolerance` (a share
 * of the macro energy). A scanned product gets a "check the package" note (spec 006 AC5, 25 %); a
 * custom food asks for confirmation (AC10, 20 %). Alcohol and polyols also cause it: it is a prompt to
 * check, not an error.
 */
export function energyMismatch(per100g: Per100, tolerance: number): boolean {
  const macros = macroEnergy(per100g);
  const difference = Math.abs(per100g.kcal - macros);
  if (difference < ENERGY_NOISE_KCAL) return false;
  return difference > macros * tolerance + 1e-9;
}

/** Whether a scanned product gets the "check these values with the package" note (AC5). */
export function productEnergyMismatch(per100g: Per100): boolean {
  return energyMismatch(per100g, PRODUCT_LIMITS.energyMismatch);
}

export type Per100Field = 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG';

/**
 * The plausible range of values per 100 g or ml (spec 006 AC4): 0–900 kcal, 0–100 g per macro, and
 * macros that do not add to more than 105 g. Returns the first field that breaks it (`macros` for the
 * sum), or null.
 */
export function per100gOutOfRange(values: Per100): Per100Field | 'macros' | null {
  const inRange = (value: number, max: number) =>
    Number.isFinite(value) && value >= 0 && value <= max;
  if (!inRange(values.kcal, CUSTOM_FOOD_LIMITS.kcalMax)) return 'kcal';
  for (const field of ['proteinG', 'carbsG', 'fatG'] as const) {
    if (!inRange(values[field], CUSTOM_FOOD_LIMITS.macroMax)) return field;
  }
  if (values.fiberG !== null && !inRange(values.fiberG, CUSTOM_FOOD_LIMITS.macroMax)) {
    return 'fiberG';
  }
  if (values.proteinG + values.carbsG + values.fatG > CUSTOM_FOOD_LIMITS.macroSumMax + 1e-9) {
    return 'macros';
  }
  return null;
}

/** The fields of an Open Food Facts product the app reads, already parsed (numbers or null). */
export interface OffProductInput {
  productNameEs?: string | null;
  productName?: string | null;
  genericNameEs?: string | null;
  genericName?: string | null;
  /** Comma-separated, the main brand first. */
  brands?: string | null;
  energyKcal100g?: number | null;
  energyKj100g?: number | null;
  proteins100g?: number | null;
  carbohydrates100g?: number | null;
  fat100g?: number | null;
  fiber100g?: number | null;
  /** Net quantity of the package and size of one serving, in `g` or `ml`. */
  productQuantity?: number | null;
  productQuantityUnit?: string | null;
  servingQuantity?: number | null;
  servingQuantityUnit?: string | null;
  allergensTags?: readonly string[] | null;
  tracesTags?: readonly string[] | null;
}

/** A scanned product as the catalog stores it. */
export interface ScannedProduct {
  name: string;
  brand: string | null;
  unit: QuantityUnit;
  /** Per 100 g, or per 100 ml when `unit` is `ml`: the values of the source, to two decimals. */
  per100g: Nutrients;
  /** "1 ración" and "1 envase", when the source gives their size within 1–2000. */
  servings: { kind: 'serving' | 'package'; grams: number }[];
  allergens: string[];
  traces: string[];
}

const SERVING_MIN = 1;
const SERVING_MAX = 2000;
const TAG_LENGTH_MAX = 80;
const TAGS_MAX = 50;

const cleanText = (value: string | null | undefined, max: number): string | null => {
  const trimmed = value?.replace(/\s+/g, ' ').trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, max).trim();
};

const finite = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Declared allergens are never dropped for their form: a tag the app cannot translate
 * (`de:Schalenfrüchte (keine Erdnüsse)`) is still shown as it is. Only the length is bounded.
 */
const cleanTags = (values: readonly string[] | null | undefined): string[] =>
  [
    ...new Set(
      (values ?? [])
        .map((tag) => tag.replace(/\s+/g, ' ').trim().slice(0, TAG_LENGTH_MAX))
        .filter((tag) => tag !== ''),
    ),
  ].slice(0, TAGS_MAX);

const unitOf = (unit: string | null | undefined): QuantityUnit | null =>
  unit === 'g' || unit === 'ml' ? unit : null;

/**
 * Energy converted from kJ can land a hair above the 900 kcal of pure fat (an oil printed as 3766 kJ
 * is 900.1 kcal): within this margin it counts as 900 instead of rejecting the food.
 */
const KCAL_MARGIN = 5;

/** Kcal per 100, with the rounding margin of a kJ conversion at the top of the range. */
export function capEnergy(kcal: number): number {
  const max = CUSTOM_FOOD_LIMITS.kcalMax;
  return kcal > max && kcal <= max + KCAL_MARGIN ? max : kcal;
}

const size = (value: number | null | undefined): number | null => {
  const n = finite(value);
  if (n === null || n < SERVING_MIN || n > SERVING_MAX) return null;
  return Math.round(n * 10) / 10;
};

/**
 * An Open Food Facts product as a food (spec 006 AC4), or null when it cannot be logged: no name, a
 * missing value for energy, protein, carbohydrates or fat, or values outside the plausible range.
 * Nothing is estimated and nothing is mixed with another source.
 */
export function productFromOff(input: OffProductInput): ScannedProduct | null {
  const nameMax = CUSTOM_FOOD_LIMITS.nameMax;
  const name =
    cleanText(input.productNameEs, nameMax) ??
    cleanText(input.productName, nameMax) ??
    cleanText(input.genericNameEs, nameMax) ??
    cleanText(input.genericName, nameMax);
  if (name === null) return null;

  const kj = finite(input.energyKj100g);
  const kcal = finite(input.energyKcal100g) ?? (kj === null ? null : kcalFromKj(kj));
  const proteinG = finite(input.proteins100g);
  const carbsG = finite(input.carbohydrates100g);
  const fatG = finite(input.fat100g);
  if (kcal === null || proteinG === null || carbsG === null || fatG === null) return null;
  const fiber = finite(input.fiber100g);
  const per100g: Nutrients = {
    kcal: capEnergy(round2(kcal)),
    proteinG: round2(proteinG),
    carbsG: round2(carbsG),
    fatG: round2(fatG),
    fiberG: fiber === null ? null : round2(fiber),
  };
  if (per100gOutOfRange(per100g) !== null) return null;

  // The unit of the values is the one the product is sold by; without it, the unit of its serving.
  // A size in the other unit is not a portion of this food (a cocoa powder sold in grams with a
  // serving of "200 ml prepared"): it is dropped, never read as if it were in the food's unit.
  const packUnit = unitOf(input.productQuantityUnit);
  const servingUnit = unitOf(input.servingQuantityUnit);
  const unit: QuantityUnit = packUnit ?? servingUnit ?? 'g';
  const serving = servingUnit === null || servingUnit === unit ? size(input.servingQuantity) : null;
  const pack = packUnit === null || packUnit === unit ? size(input.productQuantity) : null;
  const servings: ScannedProduct['servings'] = [];
  if (serving !== null) servings.push({ kind: 'serving', grams: serving });
  if (pack !== null && pack !== serving) servings.push({ kind: 'package', grams: pack });

  return {
    name,
    brand: cleanText(input.brands?.split(',')[0], CUSTOM_FOOD_LIMITS.brandMax),
    unit,
    per100g,
    servings,
    allergens: cleanTags(input.allergensTags),
    traces: cleanTags(input.tracesTags),
  };
}

/**
 * Allergen or trace tags of Open Food Facts (`en:milk`) as words (spec 006 AC5): the translated name of
 * a known tag, else the tag itself without its language prefix (`en:sesame-seeds` → "sesame seeds"),
 * so a declared allergen is always shown, in whatever language the source has it.
 */
export function allergenNames(
  tags: readonly string[],
  names: Readonly<Record<string, string>>,
): string[] {
  return tags.map((tag) => names[tag] ?? tag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' '));
}
