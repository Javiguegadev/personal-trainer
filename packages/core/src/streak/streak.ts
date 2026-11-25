import { STREAK_RULES, type SafetyFlag, type Streak } from '@pt/contracts';
import { addDays, weekStartOf } from '../dates';

/**
 * The logging streak (spec 014 AC9, AC10): the weeks in a row, Monday to Sunday, with at least 4 days
 * with something logged (a meal item, a workout or a weight; never a check-in or a planned item),
 * ending with the last complete week; the current week adds one as soon as it reaches 4 days. A week
 * with fewer days restarts it, without any message about losing it. Hidden with an eating-disorder
 * signal. `today` and `loggedDays` are the user's local dates (day start of spec 010 AC6).
 */
export function loggingStreak(input: {
  loggedDays: readonly string[];
  today: string;
  flags: readonly SafetyFlag[];
}): Streak {
  if (input.flags.includes('ed_soft_stop')) return { weeks: 0, currentWeekDays: 0, hidden: true };

  const perWeek = new Map<string, Set<string>>();
  for (const day of input.loggedDays) {
    if (day > input.today) continue;
    const monday = weekStartOf(day);
    const days = perWeek.get(monday) ?? new Set<string>();
    days.add(day);
    perWeek.set(monday, days);
  }
  const count = (monday: string) => perWeek.get(monday)?.size ?? 0;
  const enough = (monday: string) => count(monday) >= STREAK_RULES.daysPerWeek;

  const current = weekStartOf(input.today);
  let weeks = 0;
  for (let monday = addDays(current, -7); enough(monday); monday = addDays(monday, -7)) weeks += 1;
  if (enough(current)) weeks += 1;
  return { weeks, currentWeekDays: count(current), hidden: false };
}
