import {
  CONSENT_VERSION,
  type Exercise,
  type ExerciseCatalogResponse,
  type ExerciseStats,
  type GymWorkoutRequest,
  type Workout,
  type WorkoutSaveResponse,
  type WorkoutSetInput,
} from '@pt/contracts';
import {
  MutationObserver,
  QueryClient,
  dehydrate,
  hydrate,
  onlineManager,
  skipToken,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockApiClient } from './mock/backend';
import { MOCK_EXERCISES } from './mock/exercises';
import { mockAccessToken, mockUserFromEmail } from './mock/identity';
import {
  exerciseCatalogQueryOptions,
  exerciseHistoryQueryOptions,
  exerciseStatsQueryOptions,
  registerTrainingMutations,
  saveWorkoutVariables,
  trainingKeys,
  withCustomExercise,
  withWorkout,
  workoutsQueryOptions,
  type DeleteCustomExerciseVariables,
  type DeleteWorkoutVariables,
  type SaveCustomExerciseVariables,
  type SaveWorkoutVariables,
} from './training';

const NOW = new Date('2026-11-18T10:00:00.000Z');
const TODAY = '2026-11-18';
const YESTERDAY = '2026-11-17';
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const workoutId = (n: number) => `70000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const ownId = (n: number) => `e1000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

const exercise = (key: string): Exercise => {
  const found = MOCK_EXERCISES.find((e) => e.key === key);
  if (!found) throw new Error(`no mock exercise ${key}`);
  return found;
};
const bench = exercise('press-banca');
const pullUps = exercise('dominadas');

const weightSet = (weightKg: number, reps: number): WorkoutSetInput => ({
  reps,
  weightKg,
  durationS: null,
  distanceM: null,
  restS: 90,
});

const gym = (
  exercises: GymWorkoutRequest['exercises'],
  over: Partial<GymWorkoutRequest> = {},
): GymWorkoutRequest => ({
  kind: 'gym',
  name: null,
  minutes: 55,
  exercises,
  inputMethod: 'live',
  localDate: TODAY,
  startedAt: `${over.localDate ?? TODAY}T08:00:00.000Z`,
  sessionRpe: 7,
  recordedAt: at(0),
  today: TODAY,
  locale: 'es',
  ...over,
});

const benchSession = (id: string, weightKg: number, over: Partial<GymWorkoutRequest> = {}) =>
  saveWorkoutVariables(
    id,
    gym([{ exerciseId: bench.id, sets: [weightSet(weightKg, 8), weightSet(weightKg, 8)] }], over),
    MOCK_EXERCISES,
  );

async function setup() {
  const token = mockAccessToken(mockUserFromEmail('ana@example.com'));
  const api = createMockApiClient({ getAccessToken: async () => token, now: () => NOW });
  await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
  return { api, ...client(api) };
}

function client(api: ReturnType<typeof createMockApiClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  registerTrainingMutations(queryClient, api);
  const observe =
    <V, R>(key: readonly string[]) =>
    (variables: V) =>
      new MutationObserver<R, unknown, V>(queryClient, { mutationKey: key }).mutate(variables);
  return {
    queryClient,
    save: observe<SaveWorkoutVariables, WorkoutSaveResponse>(trainingKeys.saveWorkout),
    remove: observe<DeleteWorkoutVariables, WorkoutSaveResponse>(trainingKeys.deleteWorkout),
    saveExercise: observe<SaveCustomExerciseVariables, unknown>(trainingKeys.saveExercise),
    removeExercise: observe<DeleteCustomExerciseVariables, unknown>(trainingKeys.deleteExercise),
    cached: () => queryClient.getQueryData<Workout[]>(trainingKeys.log) ?? [],
    stats: () => queryClient.getQueryData<ExerciseStats[]>(trainingKeys.stats) ?? [],
    catalog: () => queryClient.getQueryData<ExerciseCatalogResponse>(trainingKeys.catalog),
    load: () =>
      Promise.all([
        queryClient.fetchQuery(workoutsQueryOptions(api, TODAY)),
        queryClient.fetchQuery(exerciseStatsQueryOptions(api)),
        queryClient.fetchQuery(exerciseCatalogQueryOptions(api)),
      ]),
  };
}

