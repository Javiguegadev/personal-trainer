import type { MealItem } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { itemToRequest } from './item-request';

const FOOD = 'f0000000-0000-4000-8000-000000000001';
const SERVING = 'a0000000-0000-4000-8000-000000000001';
const placement = {
  localDate: '2026-11-16',
  mealType: 'lunch' as const,
  recordedAt: '2026-11-16T13:00:00.000Z',
  today: '2026-11-16',
  locale: 'es' as const,
};

const item: MealItem = {
  id: 'i1',
  localDate: '2026-11-16',
  mealType: 'breakfast',
  foodId: FOOD,
  servingId: SERVING,
  servings: 2,
  servingLabel: '1 huevo mediano',
  grams: 120,
  unit: 'g',
  label: 'Huevo',
  nutrients: { kcal: 168, proteinG: 15, carbsG: 0.6, fatG: 11, fiberG: 0 },
  inputMethod: 'favourite',
  plannedItemId: null,
  recordedAt: '2026-11-16T08:00:00.000Z',
};

describe('itemToRequest (AC11, AC13)', () => {
  it('writes a catalog item again with its serving portion and input method', () => {
    expect(itemToRequest(item, placement)).toEqual({
      kind: 'food',
      foodId: FOOD,
      portion: { kind: 'serving', servingId: SERVING, servings: 2 },
      inputMethod: 'favourite',
      ...placement,
    });
  });

  it('uses grams when the item has no serving, and the given input method', () => {
    const grams = { ...item, servingId: null, servings: null, servingLabel: null };
    expect(itemToRequest(grams, placement, 'repeat')).toMatchObject({
      kind: 'food',
      portion: { kind: 'grams', grams: 120 },
      inputMethod: 'repeat',
    });
  });

  it('writes a quick add, or an item whose food left the catalog, from its snapshot', () => {
    const quick: MealItem = {
      ...item,
      foodId: null,
      servingId: null,
      servings: null,
      servingLabel: null,
      grams: null,
      label: 'Bollo',
      inputMethod: 'quick_add',
    };
    expect(itemToRequest(quick, placement)).toEqual({
      kind: 'quick_add',
      label: 'Bollo',
      kcal: 168,
      proteinG: 15,
      carbsG: 0.6,
      fatG: 11,
      inputMethod: 'quick_add',
      ...placement,
    });
    expect(itemToRequest({ ...item, foodId: null }, placement)).toMatchObject({
      kind: 'quick_add',
      label: 'Huevo',
      inputMethod: 'quick_add',
    });
  });
});
