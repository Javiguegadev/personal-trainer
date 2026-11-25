import {
  REVIEW_RULES,
  type Goal,
  type JobActivity,
  type MealItem,
  type Profile,
  type ReviewProposal,
  type ReviewReason,
  type ReviewSummary,
  type SafetyFlag,
  type WeeklyReview,
  type Workout,
} from '@pt/contracts';
import { latestPerDay, type CheckinPoint } from '../checkin/checkin';
import { addDays, weekStartOf } from '../dates';
import { blocksDecrease } from '../nutrition/targets';
import { evaluateStoredProfile } from '../profile/evaluate';
import type { WeightPoint } from '../weight/trend';

/**
 * The weekly review (spec 014 AC1–AC8). Deterministic: the weight rate of two weeks, the logging of the
 * last two weeks, sleep and stress give at most one proposal, a ±100 kcal correction of the energy
 * estimate (the calibration) that the user accepts or rejects. Every number is PROVISIONAL
 * (`REVIEW_RULES`, professional review).
 */

export interface WeeklyReviewInput {
  /** The Monday of the reviewed week. */
  weekStart: string;
  /** The user's local date the review is computed on. */
  today: string;
  /** The stored profile, with its calibration. */
  profile: Profile & { jobActivity: JobActivity };
  /** The live meal items of the reviewed week and the three weeks before. */
  mealItems: readonly Pick<MealItem, 'localDate' | 'nutrients'>[];
  /** The live workouts of the reviewed week. */
  workouts: readonly Pick<Workout, 'localDate' | 'minutes'>[];
  /** The weight log, at least from two weeks before the reviewed week. */
  weights: readonly WeightPoint[];
  /** The check-ins of the reviewed week, in any order. */
  checkins: readonly CheckinPoint[];
  /** The kcal targets by the local date they started (the targets history), in any order. */
  targetsHistory: readonly { fromDate: string; kcal: number }[];
  /** The local date of the last calibration change ("Aplicar" or a reset), or null. */
  calibratedOn: string | null;
}

/** A review before it is stored: no times, and only the statuses the review itself gives. */
export type ReviewDraft = Pick<
  WeeklyReview,
  'weekStart' | 'summary' | 'proposal' | 'reasons' | 'rulesVersion'
> & { status: 'proposed' | 'no_change' };

/** Profiles that are never reviewed: no numbers to review (BLUEPRINT §8). */
const PROTECTED: readonly SafetyFlag[] = ['ed_soft_stop', 'pregnancy'];

/**
 * Which week to review on `today` (AC1): the last complete week, once `minHistoryDays` (21) have
 * passed since the onboarding (`onboardedOn`, local date); before that, the Monday of the first
 * review. Never for a profile with an eating-disorder signal or a pregnancy.
 */
export function reviewWeekToShow(input: {
  today: string;
  onboardedOn: string;
  flags: readonly SafetyFlag[];
}): { weekStart: string | null; firstReviewOn: string | null } {
  if (input.flags.some((flag) => PROTECTED.includes(flag))) {
    return { weekStart: null, firstReviewOn: null };
  }
  const eligible = addDays(input.onboardedOn, REVIEW_RULES.minHistoryDays);
  const monday = weekStartOf(eligible);
  const firstReviewOn = monday === eligible ? monday : addDays(monday, 7);
  if (input.today < firstReviewOn) return { weekStart: null, firstReviewOn };
  return { weekStart: addDays(weekStartOf(input.today), -7), firstReviewOn: null };
}

/** The calibration after a proposal, or null when it would leave ±`calibrationMaxKcal` (AC5). */
export function applyCalibration(current: number, delta: number): number | null {
  const next = current + delta;
  return Math.abs(next) > REVIEW_RULES.calibrationMaxKcal ? null : next;
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

const inRange = (date: string, from: string) => date >= from && date <= addDays(from, 6);

/** The readings of a week, one per day. */
function weekReadings(weights: readonly WeightPoint[], monday: string): number[] {
  const ofWeek = new Map<string, number>();
  for (const w of weights) if (inRange(w.localDate, monday)) ofWeek.set(w.localDate, w.weightKg);
  return [...ofWeek.values()];
}

/** The readings without the one farthest from their mean (a mistyped or unusual weigh-in). */
function withoutExtreme(readings: readonly number[]): number[] {
  const m = mean(readings)!;
  let far = 0;
  readings.forEach((kg, i) => {
    if (Math.abs(kg - m) > Math.abs(readings[far]! - m)) far = i;
  });
  return readings.filter((_, i) => i !== far);
}

/** Logged kcal per day with food, for the days of a week. */
function kcalByDay(
  items: readonly Pick<MealItem, 'localDate' | 'nutrients'>[],
  monday: string,
): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const item of items) {
    if (!inRange(item.localDate, monday)) continue;
    byDay.set(item.localDate, (byDay.get(item.localDate) ?? 0) + item.nutrients.kcal);
  }
  return byDay;
}

