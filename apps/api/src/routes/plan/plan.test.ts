import {
  ApiErrorSchema,
  CONSENT_VERSION,
  ExportResponseSchema,
  FoodLogResponseSchema,
  PLAN_LIMITS,
  PlanMealChangesResponseSchema,
  PlanResponseSchema,
  PlanWorkoutChangesResponseSchema,
  WorkoutLogResponseSchema,
  type PlanDelete,
  type PlannedMealItemUpsert,
  type PlannedWorkoutUpsert,
  type Program,
  type Workout,
} from '@pt/contracts';
import { addDays } from '@pt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EXERCISE,
  FOOD,
  NOW,
  OTHER_USER_ID,
  TODAY,
  USER_ID,
  catalogFixture,
  createTestApp,
  exerciseCatalogFixture,
} from '../../test/fakes';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
  t.store.catalog = catalogFixture();
  t.store.exerciseCatalog = exerciseCatalogFixture();
});

const id = (n: number) => `13000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SESSION_A = id(901);
const OTHER_SESSION = id(902);
const MY_WORKOUT = id(903);
const OTHER_WORKOUT = id(904);
const THURSDAY = addDays(TODAY, 2);

/** Device time `seconds` after the server clock of the tests. */
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const errorOf = async (res: Response) => ApiErrorSchema.parse(await res.json());

async function consent() {
  const res = await t.call('POST', '/me/consent', {
    kind: 'health_data',
    version: CONSENT_VERSION,
  });
  expect(res.status).toBe(204);
}

const eggs = (over: Partial<Extract<PlannedMealItemUpsert, { kind: 'food' }>> = {}) => ({
  kind: 'food' as const,
  id: id(1),
  foodId: FOOD.egg,
  portion: { kind: 'serving' as const, servingId: FOOD.eggMedium, servings: 2 },
  localDate: THURSDAY,
  mealType: 'dinner' as const,
  recordedAt: at(60),
  ...over,
});

const quick = (over: Partial<Extract<PlannedMealItemUpsert, { kind: 'quick_add' }>> = {}) => ({
  kind: 'quick_add' as const,
  id: id(2),
  label: 'Menú del día',
  kcal: 850,
  proteinG: null,
  carbsG: 90,
  fatG: null,
  localDate: THURSDAY,
  mealType: 'lunch' as const,
  recordedAt: at(60),
  ...over,
});

const gymPlan = (over: Partial<Extract<PlannedWorkoutUpsert, { kind: 'gym' }>> = {}) => ({
  kind: 'gym' as const,
  id: id(101),
  localDate: THURSDAY,
  startMinute: 1110,
  name: 'Rutina A',
  minutes: 60,
  programSessionId: SESSION_A,
  repeatWorkoutId: null,
  recordedAt: at(60),
  ...over,
});

const matchPlan = (over: Record<string, unknown> = {}) => ({
  kind: 'sport' as const,
  id: id(102),
  localDate: THURSDAY,
  startMinute: 660,
  activity: null,
  name: 'Fútbol 7',
  minutes: 90,
  isMatch: true,
  recordedAt: at(60),
  ...over,
});

async function postMeals(
  upserts: unknown[],
  deletes: PlanDelete[] = [],
  status = 200,
  locale = 'es',
) {
  const res = await t.call('POST', '/me/plan/meal-items', { locale, upserts, deletes });
  expect(res.status).toBe(status);
  return res;
}

async function postSessions(upserts: unknown[], deletes: PlanDelete[] = [], status = 200) {
  const res = await t.call('POST', '/me/plan/workouts', { upserts, deletes });
  expect(res.status).toBe(status);
  return res;
}

async function plan(from = addDays(TODAY, -1), to = addDays(TODAY, 28)) {
  const res = await t.call('GET', `/me/plan?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  return PlanResponseSchema.parse(await res.json());
}

