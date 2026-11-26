import { EMPTY_WEEK, ProfileInputSchema, type DietaryPrefs, type Profile } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { profileInputWithout } from './about';

const profile: Profile = {
  sex: 'female',
  birthDate: '1990-05-01',
  heightCm: 165,
  // 70,3 kg is 155 lb: shown in pounds and read back it would become 70,31 kg.
  weightKg: 70.3,
  targetWeightKg: 62,
  jobActivity: 'standing',
  plannedActivities: [
    {
      kind: 'sport',
      label: 'fútbol',
      sessionsPerWeek: 2,
      minutesPerSession: 90,
      intensity: 'hard',
      days: [
        { weekday: 2, startMinute: 1140, isMatch: false },
        { weekday: 6, startMinute: null, isMatch: true },
      ],
    },
  ],
  requestedGoal: 'lose',
  goal: 'maintain',
  trainingFocus: 'sport_performance',
  safetyFlags: ['medical_condition', 'calorie_floor', 'injury'],
  injuries: 'rodilla',
  units: 'imperial',
  locale: 'es',
  onboardingCompletedAt: '2026-11-11T10:00:00.000Z',
  week: EMPTY_WEEK,
  trainingExperience: null,
  equipmentAccess: null,
  energyCalibrationKcal: -100,
};

const prefs: DietaryPrefs = {
  dietType: 'vegetarian',
  allergies: ['nueces'],
  dislikes: ['coliflor'],
  restrictions: ['sin cerdo'],
};

describe('profileInputWithout (spec 014 AC12)', () => {
  it('keeps every stored value exactly, with the requested goal and the reported flags only', () => {
    const input = profileInputWithout(profile, prefs, 'injuries', '2026-12-07')!;
    expect(ProfileInputSchema.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({
      weightKg: 70.3,
      targetWeightKg: 62,
      goal: 'lose',
      trainingFocus: 'sport_performance',
      healthFlags: ['medical_condition'],
      units: 'imperial',
      plannedActivities: profile.plannedActivities,
      dietaryPrefs: prefs,
      today: '2026-12-07',
    });
  });

  it('clears only the item asked for', () => {
    const cleared = (item: Parameters<typeof profileInputWithout>[2]) =>
      profileInputWithout(profile, prefs, item, '2026-12-07')!;
    expect(cleared('targetWeight')).toMatchObject({ targetWeightKg: null, injuries: 'rodilla' });
    expect(cleared('injuries')).toMatchObject({ injuries: null, targetWeightKg: 62 });
    expect(cleared('allergies').dietaryPrefs).toEqual({ ...prefs, allergies: [] });
    expect(cleared('dislikes').dietaryPrefs).toEqual({ ...prefs, dislikes: [] });
  });

  it('gives nothing for a profile that cannot be saved as it is', () => {
    expect(
      profileInputWithout({ ...profile, jobActivity: null }, prefs, 'injuries', '2026-12-07'),
    ).toBeNull();
    expect(profileInputWithout(profile, null, 'injuries', '2026-12-07')).toBeNull();
  });
});
