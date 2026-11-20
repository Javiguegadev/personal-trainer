import {
  ApiErrorSchema,
  CONSENT_VERSION,
  ExportResponseSchema,
  ProgramResponseSchema,
  WorkoutLogResponseSchema,
  WorkoutSaveResponseSchema,
  type GymWorkoutRequest,
  type ProgramUpsertRequest,
} from '@pt/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EXERCISE,
  NOW,
  OTHER_USER_ID,
  TODAY,
  USER_ID,
  createTestApp,
  exerciseCatalogFixture,
} from '../../test/fakes';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
  t.store.exerciseCatalog = exerciseCatalogFixture();
  await consent();
});

const PROGRAM = '90000000-0000-4000-8000-000000000001';
const PROGRAM_2 = '90000000-0000-4000-8000-000000000002';
const SESSION_A = '91000000-0000-4000-8000-00000000000a';
const SESSION_B = '91000000-0000-4000-8000-00000000000b';
const SESSION_C = '91000000-0000-4000-8000-00000000000c';
const WORKOUT = '70000000-0000-4000-8000-000000000001';
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

const routine = (over: Partial<ProgramUpsertRequest> = {}): ProgramUpsertRequest => ({
  name: 'Rutina de inicio',
  origin: 'template',
  templateKey: 'full-body-ab',
  sessions: [
    {
      id: SESSION_A,
      name: 'Rutina A',
      exercises: [
        {
          exerciseId: EXERCISE.bench,
          sets: 3,
          repsMin: 8,
          repsMax: 12,
          durationS: null,
          restS: 120,
        },
        {
          exerciseId: EXERCISE.plank,
          sets: 2,
          repsMin: null,
          repsMax: null,
          durationS: 30,
          restS: 60,
        },
      ],
    },
    {
      id: SESSION_B,
      name: 'Rutina B',
      exercises: [
        {
          exerciseId: EXERCISE.pullUp,
          sets: 3,
          repsMin: 6,
          repsMax: 10,
          durationS: null,
          restS: null,
        },
      ],
    },
  ],
  recordedAt: at(10),
  locale: 'es',
  ...over,
});

async function put(id: string, body: unknown, status = 200, token?: string) {
  const res = await t.call('PUT', `/me/program/${id}`, body, token);
  expect(res.status).toBe(status);
  return res;
}
const programOf = async (res: Response) => ProgramResponseSchema.parse(await res.json()).program;
const current = async (token?: string) =>
  programOf(await t.call('GET', '/me/program', undefined, token));
const remove = (id: string, recordedAt: string) =>
  t.call('DELETE', `/me/program/${id}?recordedAt=${encodeURIComponent(recordedAt)}`);

const workout = (over: Partial<GymWorkoutRequest> = {}): GymWorkoutRequest => ({
  kind: 'gym',
  name: 'Rutina A',
  minutes: 50,
  exercises: [
    {
      exerciseId: EXERCISE.bench,
      sets: [{ reps: 12, weightKg: 40, durationS: null, distanceM: null, restS: 120 }],
    },
  ],
  inputMethod: 'program',
  programSessionId: SESSION_A,
  localDate: TODAY,
  startedAt: '2026-11-11T08:00:00Z',
  sessionRpe: null,
  recordedAt: at(60),
  today: TODAY,
  locale: 'es',
  ...over,
});
const putWorkout = (body: unknown, token?: string) =>
  t.call('PUT', `/me/workouts/${WORKOUT}`, body, token);

describe('auth and consent', () => {
  it.each([
    ['GET', '/me/program'],
    ['PUT', `/me/program/${PROGRAM}`],
    ['DELETE', `/me/program/${PROGRAM}?recordedAt=${encodeURIComponent(at(0))}`],
  ])('%s %s without a token → 401', async (method, path) => {
    const res = await t.call(method, path, undefined, null);
    expect(res.status).toBe(401);
  });

  it.each([
    ['GET', '/me/program', undefined],
    ['PUT', `/me/program/${PROGRAM}`, routine()],
    ['DELETE', `/me/program/${PROGRAM}?recordedAt=${encodeURIComponent(at(0))}`, undefined],
  ])('%s %s without the current consent → 403', async (method, path, body) => {
    const token = await t.tokens.sign({ sub: OTHER_USER_ID });
    const res = await t.call(method, path, body, token);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('consent_required');
  });
});

