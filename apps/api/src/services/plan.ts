import {
  PLAN_LIMITS,
  type Locale,
  type PlanDelete,
  type PlannedMealItem,
  type PlannedMealItemUpsert,
  type PlannedWorkout,
  type PlannedWorkoutUpsert,
} from '@pt/contracts';
import { checkPlanWrite, plannedMealItemFromUpsert, plannedWorkoutFromUpsert } from '@pt/core';
import type { Deps, Ownership } from '../deps';
import { resolveFoods, toFood, type Catalog } from './foods';

/**
 * The bulk writes of the weekly planner (spec 013 AC22, AC23). A request is checked as a whole before
 * anything is written, so it is stored entirely or not at all; the store applies it in one transaction.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlanWriteFailure {
  status: 400 | 404 | 409;
  code: 'validation_error' | 'not_found' | 'id_taken';
  fields: Record<string, string>;
}

type Result<T> = { ok: true; value: T } | { ok: false; failure: PlanWriteFailure };

const fail = (
  status: PlanWriteFailure['status'],
  code: PlanWriteFailure['code'],
  fields: Record<string, string>,
): { ok: false; failure: PlanWriteFailure } => ({ ok: false, failure: { status, code, fields } });

interface Changes<U> {
  locale: Locale;
  upserts: U[];
  deletes: PlanDelete[];
}

/** The date and clock checks of every change (AC23): upsert dates in range, no device time far ahead. */
function checkDates(
  changes: Changes<{ localDate: string; recordedAt: string }>,
  now: Date,
): PlanWriteFailure | null {
  for (const [i, upsert] of changes.upserts.entries()) {
    const invalid = checkPlanWrite(upsert, now);
    if (invalid) {
      const [field, reason] = Object.entries(invalid)[0]!;
      return {
        status: 400,
        code: 'validation_error',
        fields: { [`upserts.${i}.${field}`]: reason },
      };
    }
  }
  for (const [i, del] of changes.deletes.entries()) {
    if (Date.parse(del.recordedAt) > now.getTime() + DAY_MS) {
      return {
        status: 400,
        code: 'validation_error',
        fields: { [`deletes.${i}.recordedAt`]: 'in_future' },
      };
    }
  }
  return null;
}

/**
 * The day limits after the write (150 items, 4 sessions): the live rows of the days written to, minus
 * the rows the request changes, plus its rows. Returns the index of the first row over the limit.
 */
function overDayLimit(
  existing: readonly { id: string; localDate: string }[],
  changes: { rows: readonly { id: string; localDate: string }[]; deletes: readonly PlanDelete[] },
  max: number,
): number {
  const touched = new Set([...changes.rows, ...changes.deletes].map((c) => c.id));
  const perDay = new Map<string, number>();
  for (const row of existing) {
    if (!touched.has(row.id)) perDay.set(row.localDate, (perDay.get(row.localDate) ?? 0) + 1);
  }
  return changes.rows.findIndex((row) => {
    const count = (perDay.get(row.localDate) ?? 0) + 1;
    perDay.set(row.localDate, count);
    return count > max;
  });
}

/** The range of days a request writes to. */
function datesOf(rows: readonly { localDate: string }[]): { from: string; to: string } {
  const dates = rows.map((r) => r.localDate).sort();
  return { from: dates[0]!, to: dates.at(-1)! };
}

