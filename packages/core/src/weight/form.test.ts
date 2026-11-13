import { describe, expect, it } from 'vitest';
import {
  checkWeightDate,
  parseWeightField,
  stepWeightField,
  weightDayOptions,
  weightFieldFromKg,
  weightNeedingConfirmation,
} from './form';

const TODAY = '2026-11-13';

describe('weight field (spec 003 AC6)', () => {
  it('shows at most one decimal in the user units, with the locale separator', () => {
    expect(weightFieldFromKg(80, 'metric', 'es')).toBe('80');
    expect(weightFieldFromKg(80.25, 'metric', 'es')).toBe('80,3');
    expect(weightFieldFromKg(79.6, 'metric', 'en')).toBe('79.6');
    // 80 kg = 176.37 lb
    expect(weightFieldFromKg(80, 'imperial', 'en')).toBe('176.4');
  });

  it('steps by 0.1 kg or 0.2 lb without floating-point noise', () => {
    expect(stepWeightField('79,9', 'metric', 'es', 1)).toBe('80');
    expect(stepWeightField('80', 'metric', 'es', -1)).toBe('79,9');
    expect(stepWeightField('176.4', 'imperial', 'en', 1)).toBe('176.6');
    expect(stepWeightField('176.4', 'imperial', 'en', -1)).toBe('176.2');
  });

  it('leaves an empty or unreadable field alone', () => {
    expect(stepWeightField('', 'metric', 'es', 1)).toBe('');
    expect(stepWeightField('abc', 'metric', 'es', 1)).toBe('abc');
  });
});

describe('parseWeightField (AC7)', () => {
  it('reads kilograms with a decimal comma or point', () => {
    expect(parseWeightField('79,6', 'metric')).toEqual({ ok: true, weightKg: 79.6 });
    expect(parseWeightField(' 80.25 ', 'metric')).toEqual({ ok: true, weightKg: 80.3 });
  });

  it('converts pounds to kilograms', () => {
    // 176.4 lb × 0.45359237 = 80.01 → 80.0
    expect(parseWeightField('176.4', 'imperial')).toEqual({ ok: true, weightKg: 80 });
  });

  it.each([
    ['', 'required'],
    ['ochenta', 'invalid_number'],
    ['29,9', 'too_small'],
    ['300,1', 'too_big'],
  ] as const)('rejects "%s" as %s', (text, error) => {
    expect(parseWeightField(text, 'metric')).toEqual({ ok: false, error });
  });

  it('accepts the limits themselves', () => {
    expect(parseWeightField('30', 'metric')).toEqual({ ok: true, weightKg: 30 });
    expect(parseWeightField('300', 'metric')).toEqual({ ok: true, weightKg: 300 });
  });
});

describe('weight day (AC6, AC7)', () => {
  it('offers today and the 6 days before', () => {
    expect(weightDayOptions(TODAY)).toEqual([
      '2026-11-13',
      '2026-11-12',
      '2026-11-11',
      '2026-11-10',
      '2026-11-09',
      '2026-11-08',
      '2026-11-07',
    ]);
  });

  it('rejects the future and days more than 5 years ago', () => {
    expect(checkWeightDate(TODAY, TODAY)).toBeNull();
    expect(checkWeightDate('2026-11-14', TODAY)).toBe('in_future');
    expect(checkWeightDate('2022-01-01', TODAY)).toBeNull();
    expect(checkWeightDate('2021-11-01', TODAY)).toBe('too_old');
  });
});

describe('weightNeedingConfirmation (AC7)', () => {
  const entries = [
    { localDate: '2026-11-01', weightKg: 85 },
    { localDate: '2026-11-10', weightKg: 80 },
    { localDate: '2026-11-12', weightKg: 79.6 },
  ];

  it('asks when the weight is more than 3 % from the latest entry of the 7 days before', () => {
    // 70.6 against 79.6: 11.3 %
    expect(weightNeedingConfirmation(70.6, TODAY, entries)).toBe(79.6);
    // 82.1 against 79.6: 3.1 %
    expect(weightNeedingConfirmation(82.1, TODAY, entries)).toBe(79.6);
  });

  it('does not ask within 3 %', () => {
    // 77.3 against 79.6: 2.9 %
    expect(weightNeedingConfirmation(77.3, TODAY, entries)).toBeNull();
    expect(weightNeedingConfirmation(79.6, TODAY, entries)).toBeNull();
  });

  it('compares with the entries before the chosen day, not with that day or later ones', () => {
    // Editing 12 November: the previous entry is 10 November (80 kg).
    expect(weightNeedingConfirmation(79.6, '2026-11-12', entries)).toBeNull();
    expect(weightNeedingConfirmation(70, '2026-11-12', entries)).toBe(80);
  });

  it('does not ask without an entry in the 7 days before', () => {
    expect(weightNeedingConfirmation(60, TODAY, [entries[0]!])).toBeNull();
    expect(weightNeedingConfirmation(60, TODAY, [])).toBeNull();
  });
});
