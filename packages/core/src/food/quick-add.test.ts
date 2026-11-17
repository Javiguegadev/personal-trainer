import { describe, expect, it } from 'vitest';
import { parseQuickAddFields, quickAddEnergyMismatch } from './quick-add';

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

describe('parseQuickAddFields (AC10)', () => {
  const fields = { label: ' Menú del día ', kcal: '850', protein: '', carbs: '', fat: '' };

  it('needs only a name and the kcal; empty macros are null', () => {
    expect(parseQuickAddFields(fields)).toEqual({
      ok: true,
      values: { label: 'Menú del día', kcal: 850, proteinG: null, carbsG: null, fatG: null },
    });
  });

  it('reads macros with a decimal comma', () => {
    expect(
      parseQuickAddFields({ ...fields, protein: '32,5', carbs: '90', fat: '0' }),
    ).toMatchObject({
      ok: true,
      values: { proteinG: 32.5, carbsG: 90, fatG: 0 },
    });
  });

  it('reports every field that is wrong', () => {
    expect(
      parseQuickAddFields({ label: ' ', kcal: '', protein: 'x', carbs: '501', fat: '-1' }),
    ).toEqual({
      ok: false,
      errors: {
        label: 'required',
        kcal: 'required',
        protein: 'invalid_number',
        carbs: 'too_big',
        fat: 'invalid_number',
      },
    });
  });

  it('limits the name to 80 characters and the kcal to 5000', () => {
    expect(parseQuickAddFields({ ...fields, label: 'a'.repeat(81), kcal: '5001' })).toEqual({
      ok: false,
      errors: { label: 'too_long', kcal: 'too_big' },
    });
    expect(parseQuickAddFields({ ...fields, label: 'a'.repeat(80), kcal: '5000' }).ok).toBe(true);
  });
});
