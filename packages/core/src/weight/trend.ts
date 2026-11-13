import type { Goal, SafetyFlag, WeightTrend } from '@pt/contracts';
import { daysBetween } from '../dates';

/** What the trend needs from an entry. One entry per day (spec 003 AC8). */
export interface WeightPoint {
  localDate: string;
  weightKg: number;
}

/**
 * Weight-trend rules (spec 003 AC15, AC23, AC24). PROVISIONAL: the thresholds come from the domain review
 * of the spec and need a professional's review before the beta.
 */
export const WEIGHT_TREND_RULES = {
  windowDays: 7,
  /** Entries a 7-day window needs before its average is shown or used. */
  minEntries: 3,
  /** Minimum distance, in days, between the mean days of the two windows to compute a weekly change. */
  minSpanDays: 5,
  /** Loss per week, as a fraction of body weight, above which the "losing fast" notice appears. */
  fastLossRatio: 0.01,
} as const;

const mean = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

interface Dated extends WeightPoint {
  /** Days before `today` (0 = today). */
  age: number;
}

/** Change per week between two sets of entries, normalised by the distance between their mean days. */
function changePerWeek(recent: readonly Dated[], before: readonly Dated[]): number | null {
  if (recent.length === 0 || before.length === 0) return null;
  const span = mean(before.map((e) => e.age)) - mean(recent.map((e) => e.age));
  if (span < WEIGHT_TREND_RULES.minSpanDays) return null;
  return (
    ((mean(recent.map((e) => e.weightKg)) - mean(before.map((e) => e.weightKg))) / span) *
    WEIGHT_TREND_RULES.windowDays
  );
}

const isFast = (change: number | null, beforeAverageKg: number) =>
  change !== null && -change / beforeAverageKg > WEIGHT_TREND_RULES.fastLossRatio;

/**
 * The weight trend on `today` (the user's local date). Pure. Entries after `today` are ignored.
 * W1 = entries of the last 7 days (today included), W0 = entries of the 7 days before.
 */
export function weightTrend(entries: readonly WeightPoint[], today: string): WeightTrend {
  const { windowDays, minEntries } = WEIGHT_TREND_RULES;
  const dated: Dated[] = entries
    .map((entry) => ({ ...entry, age: daysBetween(entry.localDate, today) }))
    .filter((entry) => entry.age >= 0)
    .sort((a, b) => a.age - b.age);
  const newest = dated[0];
  const last = newest ? { localDate: newest.localDate, weightKg: newest.weightKg } : null;

  const w1 = dated.filter((e) => e.age < windowDays);
  const w0 = dated.filter((e) => e.age >= windowDays && e.age < 2 * windowDays);
  const averageKg = w1.length >= minEntries ? mean(w1.map((e) => e.weightKg)) : null;
  const enough = w1.length >= minEntries && w0.length >= minEntries;
  const changePerWeekKg = enough ? changePerWeek(w1, w0) : null;

  let fastLoss = false;
  if (enough && changePerWeekKg !== null) {
    const before = mean(w0.map((e) => e.weightKg));
    // One mistyped or unusual low reading must not raise the notice: the rule also has to hold
    // without the lowest entry of the recent window.
    const lowest = w1.reduce((min, e) => (e.weightKg < min.weightKg ? e : min));
    const withoutLowest = w1.filter((e) => e !== lowest);
    fastLoss = isFast(changePerWeekKg, before) && isFast(changePerWeek(withoutLowest, w0), before);
  }

  return { last, averageKg, changePerWeekKg, fastLoss };
}

/**
 * The 7-day average on each day that has an entry (the average line of the chart, AC14). Days whose
 * window has fewer than 3 entries have no point.
 */
export function weightAverageSeries(entries: readonly WeightPoint[]): WeightPoint[] {
  return entries.flatMap((entry) => {
    const { averageKg } = weightTrend(entries, entry.localDate);
    return averageKg === null ? [] : [{ localDate: entry.localDate, weightKg: averageKg }];
  });
}

const has = (flags: readonly SafetyFlag[], ...wanted: SafetyFlag[]) =>
  wanted.some((flag) => flags.includes(flag));

/** With an eating-disorder signal or pregnancy the app shows the entries without judging them (AC15). */
export function isWeightTrendHidden(flags: readonly SafetyFlag[]): boolean {
  return has(flags, 'ed_soft_stop', 'pregnancy');
}

/** Whether "Today" may invite the user to weigh in (AC4). Protected profiles get a plain link. */
export function invitesWeighIn(flags: readonly SafetyFlag[]): boolean {
  return !has(flags, 'ed_soft_stop', 'pregnancy', 'teen_limited');
}

/** Notices that come from the weight log (spec 003 AC24). */
export type WeightNotice = 'fast_loss';

/**
 * The "losing fast" notice, unless the profile has an eating-disorder signal or pregnancy: then only the
 * professional-advice notice of spec 001 applies.
 */
export function weightNotices(
  trend: Pick<WeightTrend, 'fastLoss'>,
  flags: readonly SafetyFlag[],
): WeightNotice[] {
  return trend.fastLoss && !isWeightTrendHidden(flags) ? ['fast_loss'] : [];
}

export type TargetWeightProgress =
  | { kind: 'hidden' }
  | { kind: 'reached' }
  /** `kg` is positive: how far the reference weight is from the target, in either direction. */
  | { kind: 'distance'; kg: number; direction: 'down' | 'up' };

/**
 * The line about the target weight in Progress (AC16). The reference is the 7-day average, or the last
 * weight when there is no average. Hidden for profiles where the app applies no deficit.
 */
export function targetWeightProgress(
  trend: Pick<WeightTrend, 'last' | 'averageKg'>,
  targetWeightKg: number | null,
  goal: Goal,
  flags: readonly SafetyFlag[],
): TargetWeightProgress {
  const reference = trend.averageKg ?? trend.last?.weightKg ?? null;
  if (
    targetWeightKg === null ||
    reference === null ||
    has(flags, 'ed_soft_stop', 'pregnancy', 'teen_limited', 'low_bmi', 'low_target_bmi')
  ) {
    return { kind: 'hidden' };
  }
  const diff = reference - targetWeightKg;
  if ((goal === 'lose' && diff <= 0) || (goal === 'gain' && diff >= 0) || diff === 0) {
    return { kind: 'reached' };
  }
  return { kind: 'distance', kg: Math.abs(diff), direction: diff > 0 ? 'down' : 'up' };
}