/** A routine of the user with session A, and one of another user. */
function seedRoutines() {
  const routine = (programId: string, sessionId: string): Program & { deletedAt: null } => ({
    id: programId,
    name: 'Rutina',
    origin: 'user',
    templateKey: null,
    sessions: [{ id: sessionId, name: 'Rutina A', exercises: [] }],
    recordedAt: at(0),
    deletedAt: null,
  });
  t.store.rows(USER_ID).programs.push(routine(id(900), SESSION_A));
  t.store.rows(OTHER_USER_ID).programs.push(routine(id(910), OTHER_SESSION));
}

/** A past gym workout of the user (to repeat) and one of another user. */
function seedWorkouts() {
  const workout = (workoutId: string): Workout & { deleted: boolean } => ({
    id: workoutId,
    localDate: addDays(TODAY, -2),
    kind: 'gym',
    activity: null,
    name: 'Torso',
    startedAt: '2026-11-09T18:00:00.000Z',
    minutes: 50,
    sessionRpe: null,
    inputMethod: 'live',
    programSessionId: null,
    plannedWorkoutId: null,
    exercises: [],
    recordedAt: '2026-11-09T19:00:00.000Z',
    deleted: false,
  });
  t.store.rows(USER_ID).workouts.push(workout(MY_WORKOUT));
  t.store.rows(OTHER_USER_ID).workouts.push(workout(OTHER_WORKOUT));
}

const ROUTES = [
  ['GET', `/me/plan?from=${TODAY}&to=${TODAY}`, undefined],
  ['POST', '/me/plan/meal-items', { upserts: [eggs()] }],
  ['POST', '/me/plan/workouts', { upserts: [matchPlan()] }],
] as const;

describe('plan routes: auth and consent (spec 013 AC24)', () => {
  it.each(ROUTES)('%s %s without a token → 401', async (method, path, body) => {
    const res = await t.call(method, path, body, null);
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('unauthorized');
  });

  it.each(ROUTES)('%s %s without consent → 403', async (method, path, body) => {
    const res = await t.call(method, path, body);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('consent_required');
  });

  it('asks again a user who accepted the text before plans (2026-11-v9)', async () => {
    expect(CONSENT_VERSION).toBe('2026-11-v10');
    await t.store.grantConsent(USER_ID, 'health_data', '2026-11-v9', NOW);
    const res = await t.call('GET', `/me/plan?from=${TODAY}&to=${TODAY}`);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('consent_required');
  });
});

describe('GET /me/plan (spec 013 AC22)', () => {
  beforeEach(consent);

  it('is empty without a plan, and reads at most 63 days in order', async () => {
    expect(await plan()).toEqual({ mealItems: [], workouts: [] });
    const tooBig = await t.call('GET', `/me/plan?from=${TODAY}&to=${addDays(TODAY, 64)}`);
    expect(tooBig.status).toBe(400);
    expect((await errorOf(tooBig)).fields).toEqual({ to: 'too_big' });
    const reversed = await t.call('GET', `/me/plan?from=${TODAY}&to=${addDays(TODAY, -1)}`);
    expect(reversed.status).toBe(400);
  });
});

