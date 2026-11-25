import type {
  CalibrationResetResponse,
  Profile,
  ReviewDecisionRequest,
  ReviewDecisionResponse,
  ReviewResponse,
} from '@pt/contracts';
import {
  addDays,
  applyCalibration,
  blocksDecrease,
  evaluateStoredProfile,
  loggingStreak,
  reviewWeekToShow,
  weeklyReview,
} from '@pt/core';
import type { CalibrationWrite, Deps, ReviewDecisionResult } from '../deps';

/** Weeks of logs the streak reads back (a longer streak shows as this many weeks). */
const STREAK_WEEKS = 52;
/** Reviews before the latest one shown on the review screen. */
const HISTORY = 4;

type StoredProfile = Profile & { jobActivity: NonNullable<Profile['jobActivity']> };

/** The profile a review needs: one from before spec 002 without a job cannot be reviewed. */
async function storedProfile(deps: Deps, userId: string): Promise<StoredProfile | null> {
  const { profile } = await deps.store.getMe(userId);
  if (!profile || profile.jobActivity === null) return null;
  return { ...profile, jobActivity: profile.jobActivity };
}

/**
 * The profile evaluated with another calibration (AC6, AC12): the same safety rules and targets as a
 * weight change, with the last 7 days of the log for the low-BMI recovery rule.
 */
async function evaluateWith(
  deps: Deps,
  userId: string,
  profile: StoredProfile,
  calibrationKcal: number,
  today: string,
) {
  const context = await deps.store.getSafetyContext(userId, addDays(today, -6));
  return evaluateStoredProfile(
    { ...profile, energyCalibrationKcal: calibrationKcal },
    profile.weightKg,
    today,
    context.weights,
  );
}

/**
 * `GET /me/review` (AC1, AC2, AC9): the streak, and the review of the last complete week, computed and
 * stored on its first read (only that week: no backfill).
 */
export async function getReview(
  deps: Deps,
  userId: string,
  today: string,
): Promise<ReviewResponse> {
  const profile = await storedProfile(deps, userId);
  const flags = profile?.safetyFlags ?? [];
  const loggedDays = await deps.store.listLoggedDays(
    userId,
    addDays(today, -7 * STREAK_WEEKS),
    today,
  );
  const streak = loggingStreak({ loggedDays, today, flags });
  const empty: ReviewResponse = { review: null, history: [], firstReviewOn: null, streak };
  if (!profile?.onboardingCompletedAt) return empty;

  const { weekStart, firstReviewOn } = reviewWeekToShow({
    today,
    onboardedOn: profile.onboardingCompletedAt.slice(0, 10),
    flags,
  });
  if (!weekStart) return { ...empty, firstReviewOn };

  const stored = await deps.store.listWeeklyReviews(userId, HISTORY + 1);
  let review = stored.find((r) => r.weekStart === weekStart) ?? null;
  if (!review) {
    const sunday = addDays(weekStart, 6);
    const [mealItems, workouts, weights, checkins, targets, calibratedAt] = await Promise.all([
      deps.store.listMealItems(userId, addDays(weekStart, -7), sunday),
      deps.store.listWorkouts(userId, weekStart, sunday),
      deps.store.listWeights(userId, addDays(weekStart, -14), today),
      deps.store.listCheckins(userId, weekStart, sunday),
      deps.store.listTargetsHistory(userId),
      deps.store.getCalibrationChange(userId),
    ]);
    const draft = weeklyReview({
      weekStart,
      today,
      profile,
      mealItems,
      workouts,
      weights,
      checkins,
      // The targets history starts at a server time: its UTC day is close enough for a week's average.
      targetsHistory: targets.map((t) => ({ kcal: t.kcal, fromDate: t.validFrom.slice(0, 10) })),
      calibratedOn: calibratedAt ? calibratedAt.toISOString().slice(0, 10) : null,
    });
    if (!draft) return empty;
    review = await deps.store.insertWeeklyReview(userId, draft, deps.now());
  }
  const history = stored.filter((r) => r.weekStart < weekStart).slice(0, HISTORY);
  return { review, history, firstReviewOn: null, streak };
}

export type DecisionResult =
  ReviewDecisionResponse | Exclude<ReviewDecisionResult, 'ok'> | 'no_profile';

/**
 * `POST /me/review/{weekStart}/decision` (AC6). "Aplicar" evaluates the profile again with the new
 * calibration at the moment of the tap: the bound and the protected profiles are checked again
 * (domain review), and a decision that no longer holds is `stale`.
 */
export async function decideReview(
  deps: Deps,
  userId: string,
  weekStart: string,
  request: ReviewDecisionRequest,
): Promise<DecisionResult> {
  const profile = await storedProfile(deps, userId);
  if (!profile) return 'no_profile';
  const review = (await deps.store.listWeeklyReviews(userId, HISTORY + 1)).find(
    (r) => r.weekStart === weekStart,
  );
  if (!review) return 'not_found';
  if (review.status !== 'proposed' || !review.proposal) return 'decided';

  let calibration: CalibrationWrite | null = null;
  if (request.decision === 'accept') {
    const { kcalDelta } = review.proposal;
    const stored = profile.energyCalibrationKcal;
    const base = blocksDecrease(profile.safetyFlags) ? Math.max(0, stored) : stored;
    const next = applyCalibration(base, kcalDelta);
    if (next === null) return 'stale';
    const evaluation = await evaluateWith(deps, userId, profile, next, request.today);
    if (evaluation.kind !== 'ok') return 'no_profile';
    if (kcalDelta < 0 && blocksDecrease(evaluation.flags)) return 'stale';
    calibration = {
      calibrationKcal: next,
      evaluation: {
        goal: evaluation.safety.appliedGoal,
        safetyFlags: evaluation.flags,
        targets: evaluation.targets,
      },
    };
  }

  const result = await deps.store.decideWeeklyReview(
    userId,
    weekStart,
    request.decision === 'accept' ? 'accepted' : 'rejected',
    deps.now(),
    calibration,
  );
  if (result !== 'ok') return result;
  const [decided] = (await deps.store.listWeeklyReviews(userId, HISTORY + 1)).filter(
    (r) => r.weekStart === weekStart,
  );
  return { review: decided!, targets: (await deps.store.getMe(userId)).targets };
}

/** `DELETE /me/energy-calibration` ("Volver al cálculo inicial", AC12): back to 0, targets again. */
export async function resetCalibration(
  deps: Deps,
  userId: string,
  today: string,
): Promise<CalibrationResetResponse | 'no_profile'> {
  const profile = await storedProfile(deps, userId);
  if (!profile) return 'no_profile';
  const evaluation = await evaluateWith(deps, userId, profile, 0, today);
  if (evaluation.kind !== 'ok') return 'no_profile';
  const saved = await deps.store.setCalibration(
    userId,
    {
      calibrationKcal: 0,
      evaluation: {
        goal: evaluation.safety.appliedGoal,
        safetyFlags: evaluation.flags,
        targets: evaluation.targets,
      },
    },
    deps.now(),
  );
  if (!saved) return 'no_profile';
  return { targets: (await deps.store.getMe(userId)).targets };
}
