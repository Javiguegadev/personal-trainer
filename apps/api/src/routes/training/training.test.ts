import {
  ApiErrorSchema,
  CONSENT_VERSION,
  CustomExerciseSaveResponseSchema,
  ExerciseCatalogResponseSchema,
  ExerciseHistoryResponseSchema,
  ExerciseStatsResponseSchema,
  ExportResponseSchema,
  WORKOUT_LIMITS,
  WorkoutLogResponseSchema,
  WorkoutSaveResponseSchema,
  type CustomExerciseUpsertRequest,
  type GymWorkoutRequest,
  type WorkoutUpsertRequest,
} from '@pt/contracts';
import { addDays } from '@pt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EXERCISE,
  NOW,
  OTHER_USER_ID,
  TODAY,
  createTestApp,
  exerciseCatalogFixture,
} from '../../test/fakes';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
  t.store.exerciseCatalog = exerciseCatalogFixture();
});

const WORKOUT = '70000000-0000-4000-8000-000000000001';
const WORKOUT_2 = '70000000-0000-4000-8000-000000000002';
const CUSTOM = '7e000000-0000-4000-8000-000000000001';
/** Device time `seconds` after the server clock of the tests. */
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const errorOf = async (res: Response) => ApiErrorSchema.parse(await res.json());

async function consent(token?: string) {
  await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION }, token);
}
async function asOther() {
  const token = await t.tokens.sign({ sub: OTHER_USER_ID });
  await consent(token);
  return token;
}

const set = (over: Partial<GymWorkoutRequest['exercises'][number]['sets'][number]> = {}) => ({
  reps: 8,
  weightKg: 60,
  durationS: null,
  distanceM: null,
  restS: 90,
  ...over,
});

const gym = (over: Partial<GymWorkoutRequest> = {}): GymWorkoutRequest => ({
  kind: 'gym',
  name: 'Pecho',
  minutes: 55,
  exercises: [
    { exerciseId: EXERCISE.bench, sets: [set(), set({ weightKg: 62.5, reps: 6 })] },
    { exerciseId: EXERCISE.pullUp, sets: [set({ weightKg: null, reps: 10 })] },
  ],
  inputMethod: 'live',
  programSessionId: null,
  localDate: TODAY,
  startedAt: '2026-11-11T08:00:00Z',
  sessionRpe: 7,
  recordedAt: at(60),
  today: TODAY,
  locale: 'es',
  ...over,
});

const football = (over: Partial<WorkoutUpsertRequest> = {}): WorkoutUpsertRequest =>
  ({
    kind: 'sport',
    activity: 'football',
    name: null,
    minutes: 90,
    inputMethod: 'activity',
    localDate: addDays(TODAY, -1),
    startedAt: '2026-11-10T19:00:00Z',
    sessionRpe: 8,
    recordedAt: at(60),
    today: TODAY,
    locale: 'es',
    ...over,
  }) as WorkoutUpsertRequest;

const custom = (over: Partial<CustomExerciseUpsertRequest> = {}): CustomExerciseUpsertRequest => ({
  name: 'Press Hammer',
  tracking: 'weight_reps',
  primaryMuscle: 'chest',
  recordedAt: at(10),
  ...over,
});

async function put(id: string, body: unknown, status = 200, token?: string) {
  const res = await t.call('PUT', `/me/workouts/${id}`, body, token);
  expect(res.status).toBe(status);
  return res;
}
const saved = async (res: Response) => WorkoutSaveResponseSchema.parse(await res.json()).workout;
const log = async (from = addDays(TODAY, -6), to = TODAY) =>
  WorkoutLogResponseSchema.parse(
    await (await t.call('GET', `/me/workouts?from=${from}&to=${to}`)).json(),
  ).workouts;
const catalog = async (token?: string) =>
  ExerciseCatalogResponseSchema.parse(
    await (await t.call('GET', '/exercises', undefined, token)).json(),
  );
const stats = async () =>
  ExerciseStatsResponseSchema.parse(await (await t.call('GET', '/me/exercises/stats')).json())
    .stats;

const ROUTES = [
  ['GET', '/exercises', undefined],
  ['PUT', `/me/exercises/${CUSTOM}`, custom()],
  ['DELETE', `/me/exercises/${CUSTOM}?recordedAt=${encodeURIComponent(at(0))}`, undefined],
  ['GET', '/me/exercises/stats', undefined],
  ['GET', `/me/exercises/${EXERCISE.bench}/history`, undefined],
  ['GET', `/me/workouts?from=${TODAY}&to=${TODAY}`, undefined],
  ['PUT', `/me/workouts/${WORKOUT}`, gym()],
  ['DELETE', `/me/workouts/${WORKOUT}?recordedAt=${encodeURIComponent(at(0))}`, undefined],
] as const;

