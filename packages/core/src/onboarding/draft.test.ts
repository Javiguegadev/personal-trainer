import { describe, expect, it } from 'vitest';
import { applyDraftToolInput, isPlausibleClientDate, missingDraftFields } from './draft';

const T = '2026-11-11';

describe('applyDraftToolInput (AC9, AC22)', () => {
  it('converts imperial measurements to metric', () => {
    const { draft, invalid } = applyDraftToolInput(
      {},
      { height: { unit: 'ft_in', feet: 5, inches: 10 }, weight: { unit: 'lb', value: 180 } },
      T,
    );
    expect(invalid).toEqual([]);
    expect(draft.heightCm).toBe(177.8);
    expect(draft.weightKg).toBe(81.6);
  });

  it('accepts metres ("1,75 m" → 175 cm)', () => {
    expect(applyDraftToolInput({}, { height: { unit: 'm', value: 1.75 } }, T).draft.heightCm).toBe(
      175,
    );
  });

  it('keeps earlier fields and overwrites the ones the AI sends again', () => {
    const { draft } = applyDraftToolInput(
      { sex: 'female', weightKg: 60 },
      { weight: { unit: 'kg', value: 61 } },
      T,
    );
    expect(draft).toEqual({ sex: 'female', weightKg: 61 });
  });

  it('drops implausible values and reports them', () => {
    const { draft, invalid } = applyDraftToolInput(
      { heightCm: 170 },
      { height: { unit: 'cm', value: 17 }, weight: { unit: 'kg', value: 900 } },
      T,
    );
    expect(draft.heightCm).toBe(170);
    expect(draft.weightKg).toBeUndefined();
    expect(invalid).toEqual(['heightCm', 'weightKg']);
  });

  it('rejects a birth date in the future', () => {
    const { invalid } = applyDraftToolInput({}, { birthDate: '2030-01-01' }, '2026-11-11');
    expect(invalid).toEqual(['birthDate']);
  });
});

describe('missingDraftFields', () => {
  it('lists required fields not yet collected, in order', () => {
    expect(missingDraftFields({ sex: 'male', heightCm: 180 })).toEqual([
      'birthDate',
      'weightKg',
      'activityLevel',
      'goal',
      'dietType',
    ]);
  });
});

describe('isPlausibleClientDate', () => {
  const now = '2026-11-11T23:30:00.000Z';
  it('accepts today, yesterday and tomorrow (time zones)', () => {
    expect(isPlausibleClientDate('2026-11-11', now)).toBe(true);
    expect(isPlausibleClientDate('2026-11-12', now)).toBe(true);
    expect(isPlausibleClientDate('2026-11-10', now)).toBe(true);
  });
  it('rejects dates further away', () => {
    expect(isPlausibleClientDate('2026-11-13', now)).toBe(false);
    expect(isPlausibleClientDate('2025-11-11', now)).toBe(false);
  });
});

describe('applyDraftToolInput — age instead of birth date', () => {
  it('derives a birth date that gives exactly that age today', () => {
    const { draft } = applyDraftToolInput({}, { ageYears: 17 }, '2026-11-11');
    expect(draft.birthDate).toBe('2009-11-11');
  });
  it('prefers an explicit birth date over an age', () => {
    const { draft } = applyDraftToolInput({}, { ageYears: 30, birthDate: '1990-05-05' }, '2026-11-11');
    expect(draft.birthDate).toBe('1990-05-05');
  });
});

describe('applyDraftToolInput — allergies never shrink from the chat (allergen safety)', () => {
  it('adds new allergies to the earlier ones, ignoring case and duplicates', () => {
    const { draft } = applyDraftToolInput(
      { allergies: ['Gluten', 'cacahuete'] },
      { allergies: ['gluten', 'marisco'] },
      T,
    );
    expect(draft.allergies).toEqual(['Gluten', 'cacahuete', 'marisco']);
  });
  it('an empty list from the AI does not erase allergies', () => {
    const { draft } = applyDraftToolInput({ allergies: ['gluten'] }, { allergies: [] }, T);
    expect(draft.allergies).toEqual(['gluten']);
  });
});
