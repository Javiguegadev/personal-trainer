import {
  CATALOG_FOOD_FIELDS,
  MEAL_DRAFT_LIMITS,
  type Food,
  type MealReading,
  type MealReadingItem,
} from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { draftTotals, mealDraft, portionForReplacement } from './meal-draft';

const EGG_ID = '00000000-0000-4000-8000-000000000001';
const RICE_ID = '00000000-0000-4000-8000-000000000002';
const OIL_ID = '00000000-0000-4000-8000-000000000003';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000099';
const EGG = '11111111-1111-4111-8111-111111111111';
const DOZEN = '22222222-2222-4222-8222-222222222222';
const SPOON = '44444444-4444-4444-8444-444444444444';

const egg: Food = {
  id: EGG_ID,
  key: 'huevo-entero',
  name: 'Huevo entero',
  per100g: { kcal: 140, proteinG: 12.7, carbsG: 0.3, fatG: 9.8, fiberG: 0 },
  servings: [
    { id: EGG, label: '1 huevo mediano', grams: 60 },
    { id: DOZEN, label: '1 docena', grams: 720 },
  ],
  source: 'ciqual-2025',
  ...CATALOG_FOOD_FIELDS,
};
const rice: Food = {
  ...egg,
  id: RICE_ID,
  key: 'arroz-blanco-cocido',
  name: 'Arroz blanco cocido',
  per100g: { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, fiberG: null },
  servings: [],
};
const oil: Food = {
  ...egg,
  id: OIL_ID,
  key: 'aceite-oliva',
  name: 'Aceite de oliva',
  per100g: { kcal: 900, proteinG: 0, carbsG: 0, fatG: 100, fiberG: 0 },
  servings: [{ id: SPOON, label: '1 cucharada', grams: 10 }],
};

const candidates = new Map([egg, rice, oil].map((f) => [f.id, f]));

const item = (over: Partial<MealReadingItem>): MealReadingItem => ({
  mention: 'dos huevos',
  foodId: EGG_ID,
  servingId: EGG,
  servings: 2,
  grams: null,
  confidence: 'high',
  quantityAssumed: false,
  inferred: false,
  ...over,
});
const ok = (...items: MealReadingItem[]): MealReading => ({ status: 'ok', items });