/** `POST /me/plan/meal-items` (AC5, AC6, AC20, AC22, AC23). */
export async function savePlanMealChanges(
  deps: Deps,
  catalog: Catalog,
  userId: string,
  changes: Changes<PlannedMealItemUpsert>,
): Promise<Result<PlannedMealItem[]>> {
  const invalid = checkDates(changes, deps.now());
  if (invalid) return { ok: false, failure: invalid };

  // Another user's own food is not found: a planned item cannot point to it (spec 006 AC13).
  const foods = await resolveFoods(
    deps.store,
    catalog,
    userId,
    changes.upserts.flatMap((u) => (u.kind === 'food' ? [u.foodId] : [])),
  );
  const rows: PlannedMealItem[] = [];
  for (const [i, upsert] of changes.upserts.entries()) {
    const food = upsert.kind === 'food' ? foods.get(upsert.foodId) : undefined;
    const row = plannedMealItemFromUpsert(upsert, food ? toFood(food, changes.locale) : null);
    if ('error' in row) {
      return row.error === 'food_not_found'
        ? fail(404, 'not_found', { [`upserts.${i}.foodId`]: 'not_found' })
        : fail(400, 'validation_error', { [`upserts.${i}.portion.servingId`]: 'not_found' });
    }
    rows.push(row);
  }

  if (rows.length > 0) {
    const { from, to } = datesOf(rows);
    const { mealItems } = await deps.store.listPlan(userId, from, to);
    const over = overDayLimit(
      mealItems,
      { rows, deletes: changes.deletes },
      PLAN_LIMITS.itemsPerDayMax,
    );
    if (over >= 0) {
      return fail(400, 'validation_error', { [`upserts.${over}.localDate`]: 'too_many_items' });
    }
  }

  const stored = await deps.store.writePlannedMealItems(userId, rows, changes.deletes);
  if (stored === 'id_taken') return fail(409, 'id_taken', { id: 'taken' });
  return { ok: true, value: stored };
}

/** `POST /me/plan/workouts` (AC10–AC12, AC20–AC23). */
export async function savePlanWorkoutChanges(
  deps: Deps,
  userId: string,
  changes: Changes<PlannedWorkoutUpsert>,
): Promise<Result<PlannedWorkout[]>> {
  const invalid = checkDates(changes, deps.now());
  if (invalid) return { ok: false, failure: invalid };

  // The links of each planned gym session, each id read once.
  const owners = new Map<string, Promise<Ownership>>();
  const ownerOf = (key: string, read: () => Promise<Ownership>) => {
    if (!owners.has(key)) owners.set(key, read());
    return owners.get(key)!;
  };
  const rows: PlannedWorkout[] = [];
  for (const [i, upsert] of changes.upserts.entries()) {
    let row = plannedWorkoutFromUpsert(upsert);
    if (row.programSessionId !== null) {
      const id = row.programSessionId;
      const owner = await ownerOf(`s:${id}`, () => deps.store.programSessionOwner(userId, id));
      if (owner === 'other') {
        return fail(404, 'not_found', { [`upserts.${i}.programSessionId`]: 'not_found' });
      }
      // A session removed from the routine before this write arrived (a queued plan): the planned
      // session keeps its name as a free gym session, as when the session is removed later.
      if (owner === 'missing') row = { ...row, programSessionId: null };
    }
    if (row.repeatWorkoutId !== null) {
      const id = row.repeatWorkoutId;
      const owner = await ownerOf(`w:${id}`, () => deps.store.workoutOwner(userId, id));
      if (owner === 'other') {
        return fail(404, 'not_found', { [`upserts.${i}.repeatWorkoutId`]: 'not_found' });
      }
      if (owner === 'missing') row = { ...row, repeatWorkoutId: null };
    }
    rows.push(row);
  }

  if (rows.length > 0) {
    const { from, to } = datesOf(rows);
    const { workouts } = await deps.store.listPlan(userId, from, to);
    const over = overDayLimit(
      workouts,
      { rows, deletes: changes.deletes },
      PLAN_LIMITS.sessionsPerDayMax,
    );
    if (over >= 0) {
      return fail(400, 'validation_error', { [`upserts.${over}.localDate`]: 'too_many_sessions' });
    }
  }

  const stored = await deps.store.writePlannedWorkouts(userId, rows, changes.deletes);
  if (stored === 'id_taken') return fail(409, 'id_taken', { id: 'taken' });
  return { ok: true, value: stored };
}
