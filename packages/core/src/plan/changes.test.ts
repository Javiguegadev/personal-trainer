import {
  PLAN_LIMITS,
  PlanMealChangesRequestSchema,
  PlanWorkoutChangesRequestSchema,
} from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_PLAN_CHANGES,
  isEmptyPlanChanges,
  mergePlanChanges,
  planChangeBatches,
  planChangesToRequests,
  stampChanges,
  type PlanChanges,
} from './changes';
import { LATER, RECORDED, plannedItem, plannedSession, uuid } from './test-fixtures';

describe('planChangesToRequests (spec 013 AC22)', () => {
  it('splits the changes per queue scope, deletes first', () => {
    const changes: PlanChanges = {
      mealItems: {
        upserts: [plannedItem({ id: uuid(1) })],
        deletes: [{ id: uuid(2), recordedAt: RECORDED }],
      },
      workouts: { upserts: [plannedSession({ id: uuid(3) })], deletes: [] },
    };
    const requests = planChangesToRequests(changes, 'en');
    expect(requests.mealItems).toHaveLength(1);
    expect(requests.workouts).toHaveLength(1);
    const meal = PlanMealChangesRequestSchema.parse(requests.mealItems[0]);
    expect(meal.locale).toBe('en');
    expect(meal.deletes).toEqual([{ id: uuid(2), recordedAt: RECORDED }]);
    expect(meal.upserts.map((u) => u.id)).toEqual([uuid(1)]);
    const sessions = PlanWorkoutChangesRequestSchema.parse(requests.workouts[0]);
    expect(sessions.upserts.map((u) => u.id)).toEqual([uuid(3)]);
  });

  it('cuts a big change into requests of at most changesMax, deletes in the first ones', () => {
    const upserts = Array.from({ length: 400 }, (_, i) => plannedItem({ id: uuid(1000 + i) }));
    const deletes = Array.from({ length: 250 }, (_, i) => ({
      id: uuid(5000 + i),
      recordedAt: RECORDED,
    }));
    const requests = planChangesToRequests(
      { mealItems: { upserts, deletes }, workouts: { upserts: [], deletes: [] } },
      'es',
    );
    expect(requests.workouts).toEqual([]);
    expect(requests.mealItems.map((r) => [r.deletes?.length, r.upserts?.length])).toEqual([
      [250, 50],
      [0, 300],
      [0, 50],
    ]);
    for (const request of requests.mealItems) {
      expect(PlanMealChangesRequestSchema.safeParse(request).success).toBe(true);
      expect((request.deletes?.length ?? 0) + (request.upserts?.length ?? 0)).toBeLessThanOrEqual(
        PLAN_LIMITS.changesMax,
      );
    }
  });

  it('keeps the last change of an id, so a request never repeats one', () => {
    const first = plannedItem({ id: uuid(1), grams: 100 });
    const second = plannedItem({ id: uuid(1), grams: 150 });
    const merged = mergePlanChanges(
      { ...EMPTY_PLAN_CHANGES, mealItems: { upserts: [first], deletes: [] } },
      { ...EMPTY_PLAN_CHANGES, mealItems: { upserts: [second], deletes: [] } },
      {
        ...EMPTY_PLAN_CHANGES,
        mealItems: { upserts: [], deletes: [{ id: uuid(2), recordedAt: RECORDED }] },
      },
    );
    const [request] = planChangesToRequests(merged, 'es').mealItems;
    expect(PlanMealChangesRequestSchema.safeParse(request).success).toBe(true);
    expect(request!.upserts).toHaveLength(1);
    expect(request!.upserts![0]).toMatchObject({ portion: { kind: 'grams', grams: 150 } });

    const deleted = mergePlanChanges(
      { ...EMPTY_PLAN_CHANGES, mealItems: { upserts: [first], deletes: [] } },
      {
        ...EMPTY_PLAN_CHANGES,
        mealItems: { upserts: [], deletes: [{ id: uuid(1), recordedAt: LATER }] },
      },
    );
    expect(deleted.mealItems).toEqual({
      upserts: [],
      deletes: [{ id: uuid(1), recordedAt: LATER }],
    });
  });

  it('gives the same batches as rows, for the optimistic cache', () => {
    const upserts = Array.from({ length: 301 }, (_, i) => plannedSession({ id: uuid(1000 + i) }));
    const batches = planChangeBatches({
      mealItems: { upserts: [], deletes: [] },
      workouts: { upserts, deletes: [{ id: uuid(2), recordedAt: RECORDED }] },
    });
    expect(batches.mealItems).toEqual([]);
    expect(batches.workouts.map((b) => [b.deletes.length, b.upserts.length])).toEqual([
      [1, 299],
      [0, 2],
    ]);
    expect(batches.workouts[1]!.upserts.map((u) => u.id)).toEqual([uuid(1299), uuid(1300)]);
  });

  it('sends nothing for empty changes', () => {
    expect(isEmptyPlanChanges(EMPTY_PLAN_CHANGES)).toBe(true);
    expect(planChangesToRequests(EMPTY_PLAN_CHANGES, 'es')).toEqual({
      mealItems: [],
      workouts: [],
    });
  });
});

describe('stampChanges (undo, AC20)', () => {
  it('gives every row and delete the time of the undo', () => {
    const stamped = stampChanges(
      {
        mealItems: { upserts: [plannedItem()], deletes: [{ id: uuid(2), recordedAt: RECORDED }] },
        workouts: { upserts: [plannedSession()], deletes: [] },
      },
      LATER,
    );
    expect(stamped.mealItems.upserts[0]!.recordedAt).toBe(LATER);
    expect(stamped.mealItems.deletes[0]!.recordedAt).toBe(LATER);
    expect(stamped.workouts.upserts[0]!.recordedAt).toBe(LATER);
  });
});
