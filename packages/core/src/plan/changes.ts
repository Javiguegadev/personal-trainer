import {
  PLAN_LIMITS,
  type Locale,
  type PlanDelete,
  type PlanMealChangesRequest,
  type PlannedMealItem,
  type PlannedWorkout,
  type PlanWorkoutChangesRequest,
} from '@pt/contracts';
import { plannedItemToUpsert, plannedWorkoutToUpsert } from './items';

/**
 * A change of the plan (spec 013 AC22): the planned rows to store and the ids to delete, per queue
 * scope (meals in `food`, sessions in `training`). Rows, not upserts, so the same value feeds the
 * optimistic cache and the bulk writes.
 */
export interface PlanChanges {
  mealItems: { upserts: PlannedMealItem[]; deletes: PlanDelete[] };
  workouts: { upserts: PlannedWorkout[]; deletes: PlanDelete[] };
}

export const EMPTY_PLAN_CHANGES: PlanChanges = {
  mealItems: { upserts: [], deletes: [] },
  workouts: { upserts: [], deletes: [] },
};

export function isEmptyPlanChanges(changes: PlanChanges): boolean {
  return (
    changes.mealItems.upserts.length === 0 &&
    changes.mealItems.deletes.length === 0 &&
    changes.workouts.upserts.length === 0 &&
    changes.workouts.deletes.length === 0
  );
}

type Op<R> = { type: 'upsert'; row: R } | { type: 'delete'; del: PlanDelete };

/** One side of the changes, the last change of each id winning. */
function mergeSide<R extends { id: string }>(
  sides: readonly { upserts: R[]; deletes: PlanDelete[] }[],
): { upserts: R[]; deletes: PlanDelete[] } {
  const ops = new Map<string, Op<R>>();
  for (const side of sides) {
    for (const del of side.deletes) {
      ops.delete(del.id);
      ops.set(del.id, { type: 'delete', del });
    }
    for (const row of side.upserts) {
      ops.delete(row.id);
      ops.set(row.id, { type: 'upsert', row });
    }
  }
  const upserts: R[] = [];
  const deletes: PlanDelete[] = [];
  for (const op of ops.values()) {
    if (op.type === 'upsert') upserts.push(op.row);
    else deletes.push(op.del);
  }
  return { upserts, deletes };
}

/** The changes one after the other: a later change of an id replaces an earlier one. */
export function mergePlanChanges(...changes: readonly PlanChanges[]): PlanChanges {
  return {
    mealItems: mergeSide(changes.map((c) => c.mealItems)),
    workouts: mergeSide(changes.map((c) => c.workouts)),
  };
}

/** Every row and delete with this device time: an undo must win over the change it undoes (AC20). */
export function stampChanges(changes: PlanChanges, recordedAt: string): PlanChanges {
  const stamp = <T extends { recordedAt: string }>(rows: readonly T[]) =>
    rows.map((row) => ({ ...row, recordedAt }));
  return {
    mealItems: {
      upserts: stamp(changes.mealItems.upserts),
      deletes: stamp(changes.mealItems.deletes),
    },
    workouts: {
      upserts: stamp(changes.workouts.upserts),
      deletes: stamp(changes.workouts.deletes),
    },
  };
}

/** Requests of at most `changesMax` changes; the deletes go first, so a replaced day never overflows. */
function chunk<U>(
  side: { upserts: U[]; deletes: PlanDelete[] },
  locale: Locale,
): { locale: Locale; upserts: U[]; deletes: PlanDelete[] }[] {
  const ops: Op<U>[] = [
    ...side.deletes.map((del): Op<U> => ({ type: 'delete', del })),
    ...side.upserts.map((row): Op<U> => ({ type: 'upsert', row })),
  ];
  const requests: { locale: Locale; upserts: U[]; deletes: PlanDelete[] }[] = [];
  for (let start = 0; start < ops.length; start += PLAN_LIMITS.changesMax) {
    const slice = ops.slice(start, start + PLAN_LIMITS.changesMax);
    requests.push({
      locale,
      upserts: slice.flatMap((op) => (op.type === 'upsert' ? [op.row] : [])),
      deletes: slice.flatMap((op) => (op.type === 'delete' ? [op.del] : [])),
    });
  }
  return requests;
}

/**
 * The bulk writes of a change (AC22): `POST /me/plan/meal-items` requests in the `food` queue scope and
 * `POST /me/plan/workouts` requests in the `training` scope, so a planned row is sent before the log
 * that points at it. Big changes (a copied week) are cut at `changesMax`.
 */
export function planChangesToRequests(
  changes: PlanChanges,
  locale: Locale,
): { mealItems: PlanMealChangesRequest[]; workouts: PlanWorkoutChangesRequest[] } {
  const merged = mergePlanChanges(changes);
  return {
    mealItems: chunk(
      {
        upserts: merged.mealItems.upserts.map(plannedItemToUpsert),
        deletes: merged.mealItems.deletes,
      },
      locale,
    ),
    workouts: chunk(
      {
        upserts: merged.workouts.upserts.map(plannedWorkoutToUpsert),
        deletes: merged.workouts.deletes,
      },
      locale,
    ),
  };
}
