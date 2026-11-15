import { describe, expect, it } from 'vitest';
import { quickAddEnergyMismatch } from './quick-add';

describe('quickAddEnergyMismatch (AC10)', () => {
  it('flags macros whose energy exceeds the kcal by more than 20 %', () => {
    // 4·10 + 4·10 + 9·5 = 125 > 120
    expect(quickAddEnergyMismatch({ kcal: 100, proteinG: 10, carbsG: 10, fatG: 5 })).toBe(true);
  });

  it('accepts up to exactly 20 % above', () => {
    // 4·10 + 4·10 + 9·4 = 116, and 4·30 = 120 is exactly the edge
    expect(quickAddEnergyMismatch({ kcal: 100, proteinG: 10, carbsG: 10, fatG: 4 })).toBe(false);
    expect(quickAddEnergyMismatch({ kcal: 100, proteinG: 30, carbsG: 0, fatG: 0 })).toBe(false);
  });

  it('never flags macros below the kcal, or no macros', () => {
    expect(quickAddEnergyMismatch({ kcal: 500, proteinG: 10, carbsG: null, fatG: null })).toBe(
      false,
    );
    expect(quickAddEnergyMismatch({ kcal: 300, proteinG: null, carbsG: null, fatG: null })).toBe(
      false,
    );
  });

  it('flags any macro energy on 0 kcal', () => {
    expect(quickAddEnergyMismatch({ kcal: 0, proteinG: 1, carbsG: null, fatG: null })).toBe(true);
  });
});
