import { PLAN_LIMITS } from '@pt/contracts';
import { addDays, daysBetween, weekDays, weekStartOf } from '../dates';

/**
 * The weekly planner's horizon (spec 013 AC1): the days the user can plan go from today to the Sunday
 * `horizonWeeksAhead` weeks after the current week, so 21 to 27 days ahead. "Today" is the user's day
 * (spec 010 AC6); the horizon only grows, one day a day.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function planHorizon(today: string): { from: string; to: string } {
  return {
    from: today,
    to: addDays(weekStartOf(today), 7 * (PLAN_LIMITS.horizonWeeksAhead + 1) - 1),
  };
}

/** Whether a day can be planned: today to the end of the horizon (AC1). */
export function canPlan(date: string, today: string): boolean {
  const { from, to } = planHorizon(today);
  return date >= from && date <= to;
}

/** The days a copy can target (AC19): today to the horizon, grouped by week, Monday first. */
export function planTargetWeeks(today: string): { weekStart: string; days: string[] }[] {
  const { to } = planHorizon(today);
  const weeks: { weekStart: string; days: string[] }[] = [];
  for (let weekStart = weekStartOf(today); weekStart <= to; weekStart = addDays(weekStart, 7)) {
    weeks.push({ weekStart, days: weekDays(weekStart).filter((d) => canPlan(d, today)) });
  }
  return weeks;
}

/** "Copiar semana" (AC21): the Mondays of the weeks after the shown one, inside the horizon. */
export function copyWeekTargets(shownWeekStart: string, today: string): string[] {
  return planTargetWeeks(today)
    .map((w) => w.weekStart)
    .filter((weekStart) => weekStart > shownWeekStart);
}

/** The plan the offline cache keeps (AC22): 27 days back, for the day screens, to the horizon. */
export function planCacheRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -PLAN_LIMITS.cacheDaysBack), to: planHorizon(today).to };
}

/**
 * The API's check of a planned upsert (AC23): its date between yesterday and today + 28 days in server
 * UTC (every time zone's horizon fits), and a device clock at most one day ahead. Deletes are never
 * checked. Returns the field errors, or null.
 */
export function checkPlanWrite(
  write: { localDate: string; recordedAt: string },
  now: Date,
): Record<string, string> | null {
  const utcToday = now.toISOString().slice(0, 10);
  if (write.localDate < addDays(utcToday, -PLAN_LIMITS.serverDaysBack)) {
    return { localDate: 'too_old' };
  }
  if (write.localDate > addDays(utcToday, PLAN_LIMITS.serverDaysAhead)) {
    return { localDate: 'too_far' };
  }
  if (Date.parse(write.recordedAt) > now.getTime() + DAY_MS) return { recordedAt: 'in_future' };
  return null;
}

/** `GET /me/plan?from&to`: at most `listDaysMax` days, in order. */
export function checkPlanRange(from: string, to: string): Record<string, string> | null {
  if (from > to) return { from: 'after_to' };
  if (daysBetween(from, to) > PLAN_LIMITS.listDaysMax) return { to: 'too_big' };
  return null;
}
