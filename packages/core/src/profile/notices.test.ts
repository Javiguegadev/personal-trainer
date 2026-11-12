import { describe, expect, it } from 'vitest';
import { profileNotices } from './notices';

describe('profileNotices', () => {
  it('returns nothing for a profile without flags', () => {
    expect(profileNotices({ flags: [] }, { clampedReason: null })).toEqual([]);
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
    expect(profileNotices({ flags: [] }, { clampedReason: 'calorie_floor' })).toEqual([
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
      profileNotices({ flags: ['high_training_load'] }, { clampedReason: 'activity_ceiling' }),
    ).toEqual(['high_training_load', 'activity_ceiling']);
  });

  it('shows low_target_bmi (AC19)', () => {
    expect(profileNotices({ flags: ['low_target_bmi'] }, null)).toEqual(['low_target_bmi']);
  });
});