describe('training routes: auth and consent', () => {
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
});

describe('GET /exercises and custom exercises (AC3, AC22)', () => {
  beforeEach(() => consent());

  it('returns the catalog with its version and only the user’s own exercises', async () => {
    const other = await asOther();
    await t.call('PUT', `/me/exercises/${CUSTOM}`, custom(), other);
    const mine = '7e000000-0000-4000-8000-000000000002';
    const res = await t.call('PUT', `/me/exercises/${mine}`, custom({ name: 'Remo río' }));
    expect(res.status).toBe(200);
    expect(CustomExerciseSaveResponseSchema.parse(await res.json()).exercise).toMatchObject({
      id: mine,
      origin: 'user',
      nameEs: 'Remo río',
      nameEn: 'Remo río',
      source: null,
    });

    const { version, exercises } = await catalog();
    expect(version).toBe('test-1');
    expect(exercises.map((e) => e.id)).toEqual([...Object.values(EXERCISE), mine]);
  });

  it('is idempotent and the later write wins, also against a delete', async () => {
    await t.call('PUT', `/me/exercises/${CUSTOM}`, custom());
    await t.call('PUT', `/me/exercises/${CUSTOM}`, custom({ name: 'Nuevo', recordedAt: at(30) }));
    // An older write arriving late changes nothing.
    const late = await t.call('PUT', `/me/exercises/${CUSTOM}`, custom({ name: 'Viejo' }));
    expect(CustomExerciseSaveResponseSchema.parse(await late.json()).exercise?.nameEs).toBe(
      'Nuevo',
    );

    await t.call('DELETE', `/me/exercises/${CUSTOM}?recordedAt=${encodeURIComponent(at(40))}`);
    expect((await catalog()).exercises.some((e) => e.id === CUSTOM)).toBe(false);
    const stale = await t.call('PUT', `/me/exercises/${CUSTOM}`, custom({ recordedAt: at(35) }));
    expect(stale.status).toBe(200);
    expect(CustomExerciseSaveResponseSchema.parse(await stale.json()).exercise).toBeNull();
  });

  it('answers 409 for a catalog id or another user’s id', async () => {
    const res = await t.call('PUT', `/me/exercises/${EXERCISE.bench}`, custom());
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('id_taken');

    const other = await asOther();
    await t.call('PUT', `/me/exercises/${CUSTOM}`, custom(), other);
    expect((await t.call('PUT', `/me/exercises/${CUSTOM}`, custom())).status).toBe(409);
    // Their delete does not touch it either.
    await t.call('DELETE', `/me/exercises/${CUSTOM}?recordedAt=${encodeURIComponent(at(90))}`);
    expect((await catalog(other)).exercises.some((e) => e.id === CUSTOM)).toBe(true);
  });

  it('rejects an invalid body, a device clock ahead and too many exercises', async () => {
    expect((await t.call('PUT', `/me/exercises/${CUSTOM}`, custom({ name: '' }))).status).toBe(400);
    const ahead = await t.call(
      'PUT',
      `/me/exercises/${CUSTOM}`,
      custom({ recordedAt: at(2 * 24 * 3600) }),
    );
    expect(await errorOf(ahead)).toMatchObject({ fields: { recordedAt: 'in_future' } });

    for (let i = 0; i < WORKOUT_LIMITS.customExercisesMax; i++) {
      t.store.customExercises.push({
        exercise: { ...(await catalog()).exercises[0]!, id: crypto.randomUUID(), origin: 'user' },
        ownerId: [...t.store.users.keys()][0]!,
        recordedAt: at(0),
        deletedAt: null,
      });
    }
    const full = await t.call('PUT', `/me/exercises/${CUSTOM}`, custom());
    expect(full.status).toBe(400);
    expect((await errorOf(full)).code).toBe('exercise_limit_reached');
  });
});