describe('POST /me/plan/meal-items (AC5, AC6, AC23)', () => {
  beforeEach(consent);

  it('stores a catalog food with the snapshot computed by the API, and a quick add', async () => {
    const res = await postMeals([eggs(), quick()]);
    const { mealItems } = PlanMealChangesResponseSchema.parse(await res.json());
    expect(mealItems).toEqual([
      {
        id: id(1),
        localDate: THURSDAY,
        mealType: 'dinner',
        foodId: FOOD.egg,
        servingId: FOOD.eggMedium,
        servings: 2,
        servingLabel: '1 huevo mediano',
        grams: 110,
        unit: 'g',
        label: 'Huevo',
        nutrients: { kcal: 154, proteinG: 13.97, carbsG: 0.33, fatG: 10.81, fiberG: 0 },
        recordedAt: at(60),
      },
      expect.objectContaining({
        id: id(2),
        foodId: null,
        label: 'Menú del día',
        nutrients: { kcal: 850, proteinG: 0, carbsG: 90, fatG: 0, fiberG: null },
      }),
    ]);
    expect((await plan()).mealItems).toEqual(mealItems);
  });

  it('takes the snapshot names in the request locale', async () => {
    const res = await postMeals([eggs()], [], 200, 'en');
    expect(PlanMealChangesResponseSchema.parse(await res.json()).mealItems[0]).toMatchObject({
      label: 'Egg',
      servingLabel: '1 medium egg',
    });
  });

  it('keeps one row per id when a write is sent twice', async () => {
    await postMeals([eggs(), quick()]);
    await postMeals([eggs(), quick()]);
    expect((await plan()).mealItems).toHaveLength(2);
  });

  it('lets the later recordedAt win, in either order of arrival', async () => {
    await postMeals([eggs({ mealType: 'lunch', recordedAt: at(120) })]);
    const older = await postMeals([eggs({ mealType: 'breakfast', recordedAt: at(60) })]);
    // The older write loses and the response carries the newer row.
    expect(PlanMealChangesResponseSchema.parse(await older.json()).mealItems[0]!.mealType).toBe(
      'lunch',
    );
    await postMeals([eggs({ localDate: addDays(THURSDAY, 1), recordedAt: at(180) })]);
    expect((await plan()).mealItems.map((i) => i.localDate)).toEqual([addDays(THURSDAY, 1)]);
  });

  it('keeps a delete: a later write with an earlier time does not bring it back', async () => {
    await postMeals([eggs({ recordedAt: at(60) })]);
    await postMeals([], [{ id: id(1), recordedAt: at(120) }]);
    expect((await plan()).mealItems).toEqual([]);
    const res = await postMeals([eggs({ recordedAt: at(90) })]);
    expect(PlanMealChangesResponseSchema.parse(await res.json()).mealItems).toEqual([]);
    expect((await plan()).mealItems).toEqual([]);
    // A newer write does.
    await postMeals([eggs({ recordedAt: at(180) })]);
    expect((await plan()).mealItems).toHaveLength(1);
  });

  it('replaces a plan in one request: deletes and new rows (a copy, AC20)', async () => {
    await postMeals([eggs(), quick()]);
    await postMeals(
      [eggs({ id: id(3), recordedAt: at(120) })],
      [
        { id: id(1), recordedAt: at(120) },
        { id: id(2), recordedAt: at(120) },
      ],
    );
    expect((await plan()).mealItems.map((i) => i.id)).toEqual([id(3)]);
  });

  it('accepts a date from yesterday to today + 28 days, server UTC (AC23)', async () => {
    await postMeals([eggs({ localDate: addDays(TODAY, -1) })]);
    await postMeals([eggs({ id: id(4), localDate: addDays(TODAY, 28) })]);
    for (const [localDate, reason] of [
      [addDays(TODAY, -2), 'too_old'],
      [addDays(TODAY, 29), 'too_far'],
    ] as const) {
      const res = await postMeals([quick(), eggs({ id: id(5), localDate })], [], 400);
      expect((await errorOf(res)).fields).toEqual({ 'upserts.1.localDate': reason });
    }
    const ahead = await postMeals([eggs({ recordedAt: at(2 * 86_400) })], [], 400);
    expect((await errorOf(ahead)).fields).toEqual({ 'upserts.0.recordedAt': 'in_future' });
    // A delete has no date: it is always accepted.
    await postMeals([], [{ id: id(6), recordedAt: at(60) }]);
  });

  it('answers 404 for an unknown food or another user’s food, and 400 for a bad serving', async () => {
    const unknown = await postMeals([eggs({ foodId: id(700) })], [], 404);
    expect((await errorOf(unknown)).fields).toEqual({ 'upserts.0.foodId': 'not_found' });
    t.store.extraFoods.push({
      ...catalogFixture()[0]!,
      id: id(701),
      key: `user-${id(701)}`,
      origin: 'manual',
      ownerId: OTHER_USER_ID,
      servings: [],
    });
    await postMeals([eggs({ foodId: id(701), portion: { kind: 'grams', grams: 100 } })], [], 404);
    const serving = await postMeals(
      [eggs({ portion: { kind: 'serving', servingId: FOOD.milkGlass, servings: 1 } })],
      [],
      400,
    );
    expect((await errorOf(serving)).fields).toEqual({ 'upserts.0.portion.servingId': 'not_found' });
    expect((await plan()).mealItems).toEqual([]);
  });

  it('answers 409 for an id of another user, and writes nothing', async () => {
    t.store.rows(OTHER_USER_ID).plannedMealItems.push({
      id: id(1),
      localDate: THURSDAY,
      mealType: 'dinner',
      foodId: null,
      servingId: null,
      servings: null,
      servingLabel: null,
      grams: null,
      unit: 'g',
      label: 'Ajeno',
      nutrients: { kcal: 100, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null },
      recordedAt: at(0),
      deletedAt: null,
    });
    const res = await postMeals([quick(), eggs()], [], 409);
    expect((await errorOf(res)).code).toBe('id_taken');
    expect((await plan()).mealItems).toEqual([]);
  });

  it(`refuses more than ${PLAN_LIMITS.itemsPerDayMax} planned items on a day`, async () => {
    const items = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => quick({ id: id(1000 + from + i) }));
    await postMeals(items(0, PLAN_LIMITS.itemsPerDayMax));
    const res = await postMeals(items(PLAN_LIMITS.itemsPerDayMax, 1), [], 400);
    expect((await errorOf(res)).fields).toEqual({ 'upserts.0.localDate': 'too_many_items' });
    // Replacing one keeps the day inside the limit.
    await postMeals(items(PLAN_LIMITS.itemsPerDayMax, 1), [{ id: id(1000), recordedAt: at(90) }]);
  });

  it('refuses more than 300 changes in one request', async () => {
    const upserts = Array.from({ length: PLAN_LIMITS.changesMax + 1 }, (_, i) =>
      quick({ id: id(3000 + i) }),
    );
    await postMeals(upserts, [], 400);
  });
});

