import {
  MEAL_TYPES,
  PLAN_LIMITS,
  type MealItem,
  type MealType,
  type PlannedMealItem,
  type PlannedWorkout,
  type SafetyFlag,
  type Weekday,
  type WorkBlock,
  type Workout,
} from '@pt/contracts';
import { addDays, daysBetween, isoWeekday, weekDays, weekStartOf } from '../dates';
import { dailyTotals, showsFoodNumbers } from '../food/nutrition';
import type { WorkingShift } from '../checkin/checkin';
import { plannedDayEnergy } from '../plan/energy';
import { pendingPlannedItems, pendingPlannedWorkouts, sortPlannedSessions } from '../plan/status';
import { dayWorkBlock, type ShiftCheckin } from './day';
import { typicalDay, type PlannedSlot, type TypicalWeek } from './typical';

/** Limits of the week view (spec 010 Assumptions, AC10, AC12; spec 013 AC1). */
export const WEEK_VIEW = {
  /** How many weeks back "‹" goes. */
  weeksBack: 12,
  /** How many weeks forward "›" goes: to the end of the plan horizon (spec 013 AC1). */
  weeksForward: PLAN_LIMITS.horizonWeeksAhead,
  /** A day screen adds meals and workouts for today and this many days before. */
  addDaysBack: 27,
} as const;

/** The week the view may show: from 12 weeks back to the end of the plan horizon (AC10). */
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
 * `future` for days after today (typical week and plan only, no add buttons; spec 013 `canPlan`).
 */
export type DayAccess = 'add' | 'read_only' | 'future';

export function dayAccess(date: string, today: string): DayAccess {
  const age = daysBetween(date, today);
  if (age < 0) return 'future';
  return age <= WEEK_VIEW.addDaysBack ? 'add' : 'read_only';
}

export type WeekMealItem = Pick<MealItem, 'localDate' | 'mealType' | 'nutrients'> & {
  /** The planned item it logs (spec 013); absent where the plan does not matter. */
  plannedItemId?: MealItem['plannedItemId'];
};
export type WeekWorkout = Pick<Workout, 'localDate' | 'startedAt'> & {
  plannedWorkoutId?: Workout['plannedWorkoutId'];
};
export type WeekPlannedItem = Pick<PlannedMealItem, 'id' | 'localDate' | 'mealType' | 'nutrients'>;
export type WeekPlannedWorkout = Pick<PlannedWorkout, 'id' | 'localDate' | 'startMinute'>;

export interface WeekDayRow<
  W extends WeekWorkout = WeekWorkout,
  P extends WeekPlannedWorkout = WeekPlannedWorkout,
> {
  date: string;
  weekday: Weekday;
  isToday: boolean;
  isFuture: boolean;
  /** From the typical week (AC8), or the shift of the day's check-in (spec 011 AC11). */
  work: WorkBlock | null;
  /** The shift kind when `work` comes from the check-in. */
  shift: WorkingShift | null;
  /** The typical week's slots; none on a today or future day with planned sessions (spec 013 AC2). */
  planned: PlannedSlot[];
  /** Logged, by start time; none on future days. A planned session done shows here, once. */
  workouts: W[];
  /** The meal types with items, in the order of the day (one filled dot each). */
  meals: MealType[];
  /** Rounded kcal of the day; null with no items or when numbers are hidden (AC9). */
  kcal: number | null;
  /** The meal types with pending planned items (outlined dots); none on past days (spec 013 AC2). */
  plannedMeals: MealType[];
  /** "Plan: 2.150 / 2.200 kcal"; null on past days, without a plan or with hidden numbers (AC3). */
  planKcal: { kcal: number; targetKcal: number | null } | null;
  /** Pending planned sessions by start time; none on past days (spec 013 AC2). */
  plannedSessions: P[];
  /** True when the row shows only the date. */
  isEmpty: boolean;
}

/**
 * The rows of the week view (spec 010 AC8–AC10, spec 013 AC2), Monday to Sunday. Past rows show only
 * what was logged; today and future rows add the plan, and a planned item or session counts as eaten or
 * done only through the log that points at it (AC7, AC18). Nothing here judges a day: no colour, no
 * "goal met", no streak, no adherence (AC9, spec 013 AC3).
 */
export function weekRows<
  W extends WeekWorkout,
  P extends WeekPlannedWorkout = WeekPlannedWorkout,