describe('mealDraft (spec 007 AC4–AC6, AC9, AC10)', () => {
  it('keeps a serving count of a food the tool returned, in the order said', () => {
    const draft = mealDraft(
      ok(
        item({}),
        item({
          mention: '200 g de arroz',
          foodId: RICE_ID,
          servingId: null,
          servings: null,
          grams: 200,
        }),
      ),
      candidates,
    );
    expect(draft).toEqual({
      status: 'ok',
      items: [
        {
          food: egg,
          portion: { kind: 'serving', servingId: EGG, servings: 2 },
          mention: 'dos huevos',
          confidence: 'high',
          quantityAssumed: false,
          inferred: false,
        },
        {
          food: rice,
          portion: { kind: 'grams', grams: 200 },
          mention: '200 g de arroz',
          confidence: 'high',
          quantityAssumed: false,
          inferred: false,
        },
      ],
      unresolved: [],
    });
  });

  it('gives a food said without a quantity its first serving, marked as assumed (AC4)', () => {
    const draft = mealDraft(ok(item({ servingId: null, servings: null, grams: null })), candidates);
    expect(draft.status === 'ok' && draft.items[0]).toMatchObject({
      portion: { kind: 'serving', servingId: EGG, servings: 1 },
      quantityAssumed: true,
    });
  });

  it('gives 100 g to a food without servings and without a quantity (AC4)', () => {
    const draft = mealDraft(
      ok(item({ foodId: RICE_ID, servingId: null, servings: null, grams: null })),
      candidates,
    );
    expect(draft.status === 'ok' && draft.items[0]).toMatchObject({
      portion: { kind: 'grams', grams: 100 },
      quantityAssumed: true,
    });
  });

  it('counts one serving when the serving is named without a count', () => {
    const draft = mealDraft(ok(item({ servings: null })), candidates);
    expect(draft.status === 'ok' && draft.items[0]?.portion).toEqual({
      kind: 'serving',
      servingId: EGG,
      servings: 1,
    });
  });

  it('prefers the serving when the model gives both a serving and grams', () => {
    const draft = mealDraft(ok(item({ grams: 120 })), candidates);
    expect(draft.status === 'ok' && draft.items[0]?.portion.kind).toBe('serving');
  });

  it('turns an id the tool did not return into an unresolved mention (AC6, AC9)', () => {
    const draft = mealDraft(
      ok(
        item({ mention: 'salmorejo de mi abuela', foodId: UNKNOWN_ID }),
        item({ mention: 'gazpacho', foodId: null, servingId: null }),
      ),
      candidates,
    );
    expect(draft).toEqual({
      status: 'ok',
      items: [],
      unresolved: [{ mention: 'salmorejo de mi abuela' }, { mention: 'gazpacho' }],
    });
  });

  it('uses grams, or the default serving, when the serving is not one of the food’s (AC9)', () => {
    const withGrams = mealDraft(ok(item({ servingId: SPOON, grams: 120 })), candidates);
    expect(withGrams.status === 'ok' && withGrams.items[0]).toMatchObject({
      portion: { kind: 'grams', grams: 120 },
    });
    const without = mealDraft(ok(item({ servingId: SPOON, servings: 3 })), candidates);
    expect(without.status === 'ok' && without.items[0]).toMatchObject({
      portion: { kind: 'serving', servingId: EGG, servings: 1 },
      quantityAssumed: true,
    });
  });

  it('rounds servings to halves and clamps portions to the log limits, flagged low (AC9)', () => {
    const draft = mealDraft(
      ok(
        item({ servings: 1.3 }),
        item({ servings: 50 }),
        item({ servings: 0.1 }),
        item({ foodId: RICE_ID, servingId: null, servings: null, grams: 5000 }),
        item({ foodId: RICE_ID, servingId: null, servings: null, grams: 0.2 }),
      ),
      candidates,
    );
    if (draft.status !== 'ok') throw new Error('expected a draft');
    expect(draft.items.map((i) => i.portion)).toEqual([
      { kind: 'serving', servingId: EGG, servings: 1.5 },
      { kind: 'serving', servingId: EGG, servings: 20 },
      { kind: 'serving', servingId: EGG, servings: 0.5 },
      { kind: 'grams', grams: 2000 },
      { kind: 'grams', grams: 1 },
    ]);
    expect(draft.items.map((i) => i.confidence)).toEqual(['high', 'low', 'low', 'low', 'low']);
  });

  it('treats a non-finite or negative number as no quantity', () => {
    const draft = mealDraft(
      ok(
        item({ servings: Number.NaN }),
        item({ foodId: RICE_ID, servingId: null, servings: null, grams: -5 }),
      ),
      candidates,
    );
    if (draft.status !== 'ok') throw new Error('expected a draft');
    expect(draft.items.map((i) => [i.portion, i.quantityAssumed])).toEqual([
      [{ kind: 'serving', servingId: EGG, servings: 1 }, false],
      [{ kind: 'grams', grams: 100 }, true],
    ]);
  });

  it('keeps two mentions of the same food apart', () => {
    const draft = mealDraft(ok(item({}), item({ mention: 'otro huevo', servings: 1 })), candidates);
    expect(draft.status === 'ok' && draft.items.length).toBe(2);
  });

  it('keeps the confidence and the "probable" flag of a photo item (AC5)', () => {
    const draft = mealDraft(
      ok(
        item({
          mention: 'aceite',
          foodId: OIL_ID,
          servingId: SPOON,
          servings: 1,
          confidence: 'low',
          inferred: true,
        }),
      ),
      candidates,
    );
    expect(draft.status === 'ok' && draft.items[0]).toMatchObject({
      confidence: 'low',
      inferred: true,
    });
  });

  it('keeps at most 15 entries, items and unresolved mentions together', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? item({ mention: `huevo ${i}` }) : item({ mention: `x ${i}`, foodId: null }),
    );
    const draft = mealDraft(ok(...many), candidates);
    if (draft.status !== 'ok') throw new Error('expected a draft');
    expect(draft.items.length + draft.unresolved.length).toBe(MEAL_DRAFT_LIMITS.itemsMax);
    expect(draft.items[0]?.mention).toBe('huevo 0');
    expect(draft.unresolved[0]?.mention).toBe('x 1');
  });

  it('trims mentions, cuts long ones, and names an empty one after its food', () => {
    const draft = mealDraft(
      ok(
        item({ mention: '  dos huevos  ' }),
        item({ mention: 'a'.repeat(200) }),
        item({ mention: ' ' }),
      ),
      candidates,
    );
    if (draft.status !== 'ok') throw new Error('expected a draft');
    expect(draft.items.map((i) => i.mention)).toEqual([
      'dos huevos',
      'a'.repeat(MEAL_DRAFT_LIMITS.mentionMax),
      'Huevo entero',
    ]);
  });

  it('drops an unresolved mention without words', () => {
    const draft = mealDraft(ok(item({ mention: '  ', foodId: null })), candidates);
    expect(draft).toEqual({ status: 'unreadable', reason: 'not_food' });
  });

  it('answers unreadable with the reason of the model (AC10)', () => {
    expect(mealDraft({ status: 'not_food', items: [] }, candidates)).toEqual({
      status: 'unreadable',
      reason: 'not_food',
    });
    expect(mealDraft({ status: 'blurry', items: [item({})] }, candidates)).toEqual({
      status: 'unreadable',
      reason: 'blurry',
    });
    expect(mealDraft({ status: 'unclear', items: [] }, candidates)).toEqual({
      status: 'unreadable',
      reason: 'unclear',
    });
  });

  it('answers not_food when an ok reading has no food at all (AC10)', () => {
    expect(mealDraft(ok(), candidates)).toEqual({ status: 'unreadable', reason: 'not_food' });
  });
});

