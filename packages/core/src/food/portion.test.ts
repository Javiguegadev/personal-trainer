import { CATALOG_FOOD_FIELDS, type Food } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import {
  formatPortion,
  gramsFieldFromPortion,
  initialPortion,
  parseGramsField,
  portionPreview,
  targetProgress,
} from './portion';

const EGG = '11111111-1111-4111-8111-111111111111';
const DOZEN = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const egg: Food = {
  id: '00000000-0000-4000-8000-000000000001',
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
const noServings: Food = { ...egg, servings: [] };

describe('initialPortion (AC8)', () => {
  it('preselects one of the first serving', () => {
    expect(initialPortion(egg, null)).toEqual({ kind: 'serving', servingId: EGG, servings: 1 });
  });

  it('keeps the serving and quantity used the last time', () => {
    const last = { kind: 'serving', servingId: DOZEN, servings: 1.5 } as const;
    expect(initialPortion(egg, last)).toEqual(last);
  });

  it('keeps the grams used the last time', () => {
    expect(initialPortion(egg, { kind: 'grams', grams: 85 })).toEqual({ kind: 'grams', grams: 85 });
  });

  it('falls back to the first serving when the last one left the catalog', () => {
    expect(initialPortion(egg, { kind: 'serving', servingId: OTHER, servings: 3 })).toEqual({
      kind: 'serving',
      servingId: EGG,
      servings: 1,
    });
  });

  it('opens with 100 g for a food without servings', () => {
    expect(initialPortion(noServings, null)).toEqual({ kind: 'grams', grams: 100 });
  });
});

describe('portionPreview (AC8)', () => {
  it('computes grams and nutrients of a number of servings', () => {
    expect(portionPreview(egg, { kind: 'serving', servingId: EGG, servings: 2 })).toEqual({
      servings: 2,
      servingLabel: '1 huevo mediano',
      grams: 120,
      nutrients: { kcal: 168, proteinG: 15.24, carbsG: 0.36, fatG: 11.76, fiberG: 0 },
    });
  });

  it('computes the nutrients of grams', () => {
    expect(portionPreview(egg, { kind: 'grams', grams: 50 })).toMatchObject({
      servings: null,
      servingLabel: null,
      grams: 50,
      nutrients: { kcal: 70 },
    });
  });

  it('is null for a serving the food does not have', () => {
    expect(portionPreview(egg, { kind: 'serving', servingId: OTHER, servings: 1 })).toBeNull();
  });
});

describe('formatPortion', () => {
  it('shows the serving alone for one serving', () => {
    expect(formatPortion({ servings: 1, servingLabel: '1 huevo mediano', grams: 60 }, 'es')).toBe(
      '1 huevo mediano (60 g)',
    );
  });

  it('multiplies the serving, with the locale decimal separator', () => {
    const portion = { servings: 1.5, servingLabel: '1 taza', grams: 300 };
    expect(formatPortion(portion, 'es')).toBe('1,5 × 1 taza (300 g)');
    expect(formatPortion(portion, 'en')).toBe('1.5 × 1 taza (300 g)');
  });

  it('shows grams alone, to one decimal at most', () => {
    expect(formatPortion({ servings: null, servingLabel: null, grams: 152.5 }, 'es')).toBe(
      '152,5 g',
    );
  });

  it('is null for a quick add (no grams)', () => {
    expect(formatPortion({ servings: null, servingLabel: null, grams: null }, 'es')).toBeNull();
  });
});

describe('parseGramsField (AC8: 1–2000 g)', () => {
  it('accepts a decimal comma and rounds to one decimal', () => {
    expect(parseGramsField('152,54')).toEqual({ ok: true, grams: 152.5 });
    expect(parseGramsField(' 2000 ')).toEqual({ ok: true, grams: 2000 });
  });

  it('rejects an empty field, text and values out of range', () => {
    expect(parseGramsField('')).toEqual({ ok: false, error: 'required' });
    expect(parseGramsField('abc')).toEqual({ ok: false, error: 'invalid_number' });
    expect(parseGramsField('0,4')).toEqual({ ok: false, error: 'too_small' });
    expect(parseGramsField('2001')).toEqual({ ok: false, error: 'too_big' });
  });
});

describe('gramsFieldFromPortion', () => {
  it('starts the grams field from the grams of the current portion', () => {
    expect(
      gramsFieldFromPortion(egg, { kind: 'serving', servingId: EGG, servings: 2.5 }, 'es'),
    ).toBe('150');
    expect(gramsFieldFromPortion(egg, { kind: 'grams', grams: 82.5 }, 'es')).toBe('82,5');
  });
});

describe('targetProgress (AC16)', () => {
  it('is the share of the target eaten, capped at 1', () => {
    expect(targetProgress(30, 120)).toBe(0.25);
    expect(targetProgress(150, 120)).toBe(1);
  });

  it('is 0 without a target', () => {
    expect(targetProgress(30, 0)).toBe(0);
  });
});
