import type { MealType } from '@pt/contracts';

/**
 * The meal preselected for a local time of day, in minutes after midnight (spec 005 AC12).
 * 05:00–10:59 breakfast, 11:00–12:59 mid-morning, 13:00–16:29 lunch, 16:30–19:59 afternoon snack,
 * 20:00–04:59 dinner. Provisional hours, for the professional reviewer.
 */
export function mealTypeForTime(minutesOfDay: number): MealType {
  const m = ((minutesOfDay % 1440) + 1440) % 1440;
  if (m < 5 * 60) return 'dinner';
  if (m < 11 * 60) return 'breakfast';
  if (m < 13 * 60) return 'mid_morning';
  if (m < 16 * 60 + 30) return 'lunch';
  if (m < 20 * 60) return 'afternoon_snack';
  return 'dinner';
}