describe('POST /me/plan/workouts (AC10–AC12, AC23)', () => {
  beforeEach(async () => {
    await consent();
    seedRoutines();
    seedWorkouts();
  });

  it('stores a routine session, a repeat, a free gym session and a match, by day and time', async () => {
    const res = await postSessions([
      gymPlan(),
      gymPlan({ id: id(103), programSessionId: null, repeatWorkoutId: MY_WORKOUT, name: 'Torso' }),
      gymPlan({ id: id(104), programSessionId: null, name: null, startMinute: null }),
      matchPlan(),
    ]);
    const { workouts } = PlanWorkoutChangesResponseSchema.parse(await res.json());
    expect(workouts.map((w) => w.id)).toEqual([id(101), id(103), id(104), id(102)]);
    expect(workouts[3]).toEqual({
      id: id(102),
      localDate: THURSDAY,
      startMinute: 660,
      kind: 'sport',
      activity: null,
      name: 'Fútbol 7',
      minutes: 90,
      isMatch: true,
      programSessionId: null,
      repeatWorkoutId: null,
      recordedAt: at(60),
    });
    // The read sorts by day and start time, untimed last.
    expect((await plan()).workouts.map((w) => w.id)).toEqual([id(102), id(101), id(103), id(104)]);
  });

  it('answers 404 for another user’s routine session or workout', async () => {
    const session = await postSessions([gymPlan({ programSessionId: OTHER_SESSION })], [], 404);
    expect((await errorOf(session)).fields).toEqual({ 'upserts.0.programSessionId': 'not_found' });
    const workout = await postSessions(
      [gymPlan({ programSessionId: null, repeatWorkoutId: OTHER_WORKOUT })],
      [],
      404,
    );
    expect((await errorOf(workout)).fields).toEqual({ 'upserts.0.repeatWorkoutId': 'not_found' });
    expect((await plan()).workouts).toEqual([]);
  });

  it('keeps a session whose routine session or workout is unknown, as a free gym session', async () => {
    const res = await postSessions([
      gymPlan({ programSessionId: id(950), name: 'Rutina C' }),
      gymPlan({ id: id(103), programSessionId: null, repeatWorkoutId: id(951), name: 'Torso' }),
    ]);
    expect(PlanWorkoutChangesResponseSchema.parse(await res.json()).workouts).toMatchObject([
      { name: 'Rutina C', programSessionId: null, repeatWorkoutId: null },
      { name: 'Torso', programSessionId: null, repeatWorkoutId: null },
    ]);
  });

  it('reads a repeat of a deleted workout as a free gym session', async () => {
    await postSessions([
      gymPlan({ programSessionId: null, repeatWorkoutId: MY_WORKOUT, name: 'Torso' }),
    ]);
    t.store.rows(USER_ID).workouts.find((w) => w.id === MY_WORKOUT)!.deleted = true;
    expect((await plan()).workouts[0]).toMatchObject({ name: 'Torso', repeatWorkoutId: null });
  });

  it('refuses a fifth session on a day, an id of another user, and invalid kinds', async () => {
    await postSessions(
      [1, 2, 3, 4].map((n) => matchPlan({ id: id(200 + n), startMinute: 400 + n * 60 })),
    );
    const fifth = await postSessions([gymPlan()], [], 400);
    expect((await errorOf(fifth)).fields).toEqual({ 'upserts.0.localDate': 'too_many_sessions' });
    await postSessions([gymPlan({ localDate: addDays(THURSDAY, 1) })]);

    t.store.rows(OTHER_USER_ID).plannedWorkouts.push({
      ...matchPlan({ id: id(300) }),
      programSessionId: null,
      repeatWorkoutId: null,
      deletedAt: null,
    });
    await postSessions([matchPlan({ id: id(300), localDate: addDays(THURSDAY, 2) })], [], 409);

    await postSessions([gymPlan({ id: id(301), repeatWorkoutId: MY_WORKOUT })], [], 400);
    await postSessions([matchPlan({ id: id(302), kind: 'cardio', activity: 'running' })], [], 400);
  });

  it('keeps a delete against an older write (AC23)', async () => {
    await postSessions([gymPlan({ recordedAt: at(60) })]);
    await postSessions([], [{ id: id(101), recordedAt: at(120) }]);
    await postSessions([gymPlan({ recordedAt: at(90) })]);
    expect((await plan()).workouts).toEqual([]);
  });
});

