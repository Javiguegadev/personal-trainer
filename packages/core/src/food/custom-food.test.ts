import type { CustomFoodUpsertRequest, LabelDraft } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_CUSTOM_FOOD_FIELDS,
  checkCustomFood,
  customFoodAsFood,
  customFoodEnergyMismatch,
  customFoodFields,
  customFoodFieldsFromDraft,
  customFoodRequest,
  isOwnFood,
  parseCustomFoodFields,
  searchableBrandedFood,
  type CustomFoodFields,
} from './custom-food';
import { buildFoodSearchIndex, searchFoods } from './search';

const ID = '50000000-0000-4000-8000-000000000001';
const SERVING = '60000000-0000-4000-8000-000000000001';

const context = {
  barcode: null,
  origin: 'manual' as const,
  servingId: SERVING,
  defaultServingLabel: '1 ración',
};

const yogurt: CustomFoodFields = {
  name: ' Yogur natural ',
  brand: 'La Granja',
  unit: 'g',
  kcal: '61',
  protein: '3,5',
  carbs: '4,7',
  fat: '3.1',
  fiber: '',
  servingLabel: '',
  servingGrams: '125',
};

const request: CustomFoodUpsertRequest = {
  name: 'Yogur natural',
  brand: 'La Granja',
  unit: 'g',
  per100g: { kcal: 61, proteinG: 3.5, carbsG: 4.7, fatG: 3.1, fiberG: null },
  serving: { id: SERVING, label: '1 ración', grams: 125 },
  barcode: null,
  origin: 'manual',
};

describe('parseCustomFoodFields (spec 006 AC9, AC10)', () => {
  it('reads the form, with a decimal comma or point', () => {
    expect(parseCustomFoodFields(yogurt, context)).toEqual({ ok: true, request });
  });

  it('keeps the barcode and the origin of the form', () => {
    const parsed = parseCustomFoodFields(yogurt, {
      ...context,
      barcode: '3017620422003',
      origin: 'label',
    });
    expect(parsed).toMatchObject({
      ok: true,
      request: { barcode: '3017620422003', origin: 'label' },
    });
  });

  it('has no serving and no brand when they are empty', () => {
    const parsed = parseCustomFoodFields({ ...yogurt, brand: ' ', servingGrams: '' }, context);
    expect(parsed).toMatchObject({ ok: true, request: { brand: null, serving: null } });
  });

  it('uses the typed name of the serving', () => {
    const parsed = parseCustomFoodFields({ ...yogurt, servingLabel: '1 tarrina' }, context);
    expect(parsed).toMatchObject({
      ok: true,
      request: { serving: { id: SERVING, label: '1 tarrina', grams: 125 } },
    });
  });

  it('requires the name and the four values, and accepts zero', () => {
    expect(parseCustomFoodFields(EMPTY_CUSTOM_FOOD_FIELDS, context)).toEqual({
      ok: false,
      errors: {
        name: 'required',
        kcal: 'required',
        protein: 'required',
        carbs: 'required',
        fat: 'required',
      },
    });
    const water = { ...yogurt, kcal: '0', protein: '0', carbs: '0', fat: '0', fiber: '0' };
    expect(parseCustomFoodFields(water, context)).toMatchObject({
      ok: true,
      request: { per100g: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 } },
    });
  });

  it('applies the ranges per 100 g or ml', () => {
    const errors = (over: Partial<CustomFoodFields>) => {
      const parsed = parseCustomFoodFields({ ...yogurt, ...over }, context);
      return parsed.ok ? null : parsed.errors;
    };
    expect(errors({ kcal: '901' })).toEqual({ kcal: 'too_big' });
    expect(errors({ fat: '100,5' })).toEqual({ fat: 'too_big' });
    expect(errors({ fiber: '101' })).toEqual({ fiber: 'too_big' });
    expect(errors({ protein: 'mucho' })).toEqual({ protein: 'invalid_number' });
    expect(errors({ protein: '-1' })).toEqual({ protein: 'invalid_number' });
    expect(errors({ name: 'x'.repeat(81) })).toEqual({ name: 'too_long' });
    expect(errors({ brand: 'x'.repeat(61) })).toEqual({ brand: 'too_long' });
    expect(errors({ servingGrams: '0,5' })).toEqual({ servingGrams: 'too_small' });
    expect(errors({ servingGrams: '2001' })).toEqual({ servingGrams: 'too_big' });
    expect(errors({ servingLabel: 'x'.repeat(41) })).toEqual({ servingLabel: 'too_long' });
  });

  it('asks for the size of a serving that has a name', () => {
    const parsed = parseCustomFoodFields(
      { ...yogurt, servingLabel: '1 tarrina', servingGrams: '' },
      context,
    );
    expect(parsed).toEqual({ ok: false, errors: { servingGrams: 'required' } });
  });

  it('rejects macros that add to more than 105 g per 100 g', () => {
    const parsed = parseCustomFoodFields(
      { ...yogurt, protein: '40', carbs: '40', fat: '30' },
      context,
    );
    expect(parsed).toEqual({ ok: false, errors: { macros: 'too_big' } });
  });
});

