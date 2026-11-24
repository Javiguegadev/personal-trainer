import {
  CONSENT_VERSION,
  type MeResponse,
  type Program,
  type ProgramResponse,
  type ProgramUpsertRequest,
} from '@pt/contracts';
import {
  MutationObserver,
  QueryClient,
  dehydrate,
  hydrate,
  onlineManager,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { meKey } from './keys';
import { createMockApiClient } from './mock/backend';
import { MOCK_EXERCISES } from './mock/exercises';
import { mockAccessToken, mockUserFromEmail } from './mock/identity';
import { profileInput } from './test/fixtures';
import {
  programQueryOptions,
  registerTrainingMutations,
  saveProgramVariables,
  saveWorkoutVariables,
  trainingKeys,
  type DeleteProgramVariables,
  type SaveProgramVariables,
  type SaveTrainingProfileVariables,
  type SaveWorkoutVariables,
} from './training';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const TODAY = '2026-11-20';
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const uuid = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const programId = (n: number) => uuid('90000000', n);
const sessionId = (n: number) => uuid('91000000', n);

const exercise = (key: string) => {
  const found = MOCK_EXERCISES.find((e) => e.key === key);
  if (!found) throw new Error(`no mock exercise ${key}`);
  return found;
};
const bench = exercise('press-banca');
const plank = exercise('plancha');

const request = (over: Partial<ProgramUpsertRequest> = {}): ProgramUpsertRequest => ({
  name: 'Rutina de inicio',
  origin: 'template',
  templateKey: 'full-body-ab',
  sessions: [
    {
      id: sessionId(1),
      name: 'Rutina A',
      exercises: [
        { exerciseId: bench.id, sets: 3, repsMin: 8, repsMax: 12, durationS: null, restS: 120 },
        { exerciseId: plank.id, sets: 2, repsMin: null, repsMax: null, durationS: 30, restS: null },
      ],
    },
    { id: sessionId(2), name: 'Rutina B', exercises: [] },
  ],
  recordedAt: at(0),
  locale: 'es',
  ...over,
});

const routine = (n: number, over: Partial<ProgramUpsertRequest> = {}) =>
  saveProgramVariables(programId(n), request(over), MOCK_EXERCISES);

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
    save: observe<SaveProgramVariables, ProgramResponse>(trainingKeys.saveProgram),
    remove: observe<DeleteProgramVariables, ProgramResponse>(trainingKeys.deleteProgram),
    saveWorkout: observe<SaveWorkoutVariables, unknown>(trainingKeys.saveWorkout),
    saveAnswers: observe<SaveTrainingProfileVariables, MeResponse>(
      trainingKeys.saveTrainingProfile,
    ),
    cached: () => queryClient.getQueryData<Program | null>(trainingKeys.program),
    load: () => queryClient.fetchQuery(programQueryOptions(api)),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => onlineManager.setOnline(true));

describe('saveProgramVariables (spec 010 AC16)', () => {
  it('previews the routine the API will store, with labels in the locale', () => {
    const { preview } = routine(1, { locale: 'en' });
    expect(preview.sessions[0]!.exercises.map((e) => [e.label, e.tracking])).toEqual([
      [bench.nameEn, 'weight_reps'],
      [plank.nameEn, 'duration'],
    ]);
  });

  it('keeps an exercise of the routine being edited that the device no longer lists', () => {
    const { preview } = routine(1);
    const gone = MOCK_EXERCISES.filter((e) => e.id !== bench.id);
    const edited = saveProgramVariables(programId(1), request(), gone, preview);
    expect(edited.preview.sessions[0]!.exercises[0]!.label).toBe(bench.nameEs);
    expect(() => saveProgramVariables(programId(1), request(), gone)).toThrow();
  });
});