>(input: {
  weekStart: string;
  today: string;
  week: TypicalWeek;
  items: readonly WeekMealItem[];
  workouts: readonly W[];
  flags: readonly SafetyFlag[];
  /** The check-ins of the week, for the shifts (spec 011 AC11). */
  checkins?: readonly ShiftCheckin[];
  /** The plan of the week (spec 013). */
  plan?: { mealItems: readonly WeekPlannedItem[]; workouts: readonly P[] };
  /** The day's energy target, for "Plan: … / 2.200 kcal"; null without numeric targets. */
  targetKcal?: number | null;
}): WeekDayRow<W, P>[] {
  const numbers = showsFoodNumbers(input.flags);
  const plannedItems = input.plan?.mealItems ?? [];
  const plannedWorkouts = input.plan?.workouts ?? [];
  return weekDays(input.weekStart).map((date) => {
    const weekday = isoWeekday(date) as Weekday;
    const isFuture = daysBetween(input.today, date) > 0;
    const isPast = date < input.today;
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

    const dayPlanItems = isPast ? [] : plannedItems.filter((p) => p.localDate === date);
    const dayPlanSessions = isPast ? [] : plannedWorkouts.filter((p) => p.localDate === date);
    const pendingItems = pendingPlannedItems(dayPlanItems, items);
    const plannedMeals = MEAL_TYPES.filter((meal) => pendingItems.some((p) => p.mealType === meal));
    const plannedSessions = sortPlannedSessions(pendingPlannedWorkouts(dayPlanSessions, workouts));
    const planned = dayPlanSessions.length > 0 ? [] : typical.training;
    return {
      date,
      weekday,
      isToday: date === input.today,
      isFuture,
      work,
      shift: dayWork?.shift ?? null,
      planned,
      workouts,
      meals,
      kcal,
      plannedMeals,
      planKcal: plannedDayEnergy({
        date,
        today: input.today,
        planned: dayPlanItems,
        logged: items,
        flags: input.flags,
        targetKcal: input.targetKcal ?? null,
      }),
      plannedSessions,
      isEmpty:
        work === null &&
        planned.length === 0 &&
        workouts.length === 0 &&
        meals.length === 0 &&
        plannedMeals.length === 0 &&
        plannedSessions.length === 0,
    };
  });
}

export interface DayMeal<I, P> {
  mealType: MealType;
  /** Logged, as given. */
  items: I[];
  /** Rounded kcal of the logged items; null without items or when numbers are hidden. */
  kcal: number | null;
  /** The pending planned items of the meal (spec 013 AC8), shown muted under the logged ones. */
  pending: P[];
  /** Their rounded kcal ("Registrar lo planificado (2 alimentos · 520 kcal)"), or null. */
  pendingKcal: number | null;
}

/**
 * The meals of a day screen (spec 010 AC11), in the order of the day, with their kcal unless hidden;
 * with the plan (spec 013 AC8), each meal adds its pending planned items, and a meal with only a plan
 * is listed too.
 */
export function dayMeals<I extends WeekMealItem, P extends WeekPlannedItem = WeekPlannedItem>(
  items: readonly I[],
  date: string,
  flags: readonly SafetyFlag[],
  planned: readonly P[] = [],
): DayMeal<I, P>[] {
  const numbers = showsFoodNumbers(flags);
  const ofDay = items.filter((i) => i.localDate === date);
  const pendingOfDay = pendingPlannedItems(
    planned.filter((p) => p.localDate === date),
    ofDay,
  );
  const kcalOf = (rows: readonly Pick<MealItem, 'nutrients'>[]) =>
    numbers && rows.length > 0 ? Math.round(dailyTotals(rows).kcal) : null;
  return MEAL_TYPES.flatMap((mealType) => {
    const meal = ofDay.filter((i) => i.mealType === mealType);
    const pending = pendingOfDay.filter((p) => p.mealType === mealType);
    if (meal.length === 0 && pending.length === 0) return [];
    return [{ mealType, items: meal, kcal: kcalOf(meal), pending, pendingKcal: kcalOf(pending) }];
  });
}

/**
 * "Plan del día" (spec 013 AC4): the six meals with their pending planned items and their kcal (null
 * when empty or hidden), each with "Añadir al plan". On a future day every planned item is pending.
 */
export function dayPlanMeals<P extends WeekPlannedItem>(
  planned: readonly P[],
  logged: readonly WeekMealItem[],
  date: string,
  flags: readonly SafetyFlag[],
): { mealType: MealType; items: P[]; kcal: number | null }[] {
  const numbers = showsFoodNumbers(flags);
  const pending = pendingPlannedItems(
    planned.filter((p) => p.localDate === date),
    logged.filter((i) => i.localDate === date),
  );
  return MEAL_TYPES.map((mealType) => {
    const meal = pending.filter((p) => p.mealType === mealType);
    const kcal = numbers && meal.length > 0 ? Math.round(dailyTotals(meal).kcal) : null;
    return { mealType, items: meal, kcal };
  });
}
