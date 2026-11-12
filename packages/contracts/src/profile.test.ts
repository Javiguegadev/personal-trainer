import { describe, expect, it } from 'vitest';
import {
  LengthMeasurementSchema,
  ProfileInputSchema,
  type PlannedActivity,
  type ProfileInput,
} from './profile';

const valid: ProfileInput = {
  sex: 'female',
  birthDate: '1995-04-12',
  heightCm: 165,
  weightKg: 62.5,
  targetWeightKg: null,
  jobActivity: 'sedentary',
  plannedActivities: [],
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

describe('ProfileInputSchema: job and weekly training (spec 002 AC1–AC4)', () => {
  const gym: PlannedActivity = {
    kind: 'strength',
    label: null,
    sessionsPerWeek: 3,
    minutesPerSession: 60,
    intensity: 'moderate',
  };
  const withTraining = (plannedActivities: unknown) =>
    ProfileInputSchema.safeParse({ ...valid, plannedActivities });

  it('requires a job option (AC1)', () => {
    expect(ProfileInputSchema.safeParse({ ...valid, jobActivity: undefined }).success).toBe(false);
    expect(ProfileInputSchema.safeParse({ ...valid, jobActivity: 'moderate' }).success).toBe(false);
  });

  it('accepts an empty training list (AC3) and up to 6 activities (AC2)', () => {
    expect(withTraining([]).success).toBe(true);
    const six = Array.from({ length: 6 }, () => ({ ...gym, sessionsPerWeek: 1 }));
    expect(withTraining(six).success).toBe(true);
    expect(withTraining([...six, { ...gym, sessionsPerWeek: 1 }]).success).toBe(false);
  });

  it('accepts an optional name', () => {
    expect(withTraining([{ ...gym, kind: 'sport', label: 'fútbol' }]).success).toBe(true);
    expect(withTraining([{ ...gym, label: 'x'.repeat(41) }]).success).toBe(false);
  });

  it.each([
    ['sessionsPerWeek', 0],
    ['sessionsPerWeek', 15],
    ['sessionsPerWeek', 2.5],
    ['minutesPerSession', 9],
    ['minutesPerSession', 241],
  ] as const)('rejects %s = %d (AC4)', (field, value) => {
    const result = withTraining([{ ...gym, [field]: value }]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['plannedActivities', 0, field]);
  });

  it('rejects more than 1200 minutes of training per week (AC4)', () => {
    const long = { ...gym, sessionsPerWeek: 5, minutesPerSession: 240 };
    expect(withTraining([long]).success).toBe(true); // exactly 1200
    const result = withTraining([long, { ...gym, sessionsPerWeek: 1, minutesPerSession: 10 }]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['plannedActivities'], code: 'too_big' });
  });
});

describe('LengthMeasurementSchema', () => {
  it('accepts feet + inches', () => {
    expect(LengthMeasurementSchema.parse({ unit: 'ft_in', feet: 5, inches: 10 })).toBeTruthy();
  });
});
