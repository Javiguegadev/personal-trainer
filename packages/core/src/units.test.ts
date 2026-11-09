import { describe, expect, it } from 'vitest';
import { cmToInch, inchToCm, kgToLb, lbToKg, roundTo } from './units';

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