describe('PUT /me/program/:id (spec 010 AC16, AC22)', () => {
  it('has no routine at first', async () => {
    expect(await current()).toBeNull();
  });

  it('stores the routine with name snapshots, in rotation order', async () => {
    const saved = await programOf(await put(PROGRAM, routine()));
    expect(saved).toMatchObject({
      id: PROGRAM,
      name: 'Rutina de inicio',
      origin: 'template',
      templateKey: 'full-body-ab',
    });
    expect(saved?.sessions.map((s) => s.id)).toEqual([SESSION_A, SESSION_B]);
    expect(saved?.sessions[0]?.exercises).toEqual([
      {
        exerciseId: EXERCISE.bench,
        label: 'Press de banca',
        tracking: 'weight_reps',
        sets: 3,
        repsMin: 8,
        repsMax: 12,
        durationS: null,
        restS: 120,
      },
      expect.objectContaining({ exerciseId: EXERCISE.plank, durationS: 30, repsMin: null }),
    ]);
    expect(await current()).toEqual(saved);
  });

  it('is idempotent: the same write twice gives one routine with those session ids', async () => {
    await put(PROGRAM, routine());
    const again = await programOf(await put(PROGRAM, routine()));
    expect(again?.sessions.map((s) => s.id)).toEqual([SESSION_A, SESSION_B]);
    expect(t.store.rows(USER_ID).programs).toHaveLength(1);
  });

  it('keeps the later write, whatever the order of arrival', async () => {
    await put(PROGRAM, routine({ name: 'Nueva', recordedAt: at(30) }));
    const stale = await programOf(
      await put(PROGRAM, routine({ name: 'Vieja', recordedAt: at(20) })),
    );
    expect(stale?.name).toBe('Nueva');
    expect((await current())?.name).toBe('Nueva');
  });

  it('a delete wins over an older write, and a later write brings it back (AC22)', async () => {
    await put(PROGRAM, routine({ recordedAt: at(10) }));
    expect((await remove(PROGRAM, at(20))).status).toBe(200);
    expect(await current()).toBeNull();
    expect(await programOf(await put(PROGRAM, routine({ recordedAt: at(15) })))).toBeNull();
    expect(await current()).toBeNull();
    expect(await programOf(await put(PROGRAM, routine({ recordedAt: at(25) })))).not.toBeNull();
  });

  it('allows one active routine: another one needs the old one deleted first (AC20)', async () => {
    await put(PROGRAM, routine());
    const other = routine({
      sessions: [{ ...routine().sessions[0]!, id: SESSION_C }],
    });
    const res = await put(PROGRAM_2, other, 409);
    expect((await errorOf(res)).code).toBe('program_exists');
    await remove(PROGRAM, at(20));
    const saved = await programOf(await put(PROGRAM_2, { ...other, recordedAt: at(30) }));
    expect(saved?.id).toBe(PROGRAM_2);
  });

  it('never touches another user’s routine or sessions (409 id_taken)', async () => {
    const other = await asOther();
    await put(PROGRAM, routine(), 200, other);
    expect((await errorOf(await put(PROGRAM, routine(), 409))).code).toBe('id_taken');
    const sameSessions = await put(PROGRAM_2, routine(), 409);
    expect((await errorOf(sameSessions)).code).toBe('id_taken');
    expect(await current()).toBeNull();
    expect((await current(other))?.id).toBe(PROGRAM);
  });

  it('rejects an unknown exercise or another user’s custom exercise with 404', async () => {
    const other = await asOther();
    await t.call(
      'PUT',
      `/me/exercises/${CUSTOM}`,
      { name: 'Press Hammer', tracking: 'weight_reps', primaryMuscle: 'chest', recordedAt: at(5) },
      other,
    );
    for (const exerciseId of [CUSTOM, '7e000000-0000-4000-8000-0000000000ff']) {
      const body = routine({
        sessions: [
          {
            id: SESSION_A,
            name: 'A',
            exercises: [
              { exerciseId, sets: 3, repsMin: 8, repsMax: 12, durationS: null, restS: null },
            ],
          },
        ],
      });
      const res = await put(PROGRAM, body, 404);
      expect((await errorOf(res)).fields).toEqual({ exerciseId: 'not_found' });
    }
  });

  it('rejects a target its exercise cannot use with 400', async () => {
    const body = routine({
      sessions: [
        {
          id: SESSION_A,
          name: 'A',
          exercises: [
            {
              exerciseId: EXERCISE.plank,
              sets: 2,
              repsMin: 8,
              repsMax: 12,
              durationS: null,
              restS: null,
            },
          ],
        },
      ],
    });
    const res = await put(PROGRAM, body, 400);
    expect((await errorOf(res)).fields).toEqual({ 'sessions.0.exercises.0': 'target_mismatch' });
  });

  it.each([
    ['no sessions', { sessions: [] }],
    [
      'a set count out of range',
      {
        sessions: [
          {
            id: SESSION_A,
            name: 'A',
            exercises: [
              {
                exerciseId: EXERCISE.bench,
                sets: 11,
                repsMin: 8,
                repsMax: 12,
                durationS: null,
                restS: null,
              },
            ],
          },
        ],
      },
    ],
    [
      'an inverted rep range',
      {
        sessions: [
          {
            id: SESSION_A,
            name: 'A',
            exercises: [
              {
                exerciseId: EXERCISE.bench,
                sets: 3,
                repsMin: 12,
                repsMax: 8,
                durationS: null,
                restS: null,
              },
            ],
          },
        ],
      },
    ],
    [
      'a repeated session id',
      {
        sessions: [
          { id: SESSION_A, name: 'A', exercises: [] },
          { id: SESSION_A, name: 'B', exercises: [] },
        ],
      },
    ],
    ['a device clock two days ahead', { recordedAt: at(2 * 24 * 3600) }],
  ])('rejects %s with 400', async (_, over) => {
    const res = await put(PROGRAM, routine(over as Partial<ProgramUpsertRequest>), 400);
    expect((await errorOf(res)).code).toBe('validation_error');
  });

  it('stores an empty session (the routine built by hand)', async () => {
    const body = routine({
      origin: 'user',
      templateKey: null,
      sessions: [{ id: SESSION_A, name: 'A', exercises: [] }],
    });
    const saved = await programOf(await put(PROGRAM, body));
    expect(saved?.sessions).toEqual([{ id: SESSION_A, name: 'A', exercises: [] }]);
  });
});

