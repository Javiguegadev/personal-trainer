import { describe, expect, it } from 'vitest';
import { MealItemUpsertRequestSchema } from './food';
import {
  PLAN_LIMITS,
  PlanMealChangesRequestSchema,
  PlanWorkoutChangesRequestSchema,
  PlannedMealItemUpsertSchema,
  PlannedWorkoutUpsertSchema,
} from './plan';
import { WorkoutUpsertRequestSchema } from './training';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const recordedAt = '2026-11-24T10:00:00.000Z';

const plannedFood = {
  kind: 'food' as const,
  id: id(1),
  foodId: id(2),
  portion: { kind: 'grams' as const, grams: 150 },
  localDate: '2026-11-27',
  mealType: 'dinner' as const,
  recordedAt,
};

const routineSession = {
  kind: 'gym' as const,
  id: id(3),
  localDate: '2026-11-25',
  startMinute: 1110,
  name: 'Rutina B',
  minutes: 60,
  programSessionId: id(4),
  repeatWorkoutId: null,
  recordedAt,
};

const football = {
  kind: 'sport' as const,
  id: id(5),
  localDate: '2026-11-29',
  startMinute: 660,
  activity: 'football' as const,
  name: null,
  minutes: 90,
  isMatch: true,
  recordedAt,
};

describe('PlannedMealItemUpsertSchema (spec 013 AC5)', () => {
  it('accepts a catalog food with a portion and a quick add', () => {
    expect(PlannedMealItemUpsertSchema.parse(plannedFood)).toEqual(plannedFood);
    const quick = {
      kind: 'quick_add' as const,
      id: id(6),
      label: 'Tarta de la abuela',
      kcal: 350,
      proteinG: null,
      carbsG: 40,
      fatG: 18,
      localDate: '2026-11-27',
      mealType: 'afternoon_snack' as const,
      recordedAt,
    };
    expect(PlannedMealItemUpsertSchema.parse(quick)).toEqual(quick);
  });

  it('rejects a portion outside the food log limits', () => {
    const tooMuch = { ...plannedFood, portion: { kind: 'grams', grams: 2001 } };
    expect(PlannedMealItemUpsertSchema.safeParse(tooMuch).success).toBe(false);
  });
});

describe('PlannedWorkoutUpsertSchema (spec 013 AC10)', () => {
  it('accepts a routine session, a repeat, a free gym session and an activity', () => {
    expect(PlannedWorkoutUpsertSchema.parse(routineSession)).toEqual(routineSession);
    const repeat = { ...routineSession, programSessionId: null, repeatWorkoutId: id(7) };
    expect(PlannedWorkoutUpsertSchema.safeParse(repeat).success).toBe(true);
    const free = { ...routineSession, name: null, minutes: null, programSessionId: null };
    expect(PlannedWorkoutUpsertSchema.safeParse(free).success).toBe(true);
    expect(PlannedWorkoutUpsertSchema.parse(football)).toEqual(football);
  });

  it('rejects a gym session linked to a routine session and a workout at once', () => {
    const both = { ...routineSession, repeatWorkoutId: id(7) };
    expect(PlannedWorkoutUpsertSchema.safeParse(both).success).toBe(false);
  });

  it('rejects an activity without type or name, a kind that does not match, a non-sport match', () => {
    expect(PlannedWorkoutUpsertSchema.safeParse({ ...football, activity: null }).success).toBe(
      false,
    );
    expect(
      PlannedWorkoutUpsertSchema.safeParse({ ...football, activity: null, name: 'Fútbol 7' })
        .success,
    ).toBe(true);
    expect(PlannedWorkoutUpsertSchema.safeParse({ ...football, kind: 'cardio' }).success).toBe(
      false,
    );
    const run = { ...football, kind: 'cardio', activity: 'running', isMatch: true };
    expect(PlannedWorkoutUpsertSchema.safeParse(run).success).toBe(false);
    expect(PlannedWorkoutUpsertSchema.parse({ ...run, isMatch: undefined })).toMatchObject({
      isMatch: false,
    });
  });

  it('requires the minutes of an activity (at least 5) and keeps a gym session optional', () => {
    expect(PlannedWorkoutUpsertSchema.safeParse({ ...football, minutes: 4 }).success).toBe(false);
    expect(PlannedWorkoutUpsertSchema.safeParse({ ...football, minutes: null }).success).toBe(
      false,
    );
    expect(PlannedWorkoutUpsertSchema.safeParse({ ...routineSession, minutes: null }).success).toBe(
      true,
    );
  });

  it('rejects a start time outside the day', () => {
    expect(PlannedWorkoutUpsertSchema.safeParse({ ...football, startMinute: 1440 }).success).toBe(
      false,
    );
  });
});

describe('bulk plan writes (spec 013 AC23)', () => {
  it('defaults to no upserts and no deletes and to Spanish snapshots', () => {
    expect(PlanMealChangesRequestSchema.parse({})).toEqual({
      locale: 'es',
      upserts: [],
      deletes: [],
    });
  });

  it('rejects more than changesMax changes and a repeated id', () => {
    const deletes = Array.from({ length: PLAN_LIMITS.changesMax + 1 }, (_, n) => ({
      id: id(100 + n),
      recordedAt,
    }));
    expect(PlanMealChangesRequestSchema.safeParse({ deletes }).success).toBe(false);
    expect(
      PlanMealChangesRequestSchema.safeParse({ deletes: deletes.slice(0, PLAN_LIMITS.changesMax) })
        .success,
    ).toBe(true);
    const repeated = { upserts: [plannedFood], deletes: [{ id: plannedFood.id, recordedAt }] };
    expect(PlanMealChangesRequestSchema.safeParse(repeated).success).toBe(false);
    const twice = { upserts: [routineSession, routineSession] };
    expect(PlanWorkoutChangesRequestSchema.safeParse(twice).success).toBe(false);
  });
});

describe('links from the log to the plan (spec 013 AC8, AC15)', () => {
  it('lets a log item carry its planned item and the plan input method', () => {
    const base = {
      kind: 'food',
      foodId: id(2),
      portion: { kind: 'grams', grams: 150 },
      localDate: '2026-11-27',
      mealType: 'dinner',
      recordedAt,
      today: '2026-11-27',
    };
    expect(
      MealItemUpsertRequestSchema.parse({ ...base, inputMethod: 'search' }).plannedItemId,
    ).toBeUndefined();
    const logged = MealItemUpsertRequestSchema.parse({
      ...base,
      inputMethod: 'plan',
      plannedItemId: id(1),
    });
    expect(logged.plannedItemId).toBe(id(1));
    const quick = {
      ...base,
      kind: 'quick_add',
      label: 'Tarta',
      kcal: 300,
      proteinG: null,
      carbsG: null,
      fatG: null,
      inputMethod: 'plan',
    };
    expect(MealItemUpsertRequestSchema.safeParse(quick).success).toBe(true);
  });

  it('lets a workout carry its planned session, none by default', () => {
    const activity = {
      kind: 'sport',
      activity: 'football',
      name: null,
      minutes: 90,
      inputMethod: 'activity',
      localDate: '2026-11-29',
      startedAt: '2026-11-29T10:00:00.000Z',
      sessionRpe: null,
      recordedAt,
      today: '2026-11-29',
    };
    expect(WorkoutUpsertRequestSchema.parse(activity).plannedWorkoutId).toBeUndefined();
    expect(
      WorkoutUpsertRequestSchema.parse({ ...activity, plannedWorkoutId: id(5) }).plannedWorkoutId,
    ).toBe(id(5));
  });
});
