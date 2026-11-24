import type { PlannedActivity } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { profileNotices } from './notices';

describe('profileNotices', () => {
  it('returns nothing for a profile without flags', () => {
    expect(profileNotices({ flags: [] }, { clampedReason: null, carbsG: 250 })).toEqual([]);
  });

  it('orders notices from most to least important', () => {
    expect(
      profileNotices(
        { flags: ['injury', 'teen_limited', 'low_bmi', 'pregnancy', 'ed_soft_stop'] },
        null,
      ),
    ).toEqual(['pregnancy', 'ed_soft_stop', 'low_bmi', 'teen_limited', 'medical_condition']);
  });

  it('explains a clamped calorie target (AC14)', () => {
    expect(profileNotices({ flags: [] }, { clampedReason: 'calorie_floor', carbsG: 127 })).toEqual([
      'calorie_floor',
    ]);
  });

  it('shows one professional-advice notice for injuries and reported conditions (AC21)', () => {
    expect(profileNotices({ flags: ['injury', 'medical_condition'] }, null)).toEqual([
      'medical_condition',
    ]);
  });

  it('explains the activity ceiling and the high training load (spec 002 AC10, AC11)', () => {
    expect(
      profileNotices(
        { flags: ['high_training_load'] },
        { clampedReason: 'activity_ceiling', carbsG: 739 },
      ),
    ).toEqual(['high_training_load', 'activity_ceiling']);
  });

  it('shows low_target_bmi (AC19)', () => {
    expect(profileNotices({ flags: ['low_target_bmi'] }, null)).toEqual(['low_target_bmi']);
  });
});

describe('profileNotices: what the user trains for (spec 004)', () => {
  const football: PlannedActivity = {
    kind: 'sport',
    label: 'fútbol',
    sessionsPerWeek: 6,
    minutesPerSession: 120,
    intensity: 'moderate',
    days: [],
  };
  /** 165 cm, 60 kg, 720 min a week: carbohydrate minimum 5 × 60 = 300 g. */
  const profile = {
    trainingFocus: 'sport_performance' as const,
    goal: 'lose' as const,
    heightCm: 165,
    weightKg: 60,
    plannedActivities: [football],
  };
  const targets = (carbsG: number) => ({ clampedReason: null, carbsG });

  it('says fat loss is slower to protect performance (AC5)', () => {
    expect(profileNotices({ flags: [] }, targets(302), profile)).toEqual(['performance_deficit']);
    expect(profileNotices({ flags: [] }, targets(302), { ...profile, goal: 'maintain' })).toEqual(
      [],
    );
    expect(
      profileNotices({ flags: [] }, targets(302), { ...profile, trainingFocus: 'strength' }),
    ).toEqual([]);
  });

  it('says when the calories cannot cover the carbohydrates the training needs (AC8)', () => {
    const maintain = { ...profile, goal: 'maintain' as const };
    expect(profileNotices({ flags: [] }, targets(300), maintain)).toEqual([]);
    expect(
      profileNotices({ flags: [] }, targets(10), { ...maintain, trainingFocus: 'hypertrophy' }),
    ).toEqual([]);
    // Losing fat: the deficit is what leaves the carbohydrates short, so "keep my weight" helps.
    expect(profileNotices({ flags: [] }, targets(299), profile)).toEqual([
      'carbs_below_sport_minimum',
      'performance_deficit',
    ]);
  });

  it('without a deficit, a carbohydrate shortfall points to a professional, not to a goal (AC8)', () => {
    // Keeping or gaining weight already: suggesting "keep my weight" would do nothing, or cut calories.
    for (const goal of ['maintain', 'gain'] as const) {
      expect(profileNotices({ flags: [] }, targets(299), { ...profile, goal })).toEqual([
        'sport_underfuelling',
      ]);
    }
  });

  it('orders them with the other training notices', () => {
    expect(
      profileNotices(
        { flags: ['high_training_load', 'injury'] },
        { clampedReason: 'calorie_floor', carbsG: 120 },
        profile,
      ),
    ).toEqual([
      'calorie_floor',
      'carbs_below_sport_minimum',
      'high_training_load',
      'performance_deficit',
      'medical_condition',
    ]);
  });

  it('says nothing about the focus without numeric targets (pregnancy)', () => {
    expect(profileNotices({ flags: ['pregnancy'] }, null, profile)).toEqual(['pregnancy']);
  });
});
