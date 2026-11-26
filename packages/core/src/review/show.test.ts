import type { WeeklyReview } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { reviewToShow } from './show';

const review = (overrides: Partial<WeeklyReview> = {}): WeeklyReview => ({
  weekStart: '2026-11-30',
  status: 'proposed',
  summary: {
    daysLogged: 7,
    foodDays: 7,
    averageKcal: 2200,
    targetKcal: 2200,
    weightAverageKg: 70,
    weightRateKgPerWeek: 0,
    weightRatePerWeek: 0,
    workouts: 0,
    workoutMinutes: 0,
    checkinDays: 0,
    poorSleepDays: 0,
    highStressDays: 0,
  },
  proposal: { kcalDelta: -100, fromKcal: 2200, toKcal: 2120 },
  reasons: ['slow_loss'],
  rulesVersion: 'review-v1',
  createdAt: '2026-12-07T08:00:00.000Z',
  decidedAt: null,
  ...overrides,
});

describe('reviewToShow (spec 014 AC1)', () => {
  it('shows a proposal until the user decides on it', () => {
    expect(reviewToShow({ review: review() }, null)).toEqual(review());
    // "Entendido" belongs to reviews without a proposal: it never hides one.
    expect(reviewToShow({ review: review() }, '2026-11-30')).toEqual(review());
    for (const status of ['accepted', 'rejected'] as const) {
      const decided = review({ status, decidedAt: '2026-12-07T09:00:00.000Z' });
      expect(reviewToShow({ review: decided }, null)).toBeNull();
    }
  });

  it('shows a review without a proposal until "Entendido" on that week', () => {
    const quiet = review({ status: 'no_change', proposal: null, reasons: ['on_track'] });
    expect(reviewToShow({ review: quiet }, null)).toEqual(quiet);
    expect(reviewToShow({ review: quiet }, '2026-11-30')).toBeNull();
    // The dismissal of an older week does not hide a newer one.
    expect(reviewToShow({ review: quiet }, '2026-11-23')).toEqual(quiet);
  });

  it('shows nothing without a review or a response', () => {
    expect(reviewToShow({ review: null }, null)).toBeNull();
    expect(reviewToShow(undefined, null)).toBeNull();
    expect(reviewToShow({ review: review({ proposal: null }) }, null)).toBeNull();
  });
});
