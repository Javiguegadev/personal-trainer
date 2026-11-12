import { describe, expect, it } from 'vitest';
import { LengthMeasurementSchema, ProfileInputSchema, type ProfileInput } from './profile';

const valid: ProfileInput = {
  sex: 'female',
  birthDate: '1995-04-12',
  heightCm: 165,
  weightKg: 62.5,
  targetWeightKg: null,
  activityLevel: 'moderate',
  goal: 'lose',
  injuries: null,
  healthFlags: [],
  units: 'metric',
  locale: 'es',
  dietaryPrefs: { dietType: 'omnivore', allergies: ['gluten'], dislikes: [], restrictions: [] },
  today: '2026-11-11',
};

describe('ProfileInputSchema (AC22)', () => {
  it('accepts a valid profile', () => {
    expect(ProfileInputSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ['heightCm', 119],
    ['heightCm', 231],
    ['weightKg', 29],
    ['weightKg', 301],
  ] as const)('rejects implausible %s = %d', (field, value) => {
    const result = ProfileInputSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it('rejects a malformed birth date', () => {
    expect(ProfileInputSchema.safeParse({ ...valid, birthDate: '12/04/1995' }).success).toBe(false);
  });
});

describe('LengthMeasurementSchema', () => {
  it('accepts feet + inches', () => {
    expect(LengthMeasurementSchema.parse({ unit: 'ft_in', feet: 5, inches: 10 })).toBeTruthy();
  });
});