const stored = async (api: Awaited<ReturnType<typeof setup>>['api']) =>
  (await api.listWorkouts({ from: '2026-10-01', to: TODAY })).workouts;

/** Lets the optimistic update (which awaits a cancel) reach the cache. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => onlineManager.setOnline(true));

describe('withWorkout and withCustomExercise', () => {
  const a = benchSession(workoutId(1), 60, { localDate: YESTERDAY }).preview;
  const b = benchSession(workoutId(2), 60).preview;
  const c = benchSession(workoutId(3), 60, { startedAt: '2026-11-18T18:00:00.000+01:00' }).preview;

  it('keeps the workouts newest first by day and start time, replaces and removes', () => {
    expect(withWorkout([a, b], workoutId(3), c).map((w) => w.id)).toEqual([
      workoutId(3),
      workoutId(2),
      workoutId(1),
    ]);
    expect(withWorkout([b, a], workoutId(2), null)).toEqual([a]);
    expect(withWorkout([b], workoutId(2), { ...b, minutes: 70 })[0]!.minutes).toBe(70);
  });

  it('puts a custom exercise after the catalog, most recently changed first', () => {
    const own = (n: number, name: string) => ({
      ...bench,
      id: ownId(n),
      origin: 'user' as const,
      nameEs: name,
    });
    const catalog = { version: 'v', exercises: [bench, pullUps, own(1, 'A')] };
    const next = withCustomExercise(catalog, ownId(2), own(2, 'B'));
    expect(next.exercises.map((e) => e.nameEs)).toEqual([bench.nameEs, pullUps.nameEs, 'B', 'A']);
    expect(withCustomExercise(next, ownId(1), null).exercises).toHaveLength(3);
  });
});

describe('saveWorkoutVariables', () => {
  it('previews the workout the API will store: labels, set numbers, only the tracked values', () => {
    const { preview } = saveWorkoutVariables(
      workoutId(1),
      gym([
        { exerciseId: bench.id, sets: [weightSet(60, 8)] },
        // A reps-only exercise may carry extra weight (lastre); time and distance are dropped.
        { exerciseId: pullUps.id, sets: [{ ...weightSet(0, 6), durationS: 30 }] },
      ]),
      MOCK_EXERCISES,
    );
    expect(preview.exercises.map((e) => [e.label, e.tracking])).toEqual([
      ['Press de banca', 'weight_reps'],
      [pullUps.nameEs, 'reps'],
    ]);
    expect(preview.exercises[0]!.sets[0]).toMatchObject({ setNumber: 1, weightKg: 60, reps: 8 });
    expect(preview.exercises[1]!.sets[0]!.durationS).toBeNull();
  });

  it('refuses an exercise the device does not know', () => {
    expect(() =>
      saveWorkoutVariables(
        workoutId(1),
        gym([{ exerciseId: ownId(9), sets: [weightSet(10, 10)] }]),
        MOCK_EXERCISES,
      ),
    ).toThrow();
  });

  it('keeps a deleted custom exercise loggable when its old session is edited', () => {
    const old: Workout = {
      ...benchSession(workoutId(1), 60).preview,
      exercises: [
        {
          exerciseId: ownId(1),
          label: 'Remo Hammer',
          tracking: 'weight_reps',
          sets: [{ ...weightSet(40, 10), setNumber: 1 }],
        },
      ],
    };
    const { preview } = saveWorkoutVariables(
      workoutId(1),
      gym([{ exerciseId: ownId(1), sets: [weightSet(42.5, 10)] }], { recordedAt: at(60) }),
      MOCK_EXERCISES,
      old,
    );
    expect(preview.exercises[0]).toMatchObject({ exerciseId: ownId(1), label: 'Remo Hammer' });
  });
});

describe('training queries (AC22)', () => {
  it('loads the workouts of today and the 59 days before, newest first', async () => {
    const { api, save, queryClient } = await setup();
    await save(benchSession(workoutId(1), 60, { localDate: '2026-09-20' }));
    await save(benchSession(workoutId(2), 60, { localDate: '2026-09-19' }));
    await save(benchSession(workoutId(3), 60, { localDate: YESTERDAY }));
    const workouts = await queryClient.fetchQuery(workoutsQueryOptions(api, TODAY));
    expect(workouts.map((w) => w.id)).toEqual([workoutId(3), workoutId(1)]);
  });

  it('loads the catalog with the user’s own exercises, and the history of one exercise', async () => {
    const { api, queryClient, save, saveExercise } = await setup();
    await saveExercise({
      id: ownId(1),
      request: {
        name: 'Remo Hammer',
        tracking: 'weight_reps',
        primaryMuscle: 'back',
        recordedAt: at(0),
      },
    });
    const catalog = await queryClient.fetchQuery(exerciseCatalogQueryOptions(api));
    expect(catalog.exercises).toHaveLength(MOCK_EXERCISES.length + 1);
    expect(catalog.exercises.at(-1)).toMatchObject({ id: ownId(1), origin: 'user' });

    expect(exerciseHistoryQueryOptions(api, null).queryFn).toBe(skipToken);
    await save(benchSession(workoutId(1), 60));
    const history = await queryClient.fetchQuery(exerciseHistoryQueryOptions(api, bench.id));
    expect(history.sessions.map((s) => s.workoutId)).toEqual([workoutId(1)]);
    expect(history.bests.heaviestKg).toEqual({ value: 60, localDate: TODAY });
  });
});

describe('workout mutations (AC10, AC19, AC22, AC23)', () => {
  it('shows the workout and its new bests at once, then the stored workout', async () => {
    const { api, save, cached, stats, load } = await setup();
    await save(benchSession(workoutId(1), 60, { localDate: YESTERDAY }));
    await load();

    const pending = save(benchSession(workoutId(2), 62.5, { recordedAt: at(60) }));
    await tick();
    expect(cached().map((w) => w.id)).toEqual([workoutId(2), workoutId(1)]);
    // A record of this session is known to the next one even before the API answers (AC10).
    expect(stats()[0]).toMatchObject({
      exerciseId: bench.id,
      last: { workoutId: workoutId(2) },
      bests: { heaviestKg: { value: 62.5, localDate: TODAY } },
    });

    await pending;
    expect(cached()).toEqual(await stored(api));
    expect(stats()).toEqual((await api.exerciseStats()).stats);
  });

  it('removes a workout at once, and an undo brings it back (AC19)', async () => {
    const { api, save, remove, cached, load } = await setup();
    const session = benchSession(workoutId(1), 60);
    await save(session);
    await load();

    const pending = remove({ id: workoutId(1), recordedAt: at(120) });
    await tick();
    expect(cached()).toEqual([]);
    await pending;
    expect(await stored(api)).toEqual([]);

    // Undo: the same workout written again after the delete.
    await save({
      ...session,
      request: { ...session.request, recordedAt: at(125) },
      preview: { ...session.preview, recordedAt: at(125) },
    });
    expect((await stored(api)).map((w) => w.id)).toEqual([workoutId(1)]);
  });

  it('queues writes made offline, in order, and sends them once after a restart (AC22)', async () => {
    const { api, queryClient, save, saveExercise, cached, catalog, load } = await setup();
    await load();
    onlineManager.setOnline(false);

    // A custom exercise created in the gym basement and used in the same session.
    const request = {
      name: 'Remo Hammer',
      tracking: 'weight_reps' as const,
      primaryMuscle: 'back' as const,
      recordedAt: at(0),
    };
    void saveExercise({ id: ownId(1), request });
    await tick();
    const known = catalog()!.exercises;
    expect(known.at(-1)).toMatchObject({ id: ownId(1), nameEs: 'Remo Hammer' });
    void save(
      saveWorkoutVariables(
        workoutId(1),
        gym([
          { exerciseId: bench.id, sets: [weightSet(60, 8)] },
          { exerciseId: ownId(1), sets: [weightSet(40, 10)] },
        ]),
        known,
      ),
    );
    await tick();
    expect(cached().map((w) => w.id)).toEqual([workoutId(1)]);
    expect(queryClient.isMutating({ mutationKey: trainingKeys.mutations })).toBe(2);
    expect(await stored(api)).toEqual([]);

    // The app is closed: only the dehydrated state survives.
    const saved = JSON.parse(JSON.stringify(dehydrate(queryClient))) as ReturnType<
      typeof dehydrate
    >;
    expect(saved.mutations).toHaveLength(2);
    const restarted = client(api);
    hydrate(restarted.queryClient, saved);
    expect(restarted.cached().map((w) => w.id)).toEqual([workoutId(1)]);

    onlineManager.setOnline(true);
    await restarted.queryClient.resumePausedMutations();
    const [workout] = await stored(api);
    expect(workout!.exercises.map((e) => e.label)).toEqual(['Press de banca', 'Remo Hammer']);
    expect(restarted.queryClient.isMutating()).toBe(0);
  });

  it('a later write wins whatever the order of arrival, and a delete stays (AC23)', async () => {
    const { api, save, remove } = await setup();
    await save(benchSession(workoutId(1), 60, { recordedAt: at(100) }));
    // An older edit arrives late: the API keeps the newer one and the cache shows it.
    const late = await save(benchSession(workoutId(1), 50, { recordedAt: at(50) }));
    expect(late.workout!.exercises[0]!.sets[0]!.weightKg).toBe(60);

    await remove({ id: workoutId(1), recordedAt: at(200) });
    await save(benchSession(workoutId(1), 70, { recordedAt: at(150) }));
    expect(await stored(api)).toEqual([]);
  });

  it('undoes a write the API rejects and says why (AC23)', async () => {
    const { api, queryClient, save, cached, load } = await setup();
    await load();
    await expect(
      save(benchSession(workoutId(1), 60, { localDate: '2026-11-19' })),
    ).rejects.toMatchObject({ status: 400 });
    expect(cached()).toEqual([]);
    expect(queryClient.getQueryData(trainingKeys.rejected)).toEqual({
      id: workoutId(1),
      code: 'validation_error',
      fields: { localDate: 'in_future' },
    });
    expect(await stored(api)).toEqual([]);
  });

  it('keeps retrying a write that fails with a network error', async () => {
    const { api } = await setup();
    let failures = 2;
    const flaky = {
      ...api,
      saveWorkout: (...args: Parameters<typeof api.saveWorkout>) => {
        if (failures-- > 0) return Promise.reject(new TypeError('Network request failed'));
        return api.saveWorkout(...args);
      },
    };
    const { queryClient, save, load } = client(flaky);
    queryClient.setMutationDefaults(trainingKeys.saveWorkout, {
      ...queryClient.getMutationDefaults(trainingKeys.saveWorkout),
      retryDelay: 0,
    });
    await load();
    await save(benchSession(workoutId(1), 60));
    expect(await stored(api)).toHaveLength(1);
    expect(queryClient.getQueryData(trainingKeys.rejected)).toBeNull();
  });
});

describe('custom exercise mutations', () => {
  it('removes a deleted exercise from the catalog; its past sets keep the label', async () => {
    const { api, save, saveExercise, removeExercise, catalog, load } = await setup();
    const request = {
      name: 'Remo Hammer',
      tracking: 'weight_reps' as const,
      primaryMuscle: null,
      recordedAt: at(0),
    };
    await saveExercise({ id: ownId(1), request });
    await load();
    await save(
      saveWorkoutVariables(
        workoutId(1),
        gym([{ exerciseId: ownId(1), sets: [weightSet(40, 10)] }]),
        catalog()!.exercises,
      ),
    );

    const pending = removeExercise({ id: ownId(1), recordedAt: at(60) });
    await tick();
    expect(catalog()!.exercises.some((e) => e.id === ownId(1))).toBe(false);
    await pending;
    expect((await api.exerciseCatalog()).exercises).toHaveLength(MOCK_EXERCISES.length);
    expect((await stored(api))[0]!.exercises[0]!.label).toBe('Remo Hammer');
  });

  it('undoes an exercise the API rejects (a catalog id)', async () => {
    const { queryClient, saveExercise, catalog, load } = await setup();
    await load();
    const request = {
      name: 'Copia',
      tracking: 'reps' as const,
      primaryMuscle: null,
      recordedAt: at(0),
    };
    await expect(saveExercise({ id: bench.id, request })).rejects.toMatchObject({ status: 409 });
    expect(catalog()!.exercises.find((e) => e.id === bench.id)).toEqual(bench);
    expect(queryClient.getQueryData(trainingKeys.rejected)).toMatchObject({
      id: bench.id,
      code: 'id_taken',
    });
  });
});
