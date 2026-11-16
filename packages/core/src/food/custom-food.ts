import {
  CATALOG_FOOD_FIELDS,
  CUSTOM_FOOD_LIMITS,
  FOOD_LOG_LIMITS,
  type CustomFoodUpsertRequest,
  type Food,
  type LabelDraft,
  type Locale,
  type QuantityUnit,
} from '@pt/contracts';
import { formatDecimal, parseDecimal } from '../format';
import type { FormErrorCode } from '../profile/form';
import { energyMismatch, per100gOutOfRange } from './product';
import type { SearchableFood } from './search';

/** `knowledge_sources.id` of the foods a user creates. */
export const USER_FOOD_SOURCE = 'user';

/**
 * Request-level check of a custom food (spec 006 AC10): the ranges of each value are in the schema;
 * this adds the one rule across fields. Returns the field errors, or null.
 */
export function checkCustomFood(
  request: Pick<CustomFoodUpsertRequest, 'per100g'>,
): Record<string, string> | null {
  const field = per100gOutOfRange(request.per100g);
  if (field === null) return null;
  return field === 'macros' ? { per100g: 'macros_too_high' } : { [`per100g.${field}`]: 'too_big' };
}

/** True when the form asks for confirmation before saving: energy away from the macros by over 20 %. */
export function customFoodEnergyMismatch(per100g: CustomFoodUpsertRequest['per100g']): boolean {
  return energyMismatch(per100g, CUSTOM_FOOD_LIMITS.energyTolerance);
}

/** A custom food as the app and the API return it. Its name is the same in every language. */
export function customFoodAsFood(id: string, request: CustomFoodUpsertRequest): Food {
  return {
    ...CATALOG_FOOD_FIELDS,
    id,
    key: `user-${id}`,
    name: request.name,
    per100g: request.per100g,
    servings: request.serving ? [request.serving] : [],
    source: USER_FOOD_SOURCE,
    origin: request.origin,
    unit: request.unit,
    brand: request.brand,
    barcode: request.barcode,
  };
}

/** The write that stores an own food again as it is (undo of a delete, spec 006 AC12). */
export function customFoodRequest(food: Food): CustomFoodUpsertRequest {
  return {
    name: food.name,
    brand: food.brand,
    unit: food.unit,
    per100g: food.per100g,
    serving: food.servings[0] ?? null,
    barcode: food.barcode,
    origin: food.origin === 'label' ? 'label' : 'manual',
  };
}

/** A food the user created (private to them), as opposed to the catalog or a scanned product. */
export function isOwnFood(food: Pick<Food, 'origin'>): boolean {
  return food.origin === 'manual' || food.origin === 'label';
}

/** Above every curated popularity (0–9): at the same match, the user's own foods come first. */
const OWN_FOOD_POPULARITY = 10;

/**
 * A branded food (the user's own, or a product they logged) for the search index: found by its name,
 * its brand, or both in either order (spec 006 AC11).
 */
export function searchableBrandedFood(food: Pick<Food, 'id' | 'name' | 'brand'>): SearchableFood {
  const brand = food.brand;
  return {
    id: food.id,
    nameEs: food.name,
    nameEn: food.name,
    synonymsEs: brand ? [brand, `${brand} ${food.name}`, `${food.name} ${brand}`] : [],
    popularity: OWN_FOOD_POPULARITY,
  };
}

/** The custom-food form as typed: every value is text (spec 006 AC9). */
export interface CustomFoodFields {
  name: string;
  brand: string;
  unit: QuantityUnit;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  servingLabel: string;
  servingGrams: string;
}

export const EMPTY_CUSTOM_FOOD_FIELDS: CustomFoodFields = {
  name: '',
  brand: '',
  unit: 'g',
  kcal: '',
  protein: '',
  carbs: '',
  fat: '',
  fiber: '',
  servingLabel: '',
  servingGrams: '',
};

export type CustomFoodField = Exclude<keyof CustomFoodFields, 'unit'>;

/** `macros`: protein, carbohydrates and fat add to more than the 100 g they are part of. */
export type CustomFoodFieldErrors = Partial<Record<CustomFoodField | 'macros', FormErrorCode>>;

export type ParsedCustomFood =
  { ok: true; request: CustomFoodUpsertRequest } | { ok: false; errors: CustomFoodFieldErrors };

function numberField(
  text: string,
  min: number,
  max: number,
  required: boolean,
): { value: number | null; error?: FormErrorCode } {
  if (text.trim() === '') return required ? { value: null, error: 'required' } : { value: null };
  const value = parseDecimal(text);
  if (value === null) return { value: null, error: 'invalid_number' };
  if (value < min) return { value: null, error: 'too_small' };
  if (value > max) return { value: null, error: 'too_big' };
  return { value };
}

