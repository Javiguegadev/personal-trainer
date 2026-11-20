/**
 * The week view (spec 010 AC7–AC12): the meals and workouts of one week, Monday to Sunday, cached per
 * week so a visited week still shows without a connection (AC10). The food and training mutations
 * patch every cached week optimistically, so a meal or a workout added from the week view or a day
 * screen shows at once, also on days older than the main logs keep.
 */
import type { MealItem, MeResponse, StoredTargets, Workout } from '@pt/contracts';
import { addDays, sameTargets, targetsOnly } from '@pt/core';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { ApiClient } from './client';
import { isRejected } from './weights';

export const weekKeys = {
  /** Prefix of every cached week. */
  all: ['week-log'] as const,
  /** The logs of the week that starts on `monday` (an ISO date). */
  week: (monday: string) => ['week-log', monday] as const,
};

/** What the week view and the day screen show of one week. */
export interface WeekLog {
  /** By day, then by time. */
  mealItems: MealItem[];
  /** Newest first. */
  workouts: Workout[];
}

const retry = (failureCount: number, error: unknown) => !isRejected(error) && failureCount < 2;

export function weekLogQueryOptions(api: ApiClient, monday: string) {
  const range = { from: monday, to: addDays(monday, 6) };
  return queryOptions({
    queryKey: weekKeys.week(monday),
    queryFn: async (): Promise<WeekLog> => {
      const [food, training] = await Promise.all([api.listFoodLog(range), api.listWorkouts(range)]);
      return { mealItems: food.items, workouts: training.workouts };
    },
    retry,
  });
}

const inWeek = (monday: string, localDate: string) =>
  localDate >= monday && localDate <= addDays(monday, 6);

const byDayAndTime = (a: MealItem, b: MealItem) =>
  a.localDate.localeCompare(b.localDate) || a.recordedAt.localeCompare(b.recordedAt);

const newestFirst = (a: Workout, b: Workout) =>
  b.localDate.localeCompare(a.localDate) || Date.parse(b.startedAt) - Date.parse(a.startedAt);

/** The week with the item `id` replaced by `item` (when it falls in that week), or removed. */
export function withWeekMealItem(
  log: WeekLog,
  monday: string,
  id: string,
  item: MealItem | null,
): WeekLog {
  const others = log.mealItems.filter((i) => i.id !== id);
  const mealItems =
    item && inWeek(monday, item.localDate) ? [...others, item].sort(byDayAndTime) : others;
  return { ...log, mealItems };
}

/** The week with the workout `id` replaced by `workout` (when it falls in that week), or removed. */
export function withWeekWorkout(
  log: WeekLog,
  monday: string,
  id: string,
  workout: Workout | null,
): WeekLog {
  const others = log.workouts.filter((w) => w.id !== id);
  const workouts =
    workout && inWeek(monday, workout.localDate) ? [...others, workout].sort(newestFirst) : others;
  return { ...log, workouts };
}

function patchWeeks(queryClient: QueryClient, patch: (log: WeekLog, monday: string) => WeekLog) {
  for (const [key, log] of queryClient.getQueriesData<WeekLog>({ queryKey: weekKeys.all })) {
    const monday = key[1];
    if (log && typeof monday === 'string') queryClient.setQueryData(key, patch(log, monday));
  }
}

/** Puts a meal item into every cached week (or removes it), as `setItem` does with the food log. */
export function setWeekMealItem(queryClient: QueryClient, id: string, item: MealItem | null): void {
  patchWeeks(queryClient, (log, monday) => withWeekMealItem(log, monday, id, item));
}

/** Puts a workout into every cached week (or removes it), as `setWorkout` does with the log. */
export function setWeekWorkout(
  queryClient: QueryClient,
  id: string,
  workout: Workout | null,
): void {
  patchWeeks(queryClient, (log, monday) => withWeekWorkout(log, monday, id, workout));
}

/** The item `id` as a cached week holds it (days older than the food log keeps), or null. */
export function cachedWeekMealItem(queryClient: QueryClient, id: string): MealItem | null {
  for (const [, log] of queryClient.getQueriesData<WeekLog>({ queryKey: weekKeys.all })) {
    const item = log?.mealItems.find((i) => i.id === id);
    if (item) return item;
  }
  return null;
}

/** The workout `id` as a cached week holds it, or null. */
export function cachedWeekWorkout(queryClient: QueryClient, id: string): Workout | null {
  for (const [, log] of queryClient.getQueriesData<WeekLog>({ queryKey: weekKeys.all })) {
    const workout = log?.workouts.find((w) => w.id === id);
    if (workout) return workout;
  }
  return null;
}

/** Waits for the week requests in flight, so they cannot overwrite an optimistic change. */
export async function cancelWeekLogs(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: weekKeys.all });
}

export async function invalidateWeekLogs(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: weekKeys.all });
}

/** What "Guardar" on "Mi semana" gives back: the new `/me` and the targets before the write. */
export interface WeekSaveResult {
  me: MeResponse;
  previousTargets: StoredTargets | null;
}

/**
 * The old and new targets when a week write changed them (spec 010 AC4, the notice of spec 003), or
 * null when the training load was the same and the targets were left alone.
 */
export function weekTargetsChange(
  result: WeekSaveResult,
): { previous: StoredTargets | null; current: StoredTargets | null } | null {
  const previous = result.previousTargets;
  const current = result.me.targets;
  const same = sameTargets(previous && targetsOnly(previous), current && targetsOnly(current));
  return same ? null : { previous, current };
}
