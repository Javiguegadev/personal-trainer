import { describe, expect, it } from 'vitest';
import { proteinGPerKg, referenceWeightKg, sportCarbsMinimum } from './focus';

describe('sportCarbsMinimum (spec 004 AC7)', () => {
  it.each([
    [0, 3],
    [419, 3],
    [420, 5],
    [839, 5],
    [840, 6],
    [1200, 6],
  ])('%d planned minutes a week → %d g/kg', (minutes, gPerKg) => {
    expect(sportCarbsMinimum('sport_performance', minutes, 60)).toEqual({
      gPerKg,
      grams: gPerKg * 60,
    });
  });

  it('rounds the grams of a non-round reference weight', () => {
    // 5 × 76.5625 = 382.8 → 383
    expect(sportCarbsMinimum('sport_performance', 500, 76.5625)).toEqual({
      gPerKg: 5,
      grams: 383,
    });
  });

  it.each(['hypertrophy', 'strength', 'general_fitness', null] as const)(
    'is null for %s',
    (focus) => {
      expect(sportCarbsMinimum(focus, 900, 60)).toBeNull();
    },
  );
});

describe('proteinGPerKg (spec 004 AC6)', () => {
  it('follows the table, with health and general fitness for a missing focus', () => {
    expect(proteinGPerKg('hypertrophy', 'lose')).toBe(2.0);
    expect(proteinGPerKg('strength', 'gain')).toBe(1.8);
    expect(proteinGPerKg('sport_performance', 'lose')).toBe(1.8);
    expect(proteinGPerKg(null, 'maintain')).toBe(1.6);
  });
});

describe('referenceWeightKg', () => {
  it('is the actual weight below BMI 30 and the BMI-25 weight from it', () => {
    expect(referenceWeightKg(175, 80)).toBe(80);
    // 30 × 1.75² = 91.875 → exactly BMI 30 → 25 × 1.75² = 76.5625
    expect(referenceWeightKg(175, 91.875)).toBeCloseTo(76.5625, 6);
  });
});