export interface CustomFoodContext {
  /** Set when the form came from a scan (shown read-only). */
  barcode: string | null;
  /** `label` when a label photo filled the form. */
  origin: 'manual' | 'label';
  /** The id of the serving: the food's current one when editing, else a new client id. */
  servingId: string;
  /** Name of the serving when the user gives only its size: "1 ración". */
  defaultServingLabel: string;
}

/**
 * The custom-food form (AC9, AC10): a name, an optional brand, the values per 100 g or ml within their
 * ranges, and an optional serving (its size; its name defaults to "1 ración").
 */
export function parseCustomFoodFields(
  fields: CustomFoodFields,
  context: CustomFoodContext,
): ParsedCustomFood {
  const errors: CustomFoodFieldErrors = {};
  const name = fields.name.trim();
  if (name === '') errors.name = 'required';
  else if (name.length > CUSTOM_FOOD_LIMITS.nameMax) errors.name = 'too_long';
  const brand = fields.brand.trim();
  if (brand.length > CUSTOM_FOOD_LIMITS.brandMax) errors.brand = 'too_long';

  const read = (field: CustomFoodField, max: number, required: boolean, min = 0) => {
    const parsed = numberField(fields[field], min, max, required);
    if (parsed.error) errors[field] = parsed.error;
    return parsed.value;
  };
  const kcal = read('kcal', CUSTOM_FOOD_LIMITS.kcalMax, true);
  const proteinG = read('protein', CUSTOM_FOOD_LIMITS.macroMax, true);
  const carbsG = read('carbs', CUSTOM_FOOD_LIMITS.macroMax, true);
  const fatG = read('fat', CUSTOM_FOOD_LIMITS.macroMax, true);
  const fiberG = read('fiber', CUSTOM_FOOD_LIMITS.macroMax, false);

  const servingLabel = fields.servingLabel.trim();
  if (servingLabel.length > CUSTOM_FOOD_LIMITS.servingLabelMax) errors.servingLabel = 'too_long';
  // A serving needs its size; a name without a size is an unfinished serving.
  const servingGrams = read(
    'servingGrams',
    FOOD_LOG_LIMITS.gramsMax,
    servingLabel !== '',
    FOOD_LOG_LIMITS.gramsMin,
  );

  if (
    Object.keys(errors).length > 0 ||
    kcal === null ||
    proteinG === null ||
    carbsG === null ||
    fatG === null
  ) {
    return { ok: false, errors };
  }
  const per100g = { kcal, proteinG, carbsG, fatG, fiberG };
  if (per100gOutOfRange(per100g) === 'macros') return { ok: false, errors: { macros: 'too_big' } };

  return {
    ok: true,
    request: {
      name,
      brand: brand === '' ? null : brand,
      unit: fields.unit,
      per100g,
      serving:
        servingGrams === null
          ? null
          : {
              id: context.servingId,
              label: servingLabel === '' ? context.defaultServingLabel : servingLabel,
              grams: Math.round(servingGrams * 10) / 10,
            },
      barcode: context.barcode,
      origin: context.origin,
    },
  };
}

const field = (value: number | null, locale: Locale) =>
  value === null ? '' : formatDecimal(value, locale, 2);

/** The form of an existing custom food, to edit it (AC12). */
export function customFoodFields(food: Food, locale: Locale): CustomFoodFields {
  const serving = food.servings[0];
  return {
    name: food.name,
    brand: food.brand ?? '',
    unit: food.unit,
    kcal: field(food.per100g.kcal, locale),
    protein: field(food.per100g.proteinG, locale),
    carbs: field(food.per100g.carbsG, locale),
    fat: field(food.per100g.fatG, locale),
    fiber: field(food.per100g.fiberG, locale),
    servingLabel: serving?.label ?? '',
    servingGrams: field(serving?.grams ?? null, locale),
  };
}

/**
 * The form filled from a label photo (AC16), and which fields the photo filled. A value the photo did
 * not give keeps what the user had typed.
 */
export function customFoodFieldsFromDraft(
  draft: LabelDraft,
  current: CustomFoodFields,
  locale: Locale,
): { fields: CustomFoodFields; read: CustomFoodField[] } {
  const read: CustomFoodField[] = [];
  const fields = { ...current, unit: draft.unit };
  const fill = (name: CustomFoodField, value: string | null) => {
    if (value === null || value === '') return;
    fields[name] = value;
    read.push(name);
  };
  fill('name', draft.name);
  fill('brand', draft.brand);
  fill('kcal', draft.kcal === null ? null : field(draft.kcal, locale));
  fill('protein', draft.proteinG === null ? null : field(draft.proteinG, locale));
  fill('carbs', draft.carbsG === null ? null : field(draft.carbsG, locale));
  fill('fat', draft.fatG === null ? null : field(draft.fatG, locale));
  fill('fiber', draft.fiberG === null ? null : field(draft.fiberG, locale));
  fill('servingGrams', draft.servingGrams === null ? null : field(draft.servingGrams, locale));
  return { fields, read };
}