describe('routine mutations (spec 010 AC16, AC20–AC22)', () => {
  it('shows the routine at once, then the stored one', async () => {
    const { api, save, cached } = await setup();
    const pending = save(routine(1));
    await tick();
    expect(cached()?.sessions.map((s) => s.name)).toEqual(['Rutina A', 'Rutina B']);
    await pending;
    expect(cached()).toEqual((await api.program()).program);
  });

  it('changing the routine deletes the old one first, in the same queue (AC20)', async () => {
    const { api, save, remove, cached } = await setup();
    await save(routine(1));
    const replacement = routine(2, {
      sessions: [{ id: sessionId(3), name: 'Torso A', exercises: [] }],
      recordedAt: at(20),
    });
    const removing = remove({ id: programId(1), recordedAt: at(10) });
    const saving = save(replacement);
    await tick();
    expect(cached()?.id).toBe(programId(2));
    await Promise.all([removing, saving]);
    expect(cached()?.id).toBe(programId(2));
    expect((await api.program()).program?.id).toBe(programId(2));
  });

  it('a routine created offline is sent before the workout that uses it (AC21)', async () => {
    const { api, queryClient, save, saveWorkout } = await setup();
    onlineManager.setOnline(false);
    void save(routine(1));
    void saveWorkout(
      saveWorkoutVariables(
        uuid('70000000', 1),
        {
          kind: 'gym',
          name: 'Rutina A',
          minutes: 40,
          exercises: [
            {
              exerciseId: bench.id,
              sets: [{ reps: 12, weightKg: 40, durationS: null, distanceM: null, restS: 120 }],
            },
          ],
          inputMethod: 'program',
          programSessionId: sessionId(1),
          localDate: TODAY,
          startedAt: at(-3600),
          sessionRpe: null,
          recordedAt: at(30),
          today: TODAY,
          locale: 'es',
        },
        MOCK_EXERCISES,
      ),
    );
    await tick();
    const saved = JSON.parse(JSON.stringify(dehydrate(queryClient))) as ReturnType<
      typeof dehydrate
    >;
    expect(saved.mutations).toHaveLength(2);
    const restarted = client(api);
    hydrate(restarted.queryClient, saved);
    expect(restarted.cached()?.id).toBe(programId(1));

    onlineManager.setOnline(true);
    await restarted.queryClient.resumePausedMutations();
    const [workout] = (await api.listWorkouts({ from: TODAY, to: TODAY })).workouts;
    // Sent after the routine: the link to its session is kept.
    expect(workout?.programSessionId).toBe(sessionId(1));
  });

  it('undoes a routine the API rejects and says why', async () => {
    const { queryClient, save, cached, load } = await setup();
    await save(routine(1));
    await expect(
      save(routine(2, { sessions: [{ id: sessionId(9), name: 'A', exercises: [] }] })),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect(cached()?.id).toBe(programId(1));
    expect(queryClient.getQueryData(trainingKeys.rejected)).toMatchObject({
      id: programId(2),
      code: 'program_exists',
    });
    expect((await load())?.id).toBe(programId(1));
  });

  it('a delete wins over an older write (AC22)', async () => {
    const { api, save, remove, cached } = await setup();
    await save(routine(1));
    await remove({ id: programId(1), recordedAt: at(50) });
    expect(cached()).toBeNull();
    await save(routine(1, { recordedAt: at(40) }));
    expect(cached()).toBeNull();
    expect((await api.program()).program).toBeNull();
  });
});

describe('training profile answers (spec 010 AC14)', () => {
  it('shows the answers at once and stores them', async () => {
    const { api, queryClient, saveAnswers } = await setup();
    await api.updateProfile({ ...profileInput, today: TODAY });
    queryClient.setQueryData(meKey, await api.me());
    const pending = saveAnswers({
      id: 'user',
      update: { experience: 'beginner', equipment: 'bodyweight' },
    });
    await tick();
    expect(queryClient.getQueryData<MeResponse>(meKey)?.profile).toMatchObject({
      trainingExperience: 'beginner',
      equipmentAccess: 'bodyweight',
    });
    await pending;
    expect((await api.me()).profile).toMatchObject({
      trainingExperience: 'beginner',
      equipmentAccess: 'bodyweight',
    });
  });

  it('undoes the answers when the API refuses them (no profile)', async () => {
    const { queryClient, saveAnswers } = await setup();
    await expect(
      saveAnswers({ id: 'user', update: { experience: 'advanced', equipment: 'full_gym' } }),
    ).rejects.toMatchObject({ status: 400 });
    expect(queryClient.getQueryData(trainingKeys.rejected)).toMatchObject({
      code: 'validation_error',
      fields: { profile: 'required' },
    });
  });
});
