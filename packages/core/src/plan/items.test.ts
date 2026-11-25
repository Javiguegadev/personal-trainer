import {
  MealItemUpsertRequestSchema,
  PlannedMealItemUpsertSchema,
  PlannedWorkoutUpsertSchema,
  type PlannedMealItemUpsert,
} from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import {
  defaultGymMinutes,
  logPlannedItems,
  plannedItemToUpsert,
  plannedMealItemFromUpsert,
  plannedSessionFor,
  plannedWorkoutToUpsert,
} from './items';
import {
  FOOTBALL,
  GYM_MWF,
  LATER,
  RECORDED,
  RICE,
  SERVING,
  SESSION_B,
  TODAY,
  idSequence,
  plannedActivity,
  plannedItem,
  plannedSession,
  uuid,
  workout,
} from './test-fixtures';

const foodUpsert: PlannedMealItemUpsert = {
  kind: 'food',
  id: uuid(1),
  localDate: '2026-11-27',
  mealType: 'dinner',
  foodId: RICE.id,
  portion: { kind: 'serving', servingId: SERVING, servings: 1.5 },
  recordedAt: RECORDED,
};

describe('plannedMealItemFromUpsert (spec 013 AC5)', () => {
  it('computes the snapshot of a catalog food from the catalog', () => {
    expect(plannedMealItemFromUpsert(foodUpsert, RICE)).toEqual({
      id: uuid(1),
      localDate: '2026-11-27',
      mealType: 'dinner',
      foodId: RICE.id,
      servingId: SERVING,
      servings: 1.5,
      servingLabel: '1 plato',
      grams: 300,
      unit: 'g',
      label: RICE.name,
      nutrients: { kcal: 390, proteinG: 8.1, carbsG: 84, fatG: 0.9, fiberG: 1.2 },
      recordedAt: RECORDED,
    });
  });

  it('keeps a quick add as typed, missing macros as 0', () => {
    const quick: PlannedMealItemUpsert = {
      kind: 'quick_add',
      id: uuid(2),
      localDate: '2026-11-27',
      mealType: 'lunch',
      label: 'Menú del día',
      kcal: 850,
      proteinG: null,
      carbsG: 90,
      fatG: null,
      recordedAt: RECORDED,
    };
    expect(plannedMealItemFromUpsert(quick, null)).toMatchObject({
      foodId: null,
      grams: null,
      label: 'Menú del día',
      nutrients: { kcal: 850, proteinG: 0, carbsG: 90, fatG: 0, fiberG: null },
    });
  });

  it('fails for an unknown food or serving', () => {
    expect(plannedMealItemFromUpsert(foodUpsert, null)).toEqual({ error: 'food_not_found' });
    const badServing = {
      ...foodUpsert,
      portion: { kind: 'serving' as const, servingId: uuid(9), servings: 1 },
    };
    expect(plannedMealItemFromUpsert(badServing, RICE)).toEqual({ error: 'serving_not_found' });
  });
});

describe('plannedItemToUpsert and plannedWorkoutToUpsert (AC6, AC12, AC22)', () => {
  it('writes a catalog item with its portion and a quick add from its snapshot', () => {
    const stored = plannedMealItemFromUpsert(foodUpsert, RICE);
    if ('error' in stored) throw new Error('unexpected');
    expect(plannedItemToUpsert(stored)).toEqual(foodUpsert);
    expect(plannedItemToUpsert(plannedItem({ grams: 150 }))).toMatchObject({
      kind: 'food',
      portion: { kind: 'grams', grams: 150 },
    });
    const gone = plannedItem({ foodId: null, label: 'Lentejas de la abuela' });
    const upsert = plannedItemToUpsert(gone);
    expect(upsert).toEqual({
      kind: 'quick_add',
      id: gone.id,
      localDate: gone.localDate,
      mealType: gone.mealType,
      label: 'Lentejas de la abuela',
      kcal: 260,
      proteinG: 5.4,
      carbsG: 56,
      fatG: 0.6,
      recordedAt: RECORDED,
    });
    expect(PlannedMealItemUpsertSchema.safeParse(upsert).success).toBe(true);
  });

  it('writes a gym session with its links and an activity with its type, minutes and match', () => {
    const gym = plannedWorkoutToUpsert(plannedSession());
    expect(PlannedWorkoutUpsertSchema.parse(gym)).toEqual(gym);
    expect(gym).toMatchObject({ kind: 'gym', programSessionId: plannedSession().programSessionId });
    const match = plannedWorkoutToUpsert(plannedActivity({ isMatch: true }));
    expect(PlannedWorkoutUpsertSchema.parse(match)).toEqual(match);
    expect(match).toMatchObject({ kind: 'sport', minutes: 90, isMatch: true, name: 'Fútbol' });
  });
});