describe('PUT /me/workouts/:id (AC12, AC16, AC23)', () => {
  beforeEach(() => consent());

  it('stores a gym session with name snapshots in the user’s locale and numbered sets', async () => {
    const workout = await saved(await put(WORKOUT, gym()));
    expect(workout).toMatchObject({
      id: WORKOUT,
      kind: 'gym',
      activity: null,
      name: 'Pecho',
      minutes: 55,
      sessionRpe: 7,
      inputMethod: 'live',
      programSessionId: null,
      startedAt: '2026-11-11T08:00:00.000Z',
    });
    expect(workout?.exercises).toEqual([
      {
        exerciseId: EXERCISE.bench,
        label: 'Press de banca',
        tracking: 'weight_reps',
        sets: [
          { ...set(), setNumber: 1 },
          { ...set({ weightKg: 62.5, reps: 6 }), setNumber: 2 },
        ],
      },
      {
        exerciseId: EXERCISE.pullUp,
        label: 'Dominadas',
        tracking: 'reps',
        sets: [{ ...set({ weightKg: null, reps: 10 }), setNumber: 1 }],
      },
    ]);

    const en = await saved(await put(WORKOUT_2, gym({ locale: 'en' })));
    expect(en?.exercises.map((e) => e.label)).toEqual(['Bench press', 'Pull-up']);
  });

  it('stores a draft of the sentence shortcut with the text input method (spec 012 AC14)', async () => {
    const session = await saved(await put(WORKOUT, gym({ inputMethod: 'text' })));
    expect(session?.inputMethod).toBe('text');
    const activity = await saved(await put(WORKOUT_2, football({ inputMethod: 'text' })));
    expect(activity).toMatchObject({ kind: 'sport', activity: 'football', inputMethod: 'text' });
  });

  it('keeps only the values of the exercise’s tracking and rejects a set without them', async () => {
    const plank = {
      exerciseId: EXERCISE.plank,
      sets: [set({ reps: 3, weightKg: 10, durationS: 60 })],
    };
    const workout = await saved(await put(WORKOUT, gym({ exercises: [plank] })));
    expect(workout?.exercises[0]?.sets[0]).toMatchObject({ durationS: 60, reps: null });

    const res = await put(
      WORKOUT_2,
      gym({
        exercises: [
          { exerciseId: EXERCISE.bench, sets: [set()] },
          { exerciseId: EXERCISE.rowing, sets: [set(), set({ durationS: 600 })] },
        ],
      }),
      400,
    );
    expect(await errorOf(res)).toMatchObject({ fields: { 'exercises.1.sets.0': 'set_mismatch' } });
  });

  it('stores an activity without sets and rejects one shorter than 5 minutes', async () => {
    const workout = await saved(await put(WORKOUT, football()));
    expect(workout).toMatchObject({
      kind: 'sport',
      activity: 'football',
      minutes: 90,
      exercises: [],
      localDate: addDays(TODAY, -1),
    });
    await put(WORKOUT_2, football({ minutes: 4 }), 400);
  });

  it('answers 404 for an unknown exercise or another user’s, and accepts the user’s own', async () => {
    const unknown = gym({
      exercises: [{ exerciseId: '7e000000-0000-4000-8000-00000000ffff', sets: [set()] }],
    });
    expect(await errorOf(await put(WORKOUT, unknown, 404))).toMatchObject({
      fields: { exerciseId: 'not_found' },
    });

    const other = await asOther();
    await t.call('PUT', `/me/exercises/${CUSTOM}`, custom(), other);
    await put(WORKOUT, gym({ exercises: [{ exerciseId: CUSTOM, sets: [set()] }] }), 404);

    const mine = '7e000000-0000-4000-8000-000000000002';
    await t.call('PUT', `/me/exercises/${mine}`, custom({ name: 'Press Hammer' }));
    const workout = await saved(
      await put(WORKOUT, gym({ exercises: [{ exerciseId: mine, sets: [set()] }] })),
    );
    expect(workout?.exercises[0]?.label).toBe('Press Hammer');
  });

  it('keeps a deleted custom exercise loggable, so an old session can still be edited', async () => {
    await t.call('PUT', `/me/exercises/${CUSTOM}`, custom());
    await put(WORKOUT, gym({ exercises: [{ exerciseId: CUSTOM, sets: [set()] }] }));
    await t.call('DELETE', `/me/exercises/${CUSTOM}?recordedAt=${encodeURIComponent(at(20))}`);
    const edited = await saved(
      await put(
        WORKOUT,
        gym({ exercises: [{ exerciseId: CUSTOM, sets: [set(), set()] }], recordedAt: at(90) }),
      ),
    );
    expect(edited?.exercises[0]).toMatchObject({ label: 'Press Hammer', exerciseId: CUSTOM });
  });

  it('replaces the sets when the same write arrives twice (AC23)', async () => {
    await put(WORKOUT, gym());
    await put(WORKOUT, gym());
    const two = gym({
      exercises: [{ exerciseId: EXERCISE.bench, sets: [set({ weightKg: 70 })] }],
      recordedAt: at(120),
    });
    await put(WORKOUT, two);
    const [workout, ...rest] = await log();
    expect(rest).toEqual([]);
    expect(workout?.exercises).toHaveLength(1);
    expect(workout?.exercises[0]?.sets).toEqual([{ ...set({ weightKg: 70 }), setNumber: 1 }]);
  });

  it('lets the later recordedAt win whatever the order of arrival (AC23)', async () => {
    await put(WORKOUT, gym({ name: 'Nuevo', recordedAt: at(120) }));
    const late = await saved(await put(WORKOUT, gym({ name: 'Viejo', recordedAt: at(60) })));
    expect(late?.name).toBe('Nuevo');
    expect((await log())[0]?.name).toBe('Nuevo');
  });

  it('does not bring back a deleted workout with an earlier write, but a later one does (AC23)', async () => {
    await put(WORKOUT, gym());
    const del = await t.call(
      'DELETE',
      `/me/workouts/${WORKOUT}?recordedAt=${encodeURIComponent(at(100))}`,
    );
    expect(del.status).toBe(200);
    expect(await saved(del)).toBeNull();
    expect(await saved(await put(WORKOUT, gym({ recordedAt: at(90) })))).toBeNull();
    expect(await log()).toEqual([]);

    expect(await saved(await put(WORKOUT, gym({ recordedAt: at(110) })))).not.toBeNull();
  });

  it('never touches another user’s workout with the same id', async () => {
    const other = await asOther();
    await put(WORKOUT, gym({ name: 'Suyo' }), 200, other);
    expect(await saved(await put(WORKOUT, gym({ recordedAt: at(300) })))).toBeNull();
    await t.call('DELETE', `/me/workouts/${WORKOUT}?recordedAt=${encodeURIComponent(at(400))}`);
    const theirs = WorkoutLogResponseSchema.parse(
      await (
        await t.call('GET', `/me/workouts?from=${TODAY}&to=${TODAY}`, undefined, other)
      ).json(),
    ).workouts;
    expect(theirs.map((w) => w.name)).toEqual(['Suyo']);
  });

  it('applies the date rules of the food log', async () => {
    const future = await put(WORKOUT, gym({ localDate: addDays(TODAY, 1) }), 400);
    expect(await errorOf(future)).toMatchObject({ fields: { localDate: 'in_future' } });
    await put(WORKOUT, gym({ localDate: addDays(TODAY, -367) }), 400);
    await put(WORKOUT, gym({ today: addDays(TODAY, 3), localDate: addDays(TODAY, 3) }), 400);
    await put(WORKOUT, gym({ recordedAt: at(2 * 24 * 3600) }), 400);
    await put(WORKOUT, gym({ minutes: 601 }), 400);
    await put(WORKOUT, gym({ exercises: [] }), 400);
  });

  it('rejects an 11th workout on one day, but still accepts edits of that day', async () => {
    for (let i = 0; i < WORKOUT_LIMITS.workoutsPerDayMax; i++) {
      await put(`70000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, football());
    }
    const res = await put(WORKOUT, football(), 400);
    expect(await errorOf(res)).toMatchObject({ fields: { localDate: 'too_many_workouts' } });
    await put('70000000-0000-4000-8000-000000000100', football({ recordedAt: at(90) }));
  });
});

describe('GET /me/workouts', () => {
  beforeEach(() => consent());

  it('lists the range newest first and validates it', async () => {
    await put(WORKOUT, football());
    await put(WORKOUT_2, gym());
    expect((await log()).map((w) => w.id)).toEqual([WORKOUT_2, WORKOUT]);
    expect((await log(TODAY, TODAY)).map((w) => w.id)).toEqual([WORKOUT_2]);

    const after = await t.call('GET', `/me/workouts?from=${TODAY}&to=${addDays(TODAY, -1)}`);
    expect(after.status).toBe(400);
    const long = await t.call('GET', `/me/workouts?from=${addDays(TODAY, -63)}&to=${TODAY}`);
    expect(await errorOf(long)).toMatchObject({ fields: { to: 'too_big' } });
  });
});

describe('GET /me/exercises/stats and history (AC14, AC15)', () => {
  beforeEach(() => consent());

  const benchOn = (localDate: string, weightKg: number, recordedAt = at(60)) =>
    gym({
      localDate,
      startedAt: `${localDate}T08:00:00Z`,
      exercises: [{ exerciseId: EXERCISE.bench, sets: [set({ weightKg }), set({ weightKg })] }],
      recordedAt,
    });

  it('returns the last session, the bests with dates and when each exercise was last done', async () => {
    await put(WORKOUT, benchOn(addDays(TODAY, -7), 70));
    await put(WORKOUT_2, benchOn(TODAY, 62.5));
    await put('70000000-0000-4000-8000-000000000003', football());

    const [bench, ...rest] = await stats();
    expect(rest).toEqual([]);
    expect(bench).toMatchObject({
      exerciseId: EXERCISE.bench,
      lastDoneAt: `${TODAY}T08:00:00.000Z`,
      last: { workoutId: WORKOUT_2, localDate: TODAY },
      bests: { heaviestKg: { value: 70, localDate: addDays(TODAY, -7) } },
    });
    expect(bench?.last.sets.map((s) => s.setNumber)).toEqual([1, 2]);
  });

  it('forgets the sets of a deleted workout (the bests change on the next read)', async () => {
    await put(WORKOUT, benchOn(TODAY, 100));
    await t.call('DELETE', `/me/workouts/${WORKOUT}?recordedAt=${encodeURIComponent(at(100))}`);
    expect(await stats()).toEqual([]);
  });

  it('returns the last sessions of one exercise and its bests over the whole history', async () => {
    await put(WORKOUT, benchOn(addDays(TODAY, -7), 70));
    await put(WORKOUT_2, benchOn(TODAY, 62.5));
    const res = await t.call('GET', `/me/exercises/${EXERCISE.bench}/history?limit=1`);
    expect(res.status).toBe(200);
    const history = ExerciseHistoryResponseSchema.parse(await res.json());
    expect(history.sessions.map((s) => s.workoutId)).toEqual([WORKOUT_2]);
    expect(history.bests.heaviestKg?.value).toBe(70);

    const never = ExerciseHistoryResponseSchema.parse(
      await (await t.call('GET', `/me/exercises/${EXERCISE.plank}/history`)).json(),
    );
    expect(never.sessions).toEqual([]);
  });

  it('answers 404 for an unknown exercise or another user’s, and 400 for a bad limit', async () => {
    const unknown = '7e000000-0000-4000-8000-00000000ffff';
    expect((await t.call('GET', `/me/exercises/${unknown}/history`)).status).toBe(404);
    const other = await asOther();
    await t.call('PUT', `/me/exercises/${CUSTOM}`, custom(), other);
    expect((await t.call('GET', `/me/exercises/${CUSTOM}/history`)).status).toBe(404);
    const bad = await t.call('GET', `/me/exercises/${EXERCISE.bench}/history?limit=101`);
    expect(bad.status).toBe(400);
  });
});

describe('data export and account deletion (AC25)', () => {
  beforeEach(() => consent());

  it('exports every workout with its sets and the custom exercises, deleted ones dated', async () => {
    await t.call('PUT', `/me/exercises/${CUSTOM}`, custom());
    await put(WORKOUT, gym({ exercises: [{ exerciseId: CUSTOM, sets: [set()] }] }));
    await put(WORKOUT_2, football());
    await t.call('DELETE', `/me/exercises/${CUSTOM}?recordedAt=${encodeURIComponent(at(20))}`);

    const exported = ExportResponseSchema.parse(await (await t.call('GET', '/me/export')).json());
    expect(exported.workouts.map((w) => w.id)).toEqual([WORKOUT_2, WORKOUT]);
    expect(exported.workouts[1]?.exercises[0]?.sets).toHaveLength(1);
    expect(exported.customExercises).toMatchObject([
      { id: CUSTOM, nameEs: 'Press Hammer', deletedAt: NOW.toISOString() },
    ]);
  });

  it('deletes the workouts and custom exercises with the account', async () => {
    await t.call('PUT', `/me/exercises/${CUSTOM}`, custom());
    await put(WORKOUT, gym());
    expect((await t.call('DELETE', '/me')).status).toBe(204);
    expect(t.store.customExercises).toEqual([]);
    expect([...t.store.users.values()].flatMap((u) => u.workouts)).toEqual([]);
  });
});
