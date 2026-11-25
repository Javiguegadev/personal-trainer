import { describe, expect, it } from 'vitest';
import { ProfileSchema } from './profile';
import {
  REVIEW_RULES,
  ReviewDecisionRequestSchema,
  ReviewProposalSchema,
  ReviewResponseSchema,
  WeeklyReviewSchema,
} from './review';

const summary = {
  daysLogged: 6,
  foodDays: 6,
  averageKcal: 2180,
  targetKcal: 2200,
  weightAverageKg: 78.2,
  weightRateKgPerWeek: -0.05,
  weightRatePerWeek: -0.0006,
  workouts: 3,
  workoutMinutes: 180,
  checkinDays: 4,
  poorSleepDays: 0,
  highStressDays: 1,
};

const review = {
  weekStart: '2026-11-16',
  status: 'proposed' as const,
  summary,
  proposal: { kcalDelta: -100, fromKcal: 2200, toKcal: 2100 },
  reasons: ['slow_loss' as const],
  rulesVersion: REVIEW_RULES.version,
  createdAt: '2026-11-23T08:00:00.000Z',
  decidedAt: null,
};

describe('weekly review contracts (spec 014)', () => {
  it('accepts a review with a proposal and its numbers', () => {
    expect(WeeklyReviewSchema.parse(review)).toEqual(review);
  });

  it('refuses a proposal that changes nothing', () => {
    expect(
      ReviewProposalSchema.safeParse({ kcalDelta: 0, fromKcal: 2200, toKcal: 2200 }).success,
    ).toBe(false);
  });

  it('reads a response without a review yet, with the date of the first one', () => {
    const parsed = ReviewResponseSchema.parse({
      review: null,
      history: [],
      firstReviewOn: '2026-12-07',
      streak: { weeks: 0, currentWeekDays: 2, hidden: false },
    });
    expect(parsed.firstReviewOn).toBe('2026-12-07');
  });

  it('takes only accept or reject, with the local date', () => {
    expect(
      ReviewDecisionRequestSchema.safeParse({ decision: 'accept', today: '2026-11-25' }).success,
    ).toBe(true);
    expect(
      ReviewDecisionRequestSchema.safeParse({ decision: 'later', today: '2026-11-25' }).success,
    ).toBe(false);
  });

  it('reads a profile stored before spec 014 with no calibration', () => {
    const profile = ProfileSchema.shape.energyCalibrationKcal.parse(undefined);
    expect(profile).toBe(0);
  });
});