describe('logPlannedItems (AC8)', () => {
  it('logs each pending item as a new item of that day, linked, with the input method plan', () => {
    const rice = plannedItem({ id: uuid(1), localDate: TODAY });
    const quick = plannedItem({ id: uuid(2), localDate: TODAY, foodId: null, label: 'Postre' });
    const logs = logPlannedItems([rice, quick], {
      recordedAt: LATER,
      today: TODAY,
      locale: 'es',
      newId: idSequence(),
    });
    expect(logs.map((l) => l.id)).toEqual([uuid(9000), uuid(9001)]);
    expect(logs[0]!.request).toEqual({
      kind: 'food',
      foodId: RICE.id,
      portion: { kind: 'grams', grams: 200 },
      inputMethod: 'plan',
      localDate: TODAY,
      mealType: 'dinner',
      recordedAt: LATER,
      today: TODAY,
      locale: 'es',
      plannedItemId: rice.id,
    });
    expect(logs[1]!.request).toMatchObject({
      kind: 'quick_add',
      inputMethod: 'plan',
      plannedItemId: quick.id,
    });
    for (const log of logs)
      expect(MealItemUpsertRequestSchema.safeParse(log.request).success).toBe(true);
    expect(logs[0]!.preview).toEqual({
      ...rice,
      id: uuid(9000),
      inputMethod: 'plan',
      plannedItemId: rice.id,
      recordedAt: LATER,
    });
  });
});

describe('plannedSessionFor and defaultGymMinutes (AC10)', () => {
  const placement = {
    id: uuid(310),
    localDate: '2026-11-27',
    startMinute: 1110,
    recordedAt: RECORDED,
  };

  it('defaults a gym session to the strength activity’s minutes', () => {
    expect(defaultGymMinutes([FOOTBALL, GYM_MWF])).toBe(60);
    expect(defaultGymMinutes([FOOTBALL])).toBeNull();
  });

  it('plans a routine session, a repeat, a free gym session or an activity', () => {
    expect(
      plannedSessionFor({ type: 'program', session: SESSION_B }, { ...placement, minutes: 60 }),
    ).toEqual({
      ...placement,
      kind: 'gym',
      activity: null,
      name: 'Rutina B',
      minutes: 60,
      isMatch: false,
      programSessionId: SESSION_B.id,
      repeatWorkoutId: null,
    });
    const past = workout({ id: uuid(401), name: 'Torso', programSessionId: null });
    expect(plannedSessionFor({ type: 'repeat', workout: past }, placement)).toMatchObject({
      kind: 'gym',
      name: 'Torso',
      minutes: null,
      programSessionId: null,
      repeatWorkoutId: past.id,
    });
    expect(plannedSessionFor({ type: 'free', name: 'Pierna' }, placement)).toMatchObject({
      kind: 'gym',
      name: 'Pierna',
      programSessionId: null,
      repeatWorkoutId: null,
    });
    const activity = plannedSessionFor(
      {
        type: 'activity',
        choice: { kind: 'sport', activity: null, name: 'Fútbol' },
        minutes: 90,
        isMatch: true,
      },
      placement,
    );
    expect(activity).toMatchObject({ kind: 'sport', name: 'Fútbol', minutes: 90, isMatch: true });
    const run = plannedSessionFor(
      {
        type: 'activity',
        choice: { kind: 'cardio', activity: 'running', name: null },
        minutes: 30,
        isMatch: true,
      },
      placement,
    );
    expect(run).toMatchObject({ kind: 'cardio', activity: 'running', isMatch: false });
  });
});
