import {
  MEAL_TYPES,
  type MealItem,
  type MealType,
  type SafetyFlag,
  type Weekday,
  type WorkBlock,
  type Workout,
} from '@pt/contracts';
import { addDays, daysBetween, isoWeekday, weekDays, weekStartOf } from '../dates';
import { dailyTotals, showsFoodNumbers } from '../food/nutrition';
import type { WorkingShift } from '../checkin/checkin';
import { dayWorkBlock, type ShiftCheckin } from './day';
import { typicalDay, type PlannedSlot, type TypicalWeek } from './typical';

/** Limits of the week view (spec 010 Assumptions, AC10, AC12). */
export const WEEK_VIEW = {
  /** How many weeks back "‹" goes. */
  weeksBack: 12,
  /** How many weeks forward "›" goes (next week shows only the typical week). */
  weeksForward: 1,
  /** A day screen adds meals and workouts for today and this many days before. */
  addDaysBack: 27,
} as const;

/** The week the view may show: from 12 weeks back to next week (AC10). */
export function weekNavigation(
  weekStart: string,
  today: string,
): { canGoBack: boolean; canGoForward: boolean; isCurrent: boolean } {
  const offset = daysBetween(weekStartOf(today), weekStart) / 7;
  return {
    canGoBack: offset > -WEEK_VIEW.weeksBack,
    canGoForward: offset < WEEK_VIEW.weeksForward,
    isCurrent: offset === 0,
  };
}

/** The Monday `weeks` weeks away from `weekStart`, kept inside the range of `weekNavigation`. */
export function moveWeek(weekStart: string, weeks: number, today: string): string {
  const current = weekStartOf(today);
  const offset = Math.round(daysBetween(current, weekStart) / 7) + weeks;
  const clamped = Math.min(Math.max(offset, -WEEK_VIEW.weeksBack), WEEK_VIEW.weeksForward);
  return addDays(current, clamped * 7);
}

/**
 * What a day screen allows (AC12): `add` for today and the 27 days before, `read_only` for older days,
 * `future` for days after today (typical week only, no add buttons).
 */
export type DayAccess = 'add' | 'read_only' | 'future';

export function dayAccess(date: string, today: string): DayAccess {
  const age = daysBetween(date, today);
  if (age < 0) return 'future';
  return age <= WEEK_VIEW.addDaysBack ? 'add' : 'read_only';
}

export type WeekMealItem = Pick<MealItem, 'localDate' | 'mealType' | 'nutrients'>;
export type WeekWorkout = Pick<Workout, 'localDate' | 'startedAt'>;

export interface WeekDayRow<W extends WeekWorkout = WeekWorkout> {
  date: string;
  weekday: Weekday;
  isToday: boolean;
  isFuture: boolean;
  /** From the typical week (AC8), or the shift of the day's check-in (spec 011 AC11). */
  work: WorkBlock | null;
  /** The shift kind when `work` comes from the check-in. */
  shift: WorkingShift | null;
  planned: PlannedSlot[];
  /** Logged, by start time; none on future days. */
  workouts: W[];
  /** The meal types with items, in the order of the day (one dot each). */
  meals: MealType[];
  /** Rounded kcal of the day; null with no items or when numbers are hidden (AC9). */
  kcal: number | null;
  /** True when the row shows only the date. */
  isEmpty: boolean;
}

/**
 * The rows of the week view (AC8–AC10), Monday to Sunday. Planned and done are not matched in this
 * slice. Nothing here judges a day: no colour, no "goal met", no streak (AC9).
 */
export function weekRows<W extends WeekWorkout>(input: {
  weekStart: string;
  today: string;
  week: TypicalWeek;
  items: readonly WeekMealItem[];
  workouts: readonly W[];
  flags: readonly SafetyFlag[];
  /** The check-ins of the week, for the shifts (spec 011 AC11). */
  checkins?: readonly ShiftCheckin[];
}): WeekDayRow<W>[] {
  const numbers = showsFoodNumbers(input.flags);
  return weekDays(input.weekStart).map((date) => {
    const weekday = isoWeekday(date) as Weekday;
    const isFuture = daysBetween(input.today, date) > 0;
    const typical = typicalDay(input.week, weekday);
    const checkin = input.checkins?.find((c) => c.localDate === date) ?? null;
    const dayWork = dayWorkBlock(input.week, checkin, date);
    const work = dayWork && {
      weekday: dayWork.weekday,
      startMinute: dayWork.startMinute,
      endMinute: dayWork.endMinute,
    };
    const items = isFuture ? [] : input.items.filter((i) => i.localDate === date);
    const workouts = isFuture
      ? []
      : input.workouts
          .filter((w) => w.localDate === date)
          .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const meals = MEAL_TYPES.filter((meal) => items.some((i) => i.mealType === meal));
    const kcal = numbers && items.length > 0 ? Math.round(dailyTotals(items).kcal) : null;
    return {
      date,
      weekday,
      isToday: date === input.today,
      isFuture,
      work,
      shift: dayWork?.shift ?? null,
      planned: typical.training,
      workouts,
      meals,
      kcal,
      isEmpty:
        work === null &&
        typical.training.length === 0 &&
        workouts.length === 0 &&
        meals.length === 0,
    };
  });
}

/** The meals of a day screen (AC11), in the order of the day, with their kcal unless hidden. */
export function dayMeals<I extends WeekMealItem>(
  items: readonly I[],
  date: string,
  flags: readonly SafetyFlag[],
): { mealType: MealType; items: I[]; kcal: number | null }[] {
  const numbers = showsFoodNumbers(flags);
  const ofDay = items.filter((i) => i.localDate === date);
  return MEAL_TYPES.flatMap((mealType) => {
    const meal = ofDay.filter((i) => i.mealType === mealType);
    if (meal.length === 0) return [];
    return [{ mealType, items: meal, kcal: numbers ? Math.round(dailyTotals(meal).kcal) : null }];
  });
}