describe('checkCustomFood (AC10)', () => {
  it('accepts plausible values', () => {
    expect(checkCustomFood(request)).toBeNull();
  });

  it('rejects macros above 105 g per 100 g', () => {
    const per100g = { kcal: 500, proteinG: 40, carbsG: 40, fatG: 30, fiberG: null };
    expect(checkCustomFood({ per100g })).toEqual({ per100g: 'macros_too_high' });
  });
});

describe('customFoodEnergyMismatch (AC10)', () => {
  it('is true when the energy is away from the macros by more than 20 %', () => {
    // Macros: 4·3.5 + 4·4.7 + 9·3.1 = 60.7 kcal
    expect(customFoodEnergyMismatch(request.per100g)).toBe(false);
    expect(customFoodEnergyMismatch({ ...request.per100g, kcal: 610 })).toBe(true);
    expect(customFoodEnergyMismatch({ ...request.per100g, kcal: 6 })).toBe(true);
  });
});

describe('customFoodAsFood', () => {
  const food = customFoodAsFood(ID, request);

  it('builds the food the API returns', () => {
    expect(food).toEqual({
      id: ID,
      key: `user-${ID}`,
      name: 'Yogur natural',
      per100g: request.per100g,
      servings: [{ id: SERVING, label: '1 ración', grams: 125 }],
      source: 'user',
      origin: 'manual',
      unit: 'g',
      brand: 'La Granja',
      barcode: null,
      allergens: [],
      traces: [],
      sourceUrl: null,
      energyMismatch: false,
    });
    expect(customFoodAsFood(ID, { ...request, serving: null }).servings).toEqual([]);
  });

  it('round-trips through the request and the form', () => {
    expect(customFoodRequest(food)).toEqual(request);
    const fields = customFoodFields(food, 'es');
    expect(fields).toMatchObject({ kcal: '61', protein: '3,5', fiber: '', servingGrams: '125' });
    expect(parseCustomFoodFields(fields, context)).toEqual({ ok: true, request });
  });

  it('tells own foods from the catalog and scanned products', () => {
    expect(isOwnFood(food)).toBe(true);
    expect(isOwnFood({ origin: 'label' })).toBe(true);
    expect(isOwnFood({ origin: 'off' })).toBe(false);
    expect(isOwnFood({ origin: 'catalog' })).toBe(false);
  });
});

describe('customFoodFieldsFromDraft (AC16)', () => {
  const draft: LabelDraft = {
    name: 'Galletas María',
    brand: null,
    unit: 'g',
    kcal: 436,
    proteinG: 7.1,
    carbsG: null,
    fatG: 10.5,
    fiberG: null,
    servingGrams: 30,
  };

  it('fills what the photo read and says which fields', () => {
    const { fields, read } = customFoodFieldsFromDraft(draft, EMPTY_CUSTOM_FOOD_FIELDS, 'es');
    expect(fields).toEqual({
      ...EMPTY_CUSTOM_FOOD_FIELDS,
      name: 'Galletas María',
      kcal: '436',
      protein: '7,1',
      fat: '10,5',
      servingGrams: '30',
    });
    expect(read).toEqual(['name', 'kcal', 'protein', 'fat', 'servingGrams']);
  });

  it('keeps what the user typed where the photo read nothing, and takes the unit of the label', () => {
    const typed = { ...EMPTY_CUSTOM_FOOD_FIELDS, brand: 'Marca', carbs: '70', kcal: '1' };
    const { fields } = customFoodFieldsFromDraft({ ...draft, unit: 'ml' }, typed, 'en');
    expect(fields).toMatchObject({
      brand: 'Marca',
      carbs: '70',
      kcal: '436',
      protein: '7.1',
      unit: 'ml',
    });
  });
});

describe('searchableBrandedFood (AC11)', () => {
  const foods = [
    {
      id: 'curated',
      nameEs: 'Yogur natural',
      nameEn: 'Plain yogurt',
      synonymsEs: [],
      popularity: 9,
    },
  ];
  const own = [searchableBrandedFood({ id: 'own', name: 'Yogur natural', brand: 'La Granja' })];
  const index = buildFoodSearchIndex(foods);
  const extra = buildFoodSearchIndex(own);

  it('finds an own food by its name, its brand, or both', () => {
    expect(searchFoods(index, 'granja', 'es', 25, extra)).toEqual(['own']);
    expect(searchFoods(index, 'la granja yogur', 'es', 25, extra)).toEqual(['own']);
    expect(searchFoods(index, 'yogur la granja', 'es', 25, extra)).toEqual(['own']);
  });

  it('ranks the own food before the curated one at the same match', () => {
    expect(searchFoods(index, 'yogur natural', 'es', 25, extra)).toEqual(['own', 'curated']);
    expect(searchFoods(index, 'yogur natural', 'es', 25)).toEqual(['curated']);
  });
});
