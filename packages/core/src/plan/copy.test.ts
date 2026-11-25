import { MEAL_TYPES, PLAN_LIMITS } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { copyDay, copyWeek, type CopyInput } from './copy';
import {
  OLD_SESSION_ID,
  PROGRAM,
  RECORDED,
  SESSION_A,
  TODAY,
  idSequence,
  loggedItem,
  plannedActivity,
  plannedItem,
  plannedSession,
  uuid,
  workout,
} from './test-fixtures';

const MONDAY = '2026-11-23';
const FRIDAY = '2026-11-27';
const ZONE = 'Europe/Madrid';

/** Monday 23: what the day screen shows, logged and planned. */
const snackPlan = plannedItem({ id: uuid(10), localDate: MONDAY, mealType: 'afternoon_snack' });
const source = {
  logged: [
    loggedItem({ id: uuid(101), localDate: MONDAY, mealType: 'breakfast', grams: 80 }),
    loggedItem({
      id: uuid(102),
      localDate: MONDAY,
      mealType: 'lunch',
      foodId: null,
      grams: null,
      label: 'Menú del día',
      inputMethod: 'quick_add',
    }),
    // The planned snack, logged: it is copied once.
    loggedItem({
      id: uuid(103),
      localDate: MONDAY,
      mealType: 'afternoon_snack',
      plannedItemId: snackPlan.id,
      inputMethod: 'plan',
    }),
    loggedItem({ id: uuid(104), localDate: '2026-11-24', mealType: 'breakfast' }),
  ],
  workouts: [
    workout({ id: uuid(401), localDate: MONDAY, startedAt: '2026-11-23T17:30:00.000Z' }),
    workout({
      id: uuid(402),
      localDate: MONDAY,
      name: 'Torso',
      programSessionId: null,
      inputMethod: 'live',
      startedAt: '2026-11-23T12:00:00.000Z',
      minutes: 3,
    }),
    workout({
      id: uuid(403),
      localDate: MONDAY,
      kind: 'cardio',
      activity: 'running',
      name: null,
      programSessionId: null,
      inputMethod: 'activity',
      startedAt: '2026-11-23T07:00:00.000Z',
      minutes: 30,
    }),
  ],
  plan: {
    mealItems: [
      snackPlan,
      plannedItem({ id: uuid(11), localDate: MONDAY, mealType: 'dinner' }),
      plannedItem({ id: uuid(12), localDate: FRIDAY, mealType: 'dinner' }),
      plannedItem({ id: uuid(13), localDate: FRIDAY, mealType: 'lunch' }),
    ],
    workouts: [
      plannedActivity({ id: uuid(351), localDate: MONDAY, startMinute: 1200 }),
      plannedSession({ id: uuid(360), localDate: FRIDAY }),
    ],
  },
};

const input = (over: Partial<CopyInput> = {}): CopyInput => ({
  today: TODAY,
  what: { meals: MEAL_TYPES, sessions: true },
  ...source,
  program: PROGRAM,
  newId: idSequence(),
  recordedAt: RECORDED,
  timeZone: ZONE,
  ...over,
});

