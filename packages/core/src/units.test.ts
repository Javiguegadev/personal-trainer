import { describe, expect, it } from 'vitest';
import { cmToFeetInches, cmToInch, inchToCm, kgToLb, lbToKg, roundTo } from './units';

describe('roundTo', () => {
  it('rounds to 1 decimal by default', () => {
    expect(roundTo(72.456)).toBe(72.5);
  });

  it('handles float edge cases', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
  });

  it('rounds to integers', () => {
    expect(roundTo(99.5, 0)).toBe(100);
  });
});

describe('weight conversion', () => {
  it('converts lb to kg', () => {
    expect(roundTo(lbToKg(225), 2)).toBe(102.06);
  });

  it('round-trips kg -> lb -> kg', () => {
    expect(lbToKg(kgToLb(80))).toBeCloseTo(80, 10);
  });
});

describe('length conversion', () => {
  it('converts inches to cm', () => {
    expect(inchToCm(70)).toBeCloseTo(177.8, 10);
  });

  it('round-trips cm -> in -> cm', () => {
    expect(inchToCm(cmToInch(180))).toBeCloseTo(180, 10);
  });
});

describe('cmToFeetInches', () => {
  it('splits centimetres into feet and rounded inches', () => {
    expect(cmToFeetInches(177.8)).toEqual({ feet: 5, inches: 10 });
    expect(cmToFeetInches(160)).toEqual({ feet: 5, inches: 3 });
  });

  it('carries 12 rounded inches into the next foot', () => {
    // 182.6 cm = 71.9 in → 72 in = 6 ft 0 in, never 5 ft 12 in.
    expect(cmToFeetInches(182.6)).toEqual({ feet: 6, inches: 0 });
  });
});