/** The kcal target in force on a day: the last one that started on or before it. */
function targetOn(history: WeeklyReviewInput['targetsHistory'], date: string): number | null {
  let best: { fromDate: string; kcal: number } | null = null;
  for (const row of history) {
    if (row.fromDate <= date && (best === null || row.fromDate >= best.fromDate)) best = row;
  }
  return best?.kcal ?? null;
}

/**
 * Which way the weight rate asks to correct the energy estimate, and why (AC3). Losing faster than
 * the `lose` band allows asks for more energy whatever the goal (domain review).
 */
function rateReason(goal: Goal, ratio: number): { reason: ReviewReason; delta: number } {
  const { bands, stepKcal } = REVIEW_RULES;
  if (-ratio > bands.lose.fastAbove) return { reason: 'fast_loss', delta: stepKcal };
  if (goal === 'lose') {
    if (-ratio < bands.lose.slowBelow) return { reason: 'slow_loss', delta: -stepKcal };
  } else if (goal === 'maintain') {
    if (ratio > bands.maintain.driftBeyond) return { reason: 'drift_up', delta: -stepKcal };
    if (ratio < -bands.maintain.driftBeyond) return { reason: 'drift_down', delta: stepKcal };
  } else {
    if (ratio < bands.gain.slowBelow) return { reason: 'slow_gain', delta: stepKcal };
    if (ratio > bands.gain.fastAbove) return { reason: 'fast_gain', delta: -stepKcal };
  }
  return { reason: 'on_track', delta: 0 };
}

/** The weekly change of the average from `before` to `after` (two weeks apart), as a share of weight. */
function rateOf(after: readonly number[], before: readonly number[]): number {
  const b = mean(before)!;
  return (mean(after)! - b) / 2 / b;
}

/**
 * The review of `weekStart`, or null for a profile that is never reviewed (an eating-disorder signal or
 * a pregnancy: BLUEPRINT §8, enforced here and not only by the caller).
 */