describe('workouts started from the routine (spec 010 AC18, AC19, AC22)', () => {
  it('stores the routine session of a workout', async () => {
    await put(PROGRAM, routine());
    const res = await putWorkout(workout());
    expect(res.status).toBe(200);
    const saved = WorkoutSaveResponseSchema.parse(await res.json()).workout;
    expect(saved).toMatchObject({ programSessionId: SESSION_A, inputMethod: 'program' });
  });

  it('a session removed from the routine leaves its workouts without the link (AC22)', async () => {
    await put(PROGRAM, routine());
    await putWorkout(workout());
    const onlyB = routine({ sessions: [routine().sessions[1]!], recordedAt: at(20) });
    await put(PROGRAM, onlyB);
    const [kept] = WorkoutLogResponseSchema.parse(
      await (await t.call('GET', `/me/workouts?from=${TODAY}&to=${TODAY}`)).json(),
    ).workouts;
    expect(kept).toMatchObject({ id: WORKOUT, programSessionId: null });
    expect(kept?.exercises[0]?.sets).toHaveLength(1);
  });

  it('a deleted routine keeps its sessions for the workouts that used them (AC20)', async () => {
    await put(PROGRAM, routine());
    await remove(PROGRAM, at(20));
    const res = await putWorkout(workout());
    expect(res.status).toBe(200);
    expect(WorkoutSaveResponseSchema.parse(await res.json()).workout?.programSessionId).toBe(
      SESSION_A,
    );
  });

  it('rejects another user’s routine session with 404', async () => {
    const other = await asOther();
    await put(PROGRAM, routine(), 200, other);
    const res = await putWorkout(workout());
    expect(res.status).toBe(404);
    expect((await errorOf(res)).fields).toEqual({ programSessionId: 'not_found' });
  });

  it('stores a queued workout of a session that no longer exists without the link', async () => {
    const res = await putWorkout(workout());
    expect(res.status).toBe(200);
    expect(WorkoutSaveResponseSchema.parse(await res.json()).workout?.programSessionId).toBeNull();
  });
});

describe('GET /me/export (spec 010 AC24)', () => {
  it('includes the routines, deleted ones with their date', async () => {
    await put(PROGRAM, routine());
    await remove(PROGRAM, at(20));
    await put(
      PROGRAM_2,
      routine({ sessions: [{ id: SESSION_C, name: 'C', exercises: [] }], recordedAt: at(30) }),
    );
    const data = ExportResponseSchema.parse(await (await t.call('GET', '/me/export')).json());
    expect(data.programs.map((p) => [p.id, p.deletedAt !== null])).toEqual([
      [PROGRAM, true],
      [PROGRAM_2, false],
    ]);
    expect(data.programs[0]?.sessions).toHaveLength(2);
  });

  it('DELETE /me removes the routines', async () => {
    await put(PROGRAM, routine());
    expect((await t.call('DELETE', '/me')).status).toBe(204);
    expect(await t.store.getProgram(USER_ID)).toBeNull();
  });
});