describe('draftTotals (AC7)', () => {
  it('adds the nutrients of every portion, unrounded', () => {
    const draft = mealDraft(
      ok(item({}), item({ foodId: RICE_ID, servingId: null, servings: null, grams: 200 })),
      candidates,
    );
    if (draft.status !== 'ok') throw new Error('expected a draft');
    const totals = draftTotals(draft.items);
    // 2 eggs (120 g): 168 kcal; 200 g rice: 260 kcal.
    expect(totals.kcal).toBeCloseTo(428);
    expect(totals.proteinG).toBeCloseTo(15.24 + 5.4);
    expect(totals.fiberG).toBe(0);
  });

  it('is zero for an empty draft', () => {
    expect(draftTotals([])).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null });
  });
});

describe('portionForReplacement (AC7)', () => {
  const friedEgg: Food = {
    ...egg,
    id: '00000000-0000-4000-8000-000000000010',
    servings: [{ id: '55555555-5555-4555-8555-555555555555', label: '1 huevo mediano', grams: 55 }],
  };

  it('keeps the count of a serving with the same name', () => {
    expect(
      portionForReplacement({ kind: 'serving', servingId: EGG, servings: 2 }, egg, friedEgg),
    ).toEqual({ kind: 'serving', servingId: '55555555-5555-4555-8555-555555555555', servings: 2 });
  });

  it('keeps the grams when the new food has no such serving', () => {
    expect(
      portionForReplacement({ kind: 'serving', servingId: DOZEN, servings: 0.5 }, egg, rice),
    ).toEqual({ kind: 'grams', grams: 360 });
    expect(portionForReplacement({ kind: 'grams', grams: 150 }, rice, egg)).toEqual({
      kind: 'grams',
      grams: 150,
    });
  });
});
