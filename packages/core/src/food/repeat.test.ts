import type { MealItem } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { repeatMeal, repeatableMeal } from './repeat';

const YESTERDAY = '2026-11-15';
const TODAY = '2026-11-16';
const RECORDED_AT = '2026-11-16T08:30:00.000Z';
const FOOD = 'f0000000-0000-4000-8000-000000000001';
const SERVING = 'a0000000-0000-4000-8000-000000000001';

const base: Omit<MealItem, 'id' | 'recordedAt'> = {
  localDate: YESTERDAY,
  mealType: 'breakfast',
  foodId: null,
  servingId: null,
  servings: null,
  servingLabel: null,
  grams: null,
  label: 'x',
  nutrients: { kcal: 100, proteinG: 1, carbsG: 2, fatG: 3, fiberG: null },
  inputMethod: 'search',
};

const items: MealItem[] = [
  {
    ...base,
    id: 'i2',
    recordedAt: '2026-11-15T08:05:00.000Z',
    foodId: FOOD,
    grams: 250,
    label: 'Leche semidesnatada',
    nutrients: { kcal: 115, proteinG: 8, carbsG: 12, fatG: 4, fiberG: 0 },
  },
  {
    ...base,
    id: 'i1',
    recordedAt: '2026-11-15T08:00:00.000Z',
    foodId: FOOD,
    servingId: SERVING,
    servings: 2,
    servingLabel: '1 huevo',
    grams: 120,
    label: 'Huevo',
    nutrients: { kcal: 186, proteinG: 15, carbsG: 1, fatG: 13, fiberG: null },
  },
  {
    ...base,
    id: 'i3',
    recordedAt: '2026-11-15T08:10:00.000Z',
    label: 'Bollo de la cafetería',
    inputMethod: 'quick_add',
    nutrients: { kcal: 220, proteinG: 4, carbsG: 30, fatG: 9, fiberG: null },
  },
  {
    ...base,
    id: 'i4',
    recordedAt: '2026-11-15T14:00:00.000Z',
    mealType: 'lunch',
    foodId: FOOD,
    grams: 100,
  },
  {
    ...base,
    id: 'i5',
    recordedAt: '2026-11-14T08:00:00.000Z',
    localDate: '2026-11-14',
    foodId: FOOD,
    grams: 100,
  },
];

describe('repeatMeal (AC13)', () => {
  const ids = ['n1', 'n2', 'n3'];
  const result = repeatMeal({
    items,
    mealType: 'breakfast',
    from: YESTERDAY,
    to: TODAY,
    ids,
    recordedAt: RECORDED_AT,
    today: TODAY,
  });

  it("copies the meal's items of the day before, in their order, with new ids", () => {
    expect(result.map((r) => r.id)).toEqual(ids);
  });

  it('gives a preview of each copy for the optimistic log', () => {
    expect(result[0]!.preview).toEqual({
      ...items[1],
      id: 'n1',
      localDate: TODAY,
      recordedAt: RECORDED_AT,
      inputMethod: 'repeat',
    });
  });

  it('keeps the portion of catalog items, so the API computes the snapshot again', () => {
    expect(result[0]!.request).toEqual({
      kind: 'food',
      foodId: FOOD,
      portion: { kind: 'serving', servingId: SERVING, servings: 2 },
      inputMethod: 'repeat',
      localDate: TODAY,
      mealType: 'breakfast',
      recordedAt: RECORDED_AT,
      today: TODAY,
      locale: 'es',
    });
    expect(result[1]!.request).toMatchObject({
      kind: 'food',
      portion: { kind: 'grams', grams: 250 },
    });
  });

  it('copies a quick add as it is', () => {
    expect(result[2]!.request).toEqual({
      kind: 'quick_add',
      label: 'Bollo de la cafetería',
      kcal: 220,
      proteinG: 4,
      carbsG: 30,
      fatG: 9,
      inputMethod: 'repeat',
      localDate: TODAY,
      mealType: 'breakfast',
      recordedAt: RECORDED_AT,
      today: TODAY,
      locale: 'es',
    });
  });

  it('copies an item whose food left the catalog as a quick add of its snapshot', () => {
    const [copy] = repeatMeal({
      items: [{ ...items[0]!, foodId: null }],
      mealType: 'breakfast',
      from: YESTERDAY,
      to: TODAY,
      ids: ['n1'],
      recordedAt: RECORDED_AT,
      today: TODAY,
      locale: 'es',
    });
    expect(copy!.request).toMatchObject({
      kind: 'quick_add',
      label: 'Leche semidesnatada',
      kcal: 115,
    });
  });

  it('needs one id per item', () => {
    expect(() =>
      repeatMeal({
        items,
        mealType: 'breakfast',
        from: YESTERDAY,
        to: TODAY,
        ids: ['n1'],
        recordedAt: RECORDED_AT,
        today: TODAY,
      }),
    ).toThrow();
  });
});

describe('repeatableMeal (AC13)', () => {
  it('offers the items of the day before when the meal is empty on the day', () => {
    const offer = repeatableMeal(items, 'breakfast', TODAY);
    expect(offer).toEqual({ count: 3, kcal: 521 });
  });

  it('offers nothing when the meal already has items', () => {
    const today = { ...items[0]!, id: 't1', localDate: TODAY };
    expect(repeatableMeal([...items, today], 'breakfast', TODAY)).toBeNull();
  });

  it('offers nothing when the day before has no items in that meal', () => {
    expect(repeatableMeal(items, 'dinner', TODAY)).toBeNull();
  });
});
