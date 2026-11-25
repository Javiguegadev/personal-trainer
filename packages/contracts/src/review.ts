import { z } from 'zod';
import { IsoDateSchema, StoredTargetsSchema } from './profile';

/**
 * The weekly review (spec 014). PROVISIONAL: every band, step and threshold here waits for the
 * professional review (spec 014 Open questions). Changing one means a new `version`.
 */
export const REVIEW_RULES = {
  version: 'review-v1',
  /** Days since onboarding before the first review (AC1). */
  minHistoryDays: 14,
  /** One proposal changes the calibration by this much (AC3). */
  stepKcal: 100,
  /** The accumulated calibration stays within ± this (AC5). */
  calibrationMaxKcal: 300,
  /** Weights a week needs for its 7-day average (AC4). */
  minWeightsPerWeek: 3,
  /** Days with food logged in the reviewed week and the week before (AC4). */
  minFoodDays: 5,
  /** The average logged intake must be within this share of the target (AC4). */
  intakeTolerance: 0.1,
  /** A night under this many minutes counts as little sleep (AC5). */
  poorSleepMinutes: 360,
  /** Days with little sleep or high stress that block a decrease (AC5). */
  sleepStressDays: 3,
  /**
   * Weight rate bands per goal, as a share of body weight per week (AC3). The rate is the change of
   * the 7-day average from two weeks before, divided by two.
   */
  bands: {
    lose: { slowBelow: 0.0015, fastAbove: 0.01 },
    maintain: { driftBeyond: 0.002 },
    gain: { slowBelow: 0.001, fastAbove: 0.005 },
  },
} as const;

/** A streak counts weeks with at least this many days with something logged (spec 014 AC9). */
export const STREAK_RULES = { daysPerWeek: 4 } as const;

export const ReviewStatusSchema = z.enum(['proposed', 'no_change', 'accepted', 'rejected']);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

/** Why the review proposes what it does, or nothing (AC3–AC5). */
export const ReviewReasonSchema = z.enum([
  'on_track',
  'slow_loss',
  'fast_loss',
  'drift_up',
  'drift_down',
  'slow_gain',
  'fast_gain',
  'not_enough_weights',
  'not_enough_logging',
  'off_target_intake',
  'decrease_blocked_sleep_stress',
  'at_floor',
  'calibration_limit',
]);
export type ReviewReason = z.infer<typeof ReviewReasonSchema>;

/** What the review shows about its week (AC2). Null where there is no data. */
export const ReviewSummarySchema = z.object({
  /** Days with a meal item, a workout or a weight (0–7). */
  daysLogged: z.number().int().min(0).max(7),
  foodDays: z.number().int().min(0).max(7),
  /** Average kcal of the days with food logged. */
  averageKcal: z.number().int().nullable(),
  /** The kcal target that applied at the end of the week; null without numeric targets. */
  targetKcal: z.number().int().nullable(),
  /** 7-day average weight of the week. */
  weightAverageKg: z.number().nullable(),
  /** Change of the 7-day average per week, from two weeks before (kg, and share of body weight). */
  weightRateKgPerWeek: z.number().nullable(),
  weightRatePerWeek: z.number().nullable(),
  workouts: z.number().int().min(0),
  workoutMinutes: z.number().int().min(0),
  checkinDays: z.number().int().min(0).max(7),
  poorSleepDays: z.number().int().min(0).max(7),
  highStressDays: z.number().int().min(0).max(7),
});
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

/** A proposed change of the daily kcal target (AC3, AC6). */
export const ReviewProposalSchema = z
  .object({
    kcalDelta: z.number().int(),
    fromKcal: z.number().int(),
    toKcal: z.number().int(),
  })
  .refine((p) => p.kcalDelta !== 0, {
    path: ['kcalDelta'],
    message: 'A proposal changes the kcal',
  });
export type ReviewProposal = z.infer<typeof ReviewProposalSchema>;

const datetime = z.iso.datetime({ offset: true });

/** The review of one week (Monday to Sunday), stored with the numbers it used (AC7). */
export const WeeklyReviewSchema = z.object({
  /** The Monday of the reviewed week. */
  weekStart: IsoDateSchema,
  status: ReviewStatusSchema,
  summary: ReviewSummarySchema,
  proposal: ReviewProposalSchema.nullable(),
  reasons: z.array(ReviewReasonSchema),
  rulesVersion: z.string(),
  createdAt: datetime,
  decidedAt: datetime.nullable(),
});
export type WeeklyReview = z.infer<typeof WeeklyReviewSchema>;

/** Weeks in a row with something logged on at least 4 days (AC9, AC10). */
export const StreakSchema = z.object({
  weeks: z.number().int().min(0),
  /** Days with something logged in the current week so far. */
  currentWeekDays: z.number().int().min(0).max(7),
  /** True with `ed_soft_stop`: the app shows no streak (AC10). */
  hidden: z.boolean(),
});
export type Streak = z.infer<typeof StreakSchema>;

/** `GET /me/review?today=`: the user's local date. */
export const ReviewQuerySchema = z.object({ today: IsoDateSchema });
export type ReviewQuery = z.infer<typeof ReviewQuerySchema>;

export const ReviewResponseSchema = z.object({
  /** The latest review; null before the first one, or for `ed_soft_stop` and pregnancy (AC1). */
  review: WeeklyReviewSchema.nullable(),
  /** The reviews before it, newest first (at most 4), for the review screen. */
  history: z.array(WeeklyReviewSchema),
  /** The Monday the first review becomes available; null once there is one, or when there is none. */
  firstReviewOn: IsoDateSchema.nullable(),
  streak: StreakSchema,
});
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;

/** `POST /me/review/{weekStart}/decision` (AC6). */
export const ReviewDecisionRequestSchema = z.object({
  decision: z.enum(['accept', 'reject']),
  /** The user's local date, for the targets recomputed on "Aplicar". */
  today: IsoDateSchema,
});
export type ReviewDecisionRequest = z.infer<typeof ReviewDecisionRequestSchema>;

export const ReviewDecisionResponseSchema = z.object({
  review: WeeklyReviewSchema,
  /** The current targets after the decision (unchanged on "Ahora no"). */
  targets: StoredTargetsSchema.nullable(),
});
export type ReviewDecisionResponse = z.infer<typeof ReviewDecisionResponseSchema>;

/** `DELETE /me/energy-calibration?today=` ("Volver al cálculo inicial", AC12). */
export const CalibrationResetResponseSchema = z.object({
  targets: StoredTargetsSchema.nullable(),
});
export type CalibrationResetResponse = z.infer<typeof CalibrationResetResponseSchema>;
