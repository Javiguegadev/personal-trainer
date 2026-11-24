import type { MealItem, Nutrients } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import {
  dailyTotals,
  itemNutrition,
  mealTotals,
  portionGrams,
  remaining,
  showsFoodNumbers,
} from './nutrition';

/** Whole egg per 100 g (rounded CIQUAL-like values). */
const EGG: Nutrients = { kcal: 155, proteinG: 12.6, carbsG: 1.1, fatG: 10.6, fiberG: null };
const SERVINGS = [
  { id: '00000000-0000-4000-8000-000000000001', label: '1 huevo mediano', grams: 60 },
  { id: '00000000-0000-4000-8000-000000000002', label: '1 huevo grande', grams: 70 },
];

const item = (over: Partial<MealItem> & { nutrients: Nutrients }): MealItem => ({
  id: '10000000-0000-4000-8000-000000000000',
  localDate: '2026-11-16',
  mealType: 'breakfast',
  foodId: null,
  servingId: null,
  servings: null,
  servingLabel: null,
  grams: null,
  unit: 'g',
  label: 'x',
  inputMethod: 'search',
  plannedItemId: null,
  recordedAt: '2026-11-16T08:00:00.000Z',
  ...over,
});

describe('itemNutrition (AC9)', () => {
  it('scales the values per 100 g to the portion', () => {
    expect(itemNutrition(EGG, 120)).toEqual({
      kcal: 186,
      proteinG: 15.12,
      carbsG: 1.32,
      fatG: 12.72,
      fiberG: null,
    });
  });

  it('rounds to two decimals and keeps a known fiber value', () => {
    const bread: Nutrients = { kcal: 258, proteinG: 8.47, carbsG: 51.3, fatG: 1.33, fiberG: 3.53 };
    expect(itemNutrition(bread, 33)).toEqual({
      kcal: 85.14,
      proteinG: 2.8,
      carbsG: 16.93,
      fatG: 0.44,
      fiberG: 1.16,
    });
  });
});

describe('portionGrams (AC8)', () => {
  it('multiplies the serving by the number of servings', () => {
    expect(
      portionGrams({ kind: 'serving', servingId: SERVINGS[0]!.id, servings: 2 }, SERVINGS),
    ).toBe(120);
    expect(
      portionGrams({ kind: 'serving', servingId: SERVINGS[1]!.id, servings: 1.5 }, SERVINGS),
    ).toBe(105);
  });

  it('returns the grams of a grams portion', () => {
    expect(portionGrams({ kind: 'grams', grams: 85 }, SERVINGS)).toBe(85);
  });

  it('returns null for a serving the food does not have', () => {
    expect(
      portionGrams(
        { kind: 'serving', servingId: '00000000-0000-4000-8000-000000000009', servings: 1 },
        SERVINGS,
      ),
    ).toBeNull();
  });
});

describe('dailyTotals and mealTotals (AC16)', () => {
  const items = [
    item({
      mealType: 'breakfast',
      nutrients: { kcal: 186, proteinG: 15.12, carbsG: 1.32, fatG: 12.72, fiberG: null },
    }),
    item({
      mealType: 'breakfast',
      nutrients: { kcal: 85.14, proteinG: 2.8, carbsG: 16.93, fatG: 0.44, fiberG: 1.16 },
    }),
    item({
      mealType: 'lunch',
      nutrients: { kcal: 600, proteinG: 30, carbsG: 70, fatG: 20, fiberG: 6 },
    }),
  ];

  it('sums the snapshots without rounding', () => {
    expect(dailyTotals(items)).toEqual({
      kcal: 871.14,
      proteinG: 47.92,
      carbsG: 88.25,
      fatG: 33.16,
      fiberG: 7.16,
    });
  });

  it('gives zeros and a null fiber for an empty day', () => {
    expect(dailyTotals([])).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null });
  });

  it('groups by meal, with every meal present', () => {
    const totals = mealTotals(items);
    expect(Object.keys(totals)).toEqual([
      'breakfast',
      'mid_morning',
      'lunch',
      'afternoon_snack',
      'dinner',
      'other',
    ]);
    expect(totals.breakfast.kcal).toBeCloseTo(271.14, 6);
    expect(totals.lunch.kcal).toBe(600);
    expect(totals.dinner).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null });
  });
});

describe('remaining (AC16)', () => {
  const targets = { kcal: 2200, proteinG: 130, carbsG: 250, fatG: 70 };

  it('is the target minus what was eaten', () => {
    expect(
      remaining(targets, { kcal: 1550, proteinG: 80, carbsG: 200, fatG: 50, fiberG: null }),
    ).toEqual({ kcal: 650, proteinG: 50, carbsG: 50, fatG: 20 });
  });

  it('goes negative above the target', () => {
    expect(
      remaining(targets, { kcal: 2350, proteinG: 140, carbsG: 250, fatG: 80, fiberG: 20 }),
    ).toEqual({ kcal: -150, proteinG: -10, carbsG: 0, fatG: -10 });
  });
});

describe('showsFoodNumbers (AC18)', () => {
  it('hides every number with ed_soft_stop', () => {
    expect(showsFoodNumbers(['ed_soft_stop'])).toBe(false);
    expect(showsFoodNumbers(['teen_limited', 'ed_soft_stop'])).toBe(false);
  });

  it('shows them otherwise', () => {
    expect(showsFoodNumbers([])).toBe(true);
    expect(showsFoodNumbers(['pregnancy', 'teen_limited'])).toBe(true);
  });
});
