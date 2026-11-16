import type { LabelReading } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { labelDraft } from './label';

const reading: LabelReading = {
  status: 'ok',
  basis: 'per_100g',
  servingSize: 30,
  servingUnit: 'g',
  energyKcal: 436,
  energyKj: 1836,
  fatG: 10.5,
  carbsG: 76,
  proteinG: 7.1,
  fiberG: 2.6,
  productName: ' Galletas  María ',
  brand: 'Marca Blanca',
};

describe('labelDraft (spec 006 AC15)', () => {
  it('copies the values printed per 100 g', () => {
    expect(labelDraft(reading)).toEqual({
      status: 'ok',
      draft: {
        name: 'Galletas María',
        brand: 'Marca Blanca',
        unit: 'g',
        kcal: 436,
        proteinG: 7.1,
        carbsG: 76,
        fatG: 10.5,
        fiberG: 2.6,
        servingGrams: 30,
      },
    });
  });

  it('converts kJ when the label has no kcal', () => {
    const result = labelDraft({ ...reading, energyKcal: null });
    expect(result).toMatchObject({ status: 'ok', draft: { kcal: 438.81 } });
  });

  it('converts values printed per serving with the size of the serving', () => {
    const result = labelDraft({
      ...reading,
      basis: 'per_serving',
      servingSize: 30,
      energyKcal: 131,
      fatG: 3.2,
      carbsG: 22.8,
      proteinG: 2.1,
      fiberG: null,
    });
    expect(result).toMatchObject({
      status: 'ok',
      draft: { unit: 'g', kcal: 436.67, fatG: 10.67, carbsG: 76, proteinG: 7, fiberG: null },
    });
  });

  it('cannot convert per-serving values without the size of the serving', () => {
    expect(labelDraft({ ...reading, basis: 'per_serving', servingSize: null })).toEqual({
      status: 'unreadable',
      reason: 'cut_off',
    });
  });

  it('uses millilitres for a label per 100 ml, and for a serving in ml', () => {
    expect(
      labelDraft({ ...reading, basis: 'per_100ml', servingUnit: 'ml', servingSize: 200 }),
    ).toMatchObject({ status: 'ok', draft: { unit: 'ml', servingGrams: 200 } });
    expect(
      labelDraft({ ...reading, basis: 'per_serving', servingUnit: 'ml', servingSize: 200 }),
    ).toMatchObject({ status: 'ok', draft: { unit: 'ml', kcal: 218 } });
  });

  it('drops a serving in another unit than the values', () => {
    const result = labelDraft({ ...reading, basis: 'per_100ml', servingUnit: 'g' });
    expect(result).toMatchObject({ status: 'ok', draft: { unit: 'ml', servingGrams: null } });
  });

  it('leaves a value outside its range empty instead of correcting it', () => {
    const result = labelDraft({ ...reading, energyKcal: 4360, fatG: 105, proteinG: -1 });
    expect(result).toMatchObject({
      status: 'ok',
      draft: { kcal: null, fatG: null, proteinG: null, carbsG: 76 },
    });
  });

  it('keeps what was not read as null', () => {
    const result = labelDraft({
      ...reading,
      fiberG: null,
      productName: null,
      brand: '  ',
      servingSize: null,
      servingUnit: null,
    });
    expect(result).toMatchObject({
      status: 'ok',
      draft: { fiberG: null, name: null, brand: null, servingGrams: null },
    });
  });

  it('is unreadable when the model says so, with its reason', () => {
    for (const status of ['not_a_label', 'blurry', 'cut_off'] as const) {
      expect(labelDraft({ ...reading, status })).toEqual({ status: 'unreadable', reason: status });
    }
  });

  it('is unreadable when none of the four required values was read', () => {
    const empty = { energyKcal: null, energyKj: null, fatG: null, carbsG: null, proteinG: null };
    expect(labelDraft({ ...reading, ...empty })).toEqual({
      status: 'unreadable',
      reason: 'cut_off',
    });
    expect(labelDraft({ ...reading, basis: null })).toEqual({
      status: 'unreadable',
      reason: 'cut_off',
    });
  });

  it('truncates a long name', () => {
    const result = labelDraft({ ...reading, productName: 'x'.repeat(200) });
    expect(result.status === 'ok' && result.draft.name).toHaveLength(80);
  });
});