export function weeklyReview(input: WeeklyReviewInput): ReviewDraft | null {
  const { weekStart, profile } = input;
  if (profile.safetyFlags.some((flag) => PROTECTED.includes(flag))) return null;
  const previousWeek = addDays(weekStart, -7);
  const twoWeeksBefore = addDays(weekStart, -14);
  const sunday = addDays(weekStart, 6);

  // ── Summary (AC2) ────────────────────────────────────────────────────────────────────────────
  const food = kcalByDay(input.mealItems, weekStart);
  const foodBefore = kcalByDay(input.mealItems, previousWeek);
  const workouts = input.workouts.filter((w) => inRange(w.localDate, weekStart));
  const checkins = latestPerDay(input.checkins).filter((c) => inRange(c.localDate, weekStart));
  const logged = new Set<string>([
    ...food.keys(),
    ...workouts.map((w) => w.localDate),
    ...input.weights.filter((w) => inRange(w.localDate, weekStart)).map((w) => w.localDate),
  ]);
  const poorSleep = (c: CheckinPoint) =>
    c.sleepMinutes !== null && c.sleepMinutes < REVIEW_RULES.poorSleepMinutes;
  const highStress = (c: CheckinPoint) => c.stress === 'high';

  const readings = weekReadings(input.weights, weekStart);
  const readingsBefore = weekReadings(input.weights, twoWeeksBefore);
  const enough = (r: readonly number[]) => r.length >= REVIEW_RULES.minWeightsPerWeek;
  const average = enough(readings) ? mean(readings) : null;
  const before = enough(readingsBefore) ? mean(readingsBefore) : null;
  const rateKg = average !== null && before !== null ? (average - before) / 2 : null;
  const ratio = rateKg !== null && before !== null ? rateKg / before : null;
  const averageKcal = mean([...food.values()]);

  const summary: ReviewSummary = {
    daysLogged: logged.size,
    foodDays: food.size,
    averageKcal: averageKcal === null ? null : Math.round(averageKcal),
    targetKcal: targetOn(input.targetsHistory, sunday),
    weightAverageKg: average === null ? null : Math.round(average * 10) / 10,
    weightRateKgPerWeek: rateKg === null ? null : Math.round(rateKg * 100) / 100,
    weightRatePerWeek: ratio === null ? null : Math.round(ratio * 10_000) / 10_000,
    workouts: workouts.length,
    workoutMinutes: workouts.reduce((sum, w) => sum + w.minutes, 0),
    checkinDays: checkins.length,
    poorSleepDays: checkins.filter(poorSleep).length,
    highStressDays: checkins.filter(highStress).length,
  };
  const draft = (reasons: ReviewReason[], proposal: ReviewProposal | null = null): ReviewDraft => ({
    weekStart,
    status: proposal ? 'proposed' : 'no_change',
    summary,
    proposal,
    reasons,
    rulesVersion: REVIEW_RULES.version,
  });

  // ── Proposal (AC3–AC5) ───────────────────────────────────────────────────────────────────────
  const current = evaluateStoredProfile(profile, profile.weightKg, input.today, input.weights);
  if (current.kind !== 'ok' || !current.targets) return draft([]);
  if (ratio === null) return draft(['not_enough_weights']);

  const goal = current.safety.appliedGoal;
  const { reason, delta } = rateReason(goal, ratio);
  if (delta === 0) return draft([reason]);
  const fast = reason === 'fast_loss';

  // One reading far from the rest must not decide (domain review): the reason has to hold without it.
  const robust = [
    rateOf(withoutExtreme(readings), readingsBefore),
    rateOf(readings, withoutExtreme(readingsBefore)),
  ];
  if (robust.some((r) => rateReason(goal, r).reason !== reason)) {
    return draft([reason, 'uneven_weights']);
  }

  // A change needs two weeks to show in the weight: nothing is proposed until both weeks compared
  // start after it. A fast loss is the exception, as for the logging.
  if (!fast && input.calibratedOn !== null && input.calibratedOn >= twoWeeksBefore) {
    return draft([reason, 'recent_change']);
  }

  // A slow change needs the logging to reflect the target; a fast loss is corrected whatever it is.
  if (!fast) {
    if (food.size < REVIEW_RULES.minFoodDays || foodBefore.size < REVIEW_RULES.minFoodDays) {
      return draft([reason, 'not_enough_logging']);
    }
    const days = [...food.entries(), ...foodBefore.entries()];
    const intake = mean(days.map(([, kcal]) => kcal))!;
    const target = mean(
      days.flatMap(([date]) => {
        const kcal = targetOn(input.targetsHistory, date);
        return kcal === null ? [] : [kcal];
      }),
    );
    if (target === null || Math.abs(intake / target - 1) > REVIEW_RULES.intakeTolerance) {
      return draft([reason, 'off_target_intake']);
    }
  }

  if (delta < 0) {
    // A low BMI, a minor or an eating-disorder signal never gets a deficit, nor a decrease that acts
    // as one (domain review).
    if (blocksDecrease(current.flags)) return draft([reason, 'decrease_blocked_profile']);
    // Little sleep or high stress never lowers the calories (BLUEPRINT §8).
    const hardDays = checkins.filter((c) => poorSleep(c) || highStress(c)).length;
    if (hardDays >= REVIEW_RULES.sleepStressDays) {
      return draft([reason, 'decrease_blocked_sleep_stress']);
    }
  }

  // For a profile that gets no decrease, a negative stored calibration is not applied (targets-v4).
  const stored = profile.energyCalibrationKcal ?? 0;
  const base = blocksDecrease(current.flags) ? Math.max(0, stored) : stored;
  const calibration = applyCalibration(base, delta);
  if (calibration === null) {
    return draft(
      fast ? [reason, 'calibration_limit', 'see_professional'] : [reason, 'calibration_limit'],
    );
  }

  const next = evaluateStoredProfile(
    { ...profile, energyCalibrationKcal: calibration },
    profile.weightKg,
    input.today,
    input.weights,
  );
  const fromKcal = current.targets.kcal;
  const toKcal = (next.kind === 'ok' ? next.targets?.kcal : null) ?? fromKcal;
  if (delta < 0 && toKcal >= fromKcal) return draft([reason, 'at_floor']);
  // Losing fast at the calorie floor: one step does not raise the target, so the review refers to a
  // professional instead of proposing nothing week after week (domain review).
  if (delta > 0 && toKcal <= fromKcal) return draft(fast ? [reason, 'see_professional'] : [reason]);
  return draft([reason], { kcalDelta: delta, fromKcal, toKcal });
}
