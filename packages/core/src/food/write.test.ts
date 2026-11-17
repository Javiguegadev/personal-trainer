import { CATALOG_FOOD_FIELDS, type Food, type MealItemUpsertRequest } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { checkFoodLogRange, checkFoodLogWrite, mealItemFromRequest, writeWins } from './write';

const NOW = new Date('2026-11-16T10:00:00.000Z');
const TODAY = '2026-11-16';
const ID = '20000000-0000-4000-8000-000000000001';
const SERVING = '30000000-0000-4000-8000-000000000001';

const EGG: Food = {
  id: '40000000-0000-4000-8000-000000000001',
  key: 'd-huevo',
  name: 'Huevo entero',
  per100g: { kcal: 155, proteinG: 12.6, carbsG: 1.1, fatG: 10.6, fiberG: null },
  servings: [{ id: SERVING, label: '1 huevo mediano', grams: 55 }],
  source: 'ciqual-2025',
  ...CATALOG_FOOD_FIELDS,
};

const placement = {
  localDate: TODAY,
  mealType: 'breakfast' as const,
  recordedAt: '2026-11-16T08:00:00.000Z',
  today: TODAY,
  locale: 'es' as const,
};

describe('checkFoodLogWrite (spec 005)', () => {
  it('accepts today and the past year', () => {
    expect(checkFoodLogWrite(placement, NOW)).toBeNull();
    expect(checkFoodLogWrite({ ...placement, localDate: '2025-11-15' }, NOW)).toBeNull();
  });

  it('rejects a future day, a day more than a year back, a far-off today and a clock far ahead', () => {
    expect(checkFoodLogWrite({ ...placement, localDate: '2026-11-17' }, NOW)).toEqual({
      localDate: 'in_future',
    });
    expect(checkFoodLogWrite({ ...placement, localDate: '2025-11-14' }, NOW)).toEqual({
      localDate: 'too_old',
    });
    expect(checkFoodLogWrite({ ...placement, today: '2026-11-19' }, NOW)).toEqual({
      today: 'implausible',
    });
    expect(
      checkFoodLogWrite({ ...placement, recordedAt: '2026-11-17T12:00:00.000Z' }, NOW),
    ).toEqual({ recordedAt: 'in_future' });
  });
});

describe('checkFoodLogRange', () => {
  it('accepts up to 31 days and rejects reversed or longer ranges', () => {
    expect(checkFoodLogRange('2026-10-16', '2026-11-16')).toBeNull();
    expect(checkFoodLogRange('2026-10-15', '2026-11-16')).toEqual({ to: 'too_big' });
    expect(checkFoodLogRange('2026-11-17', '2026-11-16')).toEqual({ from: 'after_to' });
  });
});

describe('mealItemFromRequest (AC9, AC10)', () => {
  it('computes the snapshot of a serving portion from the catalog', () => {
    const request: MealItemUpsertRequest = {
      kind: 'food',
      foodId: EGG.id,
      portion: { kind: 'serving', servingId: SERVING, servings: 2 },
      inputMethod: 'search',
      ...placement,
    };
    expect(mealItemFromRequest(ID, request, EGG)).toEqual({
      id: ID,
      localDate: TODAY,
      mealType: 'breakfast',
      foodId: EGG.id,
      servingId: SERVING,
      servings: 2,
      servingLabel: '1 huevo mediano',
      grams: 110,
      unit: 'g',
      label: 'Huevo entero',
      nutrients: { kcal: 170.5, proteinG: 13.86, carbsG: 1.21, fatG: 11.66, fiberG: null },
      inputMethod: 'search',
      recordedAt: placement.recordedAt,
    });
  });

  it('computes a grams portion', () => {
    const item = mealItemFromRequest(
      ID,
      {
        kind: 'food',
        foodId: EGG.id,
        portion: { kind: 'grams', grams: 50 },
        inputMethod: 'recent',
        ...placement,
      },
      EGG,
    );
    expect(item).toMatchObject({ grams: 50, servingId: null, servings: null, servingLabel: null });
    expect(item).toMatchObject({ nutrients: { kcal: 77.5 } });
  });

  it('reports an unknown food or serving', () => {
    const request: MealItemUpsertRequest = {
      kind: 'food',
      foodId: EGG.id,
      portion: { kind: 'serving', servingId: ID, servings: 1 },
      inputMethod: 'search',
      ...placement,
    };
    expect(mealItemFromRequest(ID, request, null)).toEqual({ error: 'food_not_found' });
    expect(mealItemFromRequest(ID, request, EGG)).toEqual({ error: 'serving_not_found' });
  });

  it('keeps a quick add as typed, with no food and no grams', () => {
    const item = mealItemFromRequest(
      ID,
      {
        kind: 'quick_add',
        label: 'Bocadillo del bar',
        kcal: 450,
        proteinG: 20,
        carbsG: null,
        fatG: null,
        inputMethod: 'quick_add',
        ...placement,
      },
      null,
    );
    expect(item).toMatchObject({
      foodId: null,
      grams: null,
      label: 'Bocadillo del bar',
      nutrients: { kcal: 450, proteinG: 20, carbsG: 0, fatG: 0, fiberG: null },
      inputMethod: 'quick_add',
    });
  });
});

describe('writeWins (AC20)', () => {
  it('lets the later write win, also over a delete', () => {
    expect(writeWins(null, '2026-11-16T08:00:00.000Z')).toBe(true);
    expect(writeWins('2026-11-16T08:00:00.000Z', '2026-11-16T09:00:00.000Z')).toBe(true);
    expect(writeWins('2026-11-16T09:00:00.000Z', '2026-11-16T08:00:00.000Z')).toBe(false);
  });

  it('applies the same write again (a retried request)', () => {
    expect(writeWins('2026-11-16T08:00:00.000Z', '2026-11-16T08:00:00.000Z')).toBe(true);
  });
});