describe('the logs link back to the plan (AC8, AC15, AC23)', () => {
  beforeEach(async () => {
    await consent();
    seedRoutines();
  });

  const logItem = (plannedItemId: string | null) => ({
    kind: 'food' as const,
    foodId: FOOD.egg,
    portion: { kind: 'serving' as const, servingId: FOOD.eggMedium, servings: 2 },
    inputMethod: 'plan' as const,
    localDate: TODAY,
    mealType: 'dinner' as const,
    recordedAt: at(120),
    today: TODAY,
    locale: 'es' as const,
    plannedItemId,
  });

  const logWorkout = (plannedWorkoutId: string | null) => ({
    kind: 'gym' as const,
    name: 'Rutina A',
    minutes: 55,
    exercises: [
      {
        exerciseId: EXERCISE.bench,
        sets: [{ reps: 8, weightKg: 60, durationS: null, distanceM: null, restS: 90 }],
      },
    ],
    inputMethod: 'program' as const,
    programSessionId: SESSION_A,
    localDate: TODAY,
    startedAt: '2026-11-11T08:00:00Z',
    sessionRpe: null,
    recordedAt: at(120),
    today: TODAY,
    locale: 'es' as const,
    plannedWorkoutId,
  });

  it('stores the link of a logged planned item; another user’s is 404, an unknown one is dropped', async () => {
    await postMeals([eggs({ localDate: TODAY })]);
    const put = (itemId: string, body: unknown) =>
      t.call('PUT', `/me/food-log/items/${itemId}`, body);
    expect((await put(id(20), logItem(id(1)))).status).toBe(200);
    expect((await put(id(21), logItem(id(999)))).status).toBe(200);
    const { items } = FoodLogResponseSchema.parse(
      await (await t.call('GET', `/me/food-log?from=${TODAY}&to=${TODAY}`)).json(),
    );
    expect(items.map((i) => [i.id, i.plannedItemId, i.inputMethod])).toEqual([
      [id(20), id(1), 'plan'],
      [id(21), null, 'plan'],
    ]);
    t.store.rows(OTHER_USER_ID).plannedMealItems.push({
      ...(await plan()).mealItems[0]!,
      id: id(30),
      deletedAt: null,
    });
    const other = await put(id(22), logItem(id(30)));
    expect(other.status).toBe(404);
    expect((await errorOf(other)).fields).toEqual({ plannedItemId: 'not_found' });
    // The planned row never changes when it is logged (the plan reads it as done).
    expect((await plan()).mealItems.map((i) => i.id)).toEqual([id(1)]);
  });

  it('stores the link of a workout that does a planned session; another user’s is 404', async () => {
    await postSessions([gymPlan({ localDate: TODAY })]);
    const put = (workoutId: string, body: unknown) =>
      t.call('PUT', `/me/workouts/${workoutId}`, body);
    expect((await put(id(40), logWorkout(id(101)))).status).toBe(200);
    expect((await put(id(41), logWorkout(id(998)))).status).toBe(200);
    const { workouts } = WorkoutLogResponseSchema.parse(
      await (await t.call('GET', `/me/workouts?from=${TODAY}&to=${TODAY}`)).json(),
    );
    expect(workouts.map((w) => [w.id, w.plannedWorkoutId, w.programSessionId]).sort()).toEqual([
      [id(40), id(101), SESSION_A],
      [id(41), null, SESSION_A],
    ]);
    t.store.rows(OTHER_USER_ID).plannedWorkouts.push({
      ...(await plan()).workouts[0]!,
      id: id(50),
      deletedAt: null,
    });
    const other = await put(id(42), logWorkout(id(50)));
    expect(other.status).toBe(404);
    expect((await errorOf(other)).fields).toEqual({ plannedWorkoutId: 'not_found' });
  });
});