describe('copyDay (spec 013 AC19, AC20)', () => {
  it('copies what the day shows: logged and pending planned items and sessions', () => {
    const copy = copyDay({ ...input(), from: MONDAY, targets: [FRIDAY] });
    const meals = copy.changes.mealItems.upserts;
    expect(meals.map((m) => [m.mealType, m.label, m.localDate])).toEqual([
      ['breakfast', 'Arroz blanco cocido', FRIDAY],
      ['lunch', 'Menú del día', FRIDAY],
      ['afternoon_snack', 'Arroz blanco cocido', FRIDAY],
      ['dinner', 'Arroz blanco cocido', FRIDAY],
    ]);
    expect(meals[0]).toMatchObject({ foodId: source.logged[0]!.foodId, grams: 80 });
    expect(meals[1]).toMatchObject({ foodId: null, nutrients: source.logged[1]!.nutrients });
    const ids = [...meals, ...copy.changes.workouts.upserts].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('00000000-0000-4000-8000-0000000090'))).toBe(true);
    expect(meals.every((m) => m.recordedAt === RECORDED)).toBe(true);

    expect(copy.changes.workouts.upserts).toMatchObject([
      // 8:00 in Madrid: an activity keeps its minutes and time.
      { kind: 'cardio', activity: 'running', minutes: 30, startMinute: 480, isMatch: false },
      // Another gym workout becomes "Repetir".
      {
        kind: 'gym',
        name: 'Torso',
        minutes: 3,
        repeatWorkoutId: uuid(402),
        programSessionId: null,
      },
      // A workout of a routine session that still exists becomes that session.
      {
        kind: 'gym',
        name: SESSION_A.name,
        minutes: 55,
        startMinute: 1110,
        programSessionId: SESSION_A.id,
        repeatWorkoutId: null,
      },
      // The pending planned sessions.
      { kind: 'sport', name: 'Fútbol', startMinute: 1200 },
    ]);
    expect(copy.changes.workouts.upserts.every((w) => w.localDate === FRIDAY)).toBe(true);
    expect(copy.capped).toBe(false);
  });

  it('replaces the plan of the chosen kinds on the target days and undoes it', () => {
    const copy = copyDay({ ...input(), from: MONDAY, targets: [FRIDAY] });
    expect(copy.replacedDays).toEqual([FRIDAY]);
    expect(copy.changes.mealItems.deletes).toEqual([
      { id: uuid(12), recordedAt: RECORDED },
      { id: uuid(13), recordedAt: RECORDED },
    ]);
    expect(copy.changes.workouts.deletes).toEqual([{ id: uuid(360), recordedAt: RECORDED }]);

    const copies = copy.changes.mealItems.upserts.map((m) => ({ id: m.id, recordedAt: RECORDED }));
    expect(copy.undo.mealItems.deletes).toEqual(copies);
    expect(copy.undo.mealItems.upserts.map((m) => m.id)).toEqual([uuid(12), uuid(13)]);
    expect(copy.undo.workouts.upserts.map((w) => w.id)).toEqual([uuid(360)]);
    expect(copy.undo.workouts.deletes).toHaveLength(4);
  });

  it('copies a session of a deleted routine as the free gym session it shows as', () => {
    const stale = plannedSession({
      id: uuid(352),
      localDate: MONDAY,
      programSessionId: OLD_SESSION_ID,
      name: 'Pierna',
      startMinute: null,
    });
    const copy = copyDay({
      ...input({ workouts: [], plan: { mealItems: [], workouts: [stale] } }),
      from: MONDAY,
      targets: [FRIDAY],
    });
    expect(copy.changes.workouts.upserts).toMatchObject([
      { kind: 'gym', name: 'Pierna', startMinute: null, programSessionId: null },
    ]);
  });

  it('copies only some meal types, replaces only those, and never sessions when not chosen', () => {
    const copy = copyDay({
      ...input({ what: { meals: ['dinner'], sessions: false } }),
      from: MONDAY,
      targets: [FRIDAY, '2026-11-28'],
    });
    expect(copy.changes.mealItems.upserts.map((m) => [m.localDate, m.mealType])).toEqual([
      [FRIDAY, 'dinner'],
      ['2026-11-28', 'dinner'],
    ]);
    expect(copy.changes.mealItems.deletes).toEqual([{ id: uuid(12), recordedAt: RECORDED }]);
    expect(copy.changes.workouts).toEqual({ upserts: [], deletes: [] });
    expect(copy.replacedDays).toEqual([FRIDAY]);
  });

  it('skips the source day, days before today and days after the horizon', () => {
    const copy = copyDay({
      ...input(),
      from: MONDAY,
      targets: [MONDAY, '2026-11-24', '2026-12-21'],
    });
    expect(copy.changes.mealItems.upserts).toEqual([]);
    expect(copy.changes.workouts.upserts).toEqual([]);
    expect(copy.replacedDays).toEqual([]);
  });

  it('becomes "Repetir" without a routine', () => {
    const copy = copyDay({
      ...input({ program: null, what: { meals: [], sessions: true } }),
      from: MONDAY,
      targets: [FRIDAY],
    });
    expect(copy.changes.workouts.upserts[2]).toMatchObject({
      repeatWorkoutId: uuid(401),
      programSessionId: null,
    });
  });

  it('stays inside the limits of a day', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      plannedSession({ id: uuid(370 + i), localDate: MONDAY, startMinute: 600 + i }),
    );
    const sessions = copyDay({
      ...input({
        what: { meals: [], sessions: true },
        workouts: [],
        plan: { mealItems: [], workouts: many },
      }),
      from: MONDAY,
      targets: [FRIDAY],
    });
    expect(sessions.changes.workouts.upserts).toHaveLength(PLAN_LIMITS.sessionsPerDayMax);
    expect(sessions.capped).toBe(true);

    const full = Array.from({ length: PLAN_LIMITS.itemsPerDayMax - 1 }, (_, i) =>
      plannedItem({ id: uuid(2000 + i), localDate: FRIDAY, mealType: 'lunch' }),
    );
    const dinners = [
      plannedItem({ id: uuid(20), localDate: MONDAY }),
      plannedItem({ id: uuid(21), localDate: MONDAY }),
    ];
    const meals = copyDay({
      ...input({
        what: { meals: ['dinner'], sessions: false },
        logged: [],
        plan: { mealItems: [...full, ...dinners], workouts: [] },
      }),
      from: MONDAY,
      targets: [FRIDAY],
    });
    expect(meals.changes.mealItems.upserts).toHaveLength(1);
    expect(meals.capped).toBe(true);
  });
});

describe('copyWeek (AC21)', () => {
  it('copies each weekday to the same weekday of the target week', () => {
    const copy = copyWeek({ ...input(), fromWeek: MONDAY, toWeek: '2026-11-30' });
    const days = new Set(copy.changes.mealItems.upserts.map((m) => m.localDate));
    // Monday's logs and plan go to Monday 30; Tuesday's breakfast to Tuesday 1; Friday's plan to Friday 4.
    expect([...days].sort()).toEqual(['2026-11-30', '2026-12-01', '2026-12-04']);
    expect(copy.replacedDays).toEqual([]);
    expect(copy.changes.workouts.upserts.filter((w) => w.localDate === '2026-12-04')).toHaveLength(
      1,
    );
  });

  it('skips the days of the target week before today', () => {
    const copy = copyWeek({ ...input(), fromWeek: '2026-11-16', toWeek: MONDAY });
    const lastWeek = copyWeek({
      ...input({
        logged: [
          loggedItem({ id: uuid(110), localDate: '2026-11-16' }),
          loggedItem({ id: uuid(111), localDate: '2026-11-20' }),
        ],
        workouts: [],
        plan: { mealItems: [], workouts: [] },
      }),
      fromWeek: '2026-11-16',
      toWeek: MONDAY,
    });
    expect(copy.changes.mealItems.upserts).toEqual([]);
    expect(lastWeek.changes.mealItems.upserts.map((m) => m.localDate)).toEqual([FRIDAY]);
  });
});