describe('GET /me/export with the plan (AC25)', () => {
  beforeEach(async () => {
    await consent();
    seedRoutines();
  });

  it('includes the planned rows, deleted ones with their date, and the links of the logs', async () => {
    await postMeals([eggs(), quick()]);
    await postMeals([], [{ id: id(2), recordedAt: at(120) }]);
    await postSessions([gymPlan()]);
    await t.call('PUT', `/me/food-log/items/${id(20)}`, {
      kind: 'quick_add',
      label: 'Cena',
      kcal: 500,
      proteinG: null,
      carbsG: null,
      fatG: null,
      inputMethod: 'plan',
      localDate: TODAY,
      mealType: 'dinner',
      recordedAt: at(120),
      today: TODAY,
      plannedItemId: id(1),
    });
    const res = await t.call('GET', '/me/export');
    expect(res.status).toBe(200);
    const exported = ExportResponseSchema.parse(await res.json());
    expect(exported.plan.mealItems.map((i) => [i.id, i.deletedAt !== null])).toEqual([
      [id(1), false],
      [id(2), true],
    ]);
    expect(exported.plan.workouts.map((w) => [w.id, w.deletedAt])).toEqual([[id(101), null]]);
    expect(exported.mealItems.map((i) => i.plannedItemId)).toEqual([id(1)]);
  });
});
