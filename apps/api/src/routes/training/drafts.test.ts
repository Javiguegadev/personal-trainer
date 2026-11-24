import { AiUnavailableError, type WorkoutReadInput } from '@pt/ai';
import {
  CONSENT_VERSION,
  WORKOUT_DRAFT_LIMITS,
  WorkoutDraftResponseSchema,
  type WorkoutReading,
  type WorkoutReadingSetGroup,
} from '@pt/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EXERCISE,
  NOW,
  TODAY,
  USER_ID,
  createTestApp,
  exerciseCatalogFixture,
  mealUsage,
  workoutUsage,
} from '../../test/fakes';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

const LARSEN = 'c1000000-0000-4000-8000-000000000001';
const SENTENCE = 'ayer press banca 4x8 con 60 y press Larsen 3x8 con 50';

beforeEach(async () => {
  t = await createTestApp();
  t.store.exerciseCatalog = exerciseCatalogFixture();
  await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });
});

const draftText = (body: unknown = {}, bearer?: string | null) =>
  t.call(
    'POST',
    '/me/workouts/drafts/text',
    { text: SENTENCE, today: TODAY, localDate: TODAY, ...(body as object) },
    bearer,
  );
const usage = () => t.store.rows(USER_ID).aiUsage;

const group = (over: Partial<WorkoutReadingSetGroup>): WorkoutReadingSetGroup => ({
  count: 1,
  reps: null,
  weight: null,
  weightUnit: 'kg',
  durationS: null,
  distanceM: null,
  ...over,
});

const reading = (over: Partial<WorkoutReading>): WorkoutReading => ({
  status: 'ok',
  gym: null,
  activities: [],
  daysAgo: null,
  startTime: null,
  painMentioned: false,
  ...over,
});

/** The ref the API gave an exercise in this call, by its Spanish name or own name. */
function refOf(input: WorkoutReadInput, name: string): string {
  const entry =
    input.catalog.find((e) => e.nameEs === name) ?? input.own.find((e) => e.name === name);
  if (!entry) throw new Error(`no ref for ${name}`);
  return entry.ref;
}

async function addLarsen() {
  const res = await t.call('PUT', `/me/exercises/${LARSEN}`, {
    name: 'Press Larsen',
    tracking: 'weight_reps',
    primaryMuscle: 'chest',
    recordedAt: NOW.toISOString(),
  });
  expect(res.status).toBe(200);
}

/** A model that reads the bench press and the user's own Larsen press. */
function benchAndLarsen() {
  t.workout.answer = (input) =>
    reading({
      gym: {
        exercises: [
          {
            mention: 'press banca 4x8 con 60',
            exerciseRef: refOf(input, 'Press de banca'),
            setGroups: [group({ count: 4, reps: 8, weight: 60 })],
          },
          {
            mention: 'press Larsen 3x8 con 50',
            exerciseRef: refOf(input, 'Press Larsen'),
            setGroups: [group({ count: 3, reps: 8, weight: 50 })],
          },
        ],
        minutes: null,
        sessionRpe: null,
      },
      daysAgo: 1,
    });
}

async function draftOf(res: Response) {
  expect(res.status).toBe(200);
  const body = WorkoutDraftResponseSchema.parse(await res.json());
  if (body.status !== 'ok') throw new Error(`expected a draft, got ${body.reason}`);
  return body.draft;
}

describe('POST /me/workouts/drafts/text (spec 012 AC3–AC9)', () => {
  it('returns the editable draft with catalog and own exercises, and records the call', async () => {
    await addLarsen();
    benchAndLarsen();
    const draft = await draftOf(await draftText());
    expect(draft.localDate).toBe('2026-11-10');
    expect(draft.exercises.map((e) => [e.exercise.id, e.sets.length])).toEqual([
      [EXERCISE.bench, 4],
      [LARSEN, 3],
    ]);
    expect(draft.exercises[0]?.sets[0]?.values).toEqual({
      reps: 8,
      weightKg: 60,
      durationS: null,
      distanceM: null,
    });
    expect(usage()).toMatchObject([
      { feature: 'workout_text', model: 'claude-haiku-5-5', status: 'ok' },
    ]);
  });

  it('shows the model short refs, names, synonyms and tracking, never ids', async () => {
    await addLarsen();
    benchAndLarsen();
    await draftText();
    const [input] = t.workout.calls;
    expect(input?.text).toBe(SENTENCE);
    expect(input?.today).toBe(TODAY);
    expect(input?.catalog.map((e) => e.ref)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(input?.catalog[0]).toEqual({
      ref: 'e1',
      nameEs: 'Press de banca',
      nameEn: 'Bench press',
      synonyms: [],
      tracking: 'weight_reps',
    });
    expect(input?.own).toEqual([{ ref: 'u1', name: 'Press Larsen', tracking: 'weight_reps' }]);
    expect(JSON.stringify(input)).not.toContain(EXERCISE.bench);
    expect(JSON.stringify(input)).not.toContain(LARSEN);
  });

  it('gives the same catalog entries to every call, so the prompt block stays cached', async () => {
    benchAndLarsen();
    t.workout.answer = () => reading({ status: 'not_workout' });
    await draftText();
    await draftText();
    const [first, second] = t.workout.calls;
    expect(first?.catalog).toBe(second?.catalog);
  });

  it('turns a ref it did not hand out into an unresolved mention (AC7, AC8)', async () => {
    t.workout.answer = () =>
      reading({
        gym: {
          exercises: [
            {
              mention: 'press Larsen 3x8',
              exerciseRef: 'u1',
              setGroups: [group({ count: 3, reps: 8 })],
            },
          ],
          minutes: null,
          sessionRpe: null,
        },
      });
    const draft = await draftOf(await draftText());
    expect(draft.exercises).toEqual([]);
    expect(draft.unresolved.map((u) => [u.mention, u.sets.length, u.position])).toEqual([
      ['press Larsen 3x8', 3, 0],
    ]);
  });

  it('returns an activity draft (AC5)', async () => {
    t.workout.answer = () =>
      reading({
        activities: [
          {
            mention: 'pádel hora y media',
            activity: 'padel',
            minutes: 90,
            sessionRpe: null,
            distanceSaid: false,
          },
        ],
      });
    const draft = await draftOf(await draftText({ text: 'pádel hora y media' }));
    expect(draft.activity).toMatchObject({ activity: 'padel', minutes: 90 });
    expect(draft.localDate).toBe(TODAY);
  });

  it('answers unreadable for a sentence without a workout (AC9)', async () => {
    t.workout.answer = () => reading({ status: 'not_workout' });
    const res = await draftText({ text: 'hola, ¿qué tal?' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'unreadable', reason: 'not_workout' });
  });

  it('keeps the day of the screen when no day was said', async () => {
    t.workout.answer = () =>
      reading({
        gym: {
          exercises: [
            {
              mention: 'dominadas 3x6',
              exerciseRef: 'e2',
              setGroups: [group({ count: 3, reps: 6 })],
            },
          ],
          minutes: null,
          sessionRpe: null,
        },
      });
    const draft = await draftOf(await draftText({ localDate: '2026-11-08' }));
    expect(draft.localDate).toBe('2026-11-08');
  });
});

describe('POST /me/workouts/drafts/text: errors and limits (AC16, AC17)', () => {
  it.each([
    [{ text: 'ab' }, 'text'],
    [{ text: 'x'.repeat(WORKOUT_DRAFT_LIMITS.textMax + 1) }, 'text'],
    [{ today: '2026-11-20' }, 'today'],
    [{ localDate: '2026-11-12' }, 'localDate'],
    [{ localDate: '2026-11-04' }, 'localDate'],
  ])('answers 400 for %j without calling the model', async (body, field) => {
    const res = await draftText(body);
    expect(res.status).toBe(400);
    const error = (await res.json()) as { code: string; fields?: Record<string, string> };
    expect(error.code).toBe('validation_error');
    expect(Object.keys(error.fields ?? {})).toContain(field);
    expect(t.workout.calls).toEqual([]);
  });

  it('answers 401 without a token and 403 without the current consent', async () => {
    expect((await draftText({}, null)).status).toBe(401);
    t.store.rows(USER_ID).consents = [];
    const res = await draftText();
    expect(res.status).toBe(403);
    expect(t.workout.calls).toEqual([]);
  });

  it('answers 503 when the model gives no usable draft, and records the failed call', async () => {
    t.workout.answer = new AiUnavailableError('refusal', workoutUsage('refusal'), 'refusal');
    const res = await draftText();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('ai_unavailable');
    expect(usage()).toMatchObject([{ feature: 'workout_text', status: 'refusal' }]);
  });

  it('answers 429 after 20 sentences in the UTC day, counting only this shortcut', async () => {
    t.workout.answer = () => reading({ status: 'not_workout' });
    for (let i = 0; i < 5; i++) await t.store.recordAiUsage(USER_ID, mealUsage('meal_text'), NOW);
    for (let i = 0; i < WORKOUT_DRAFT_LIMITS.textsPerDay; i++) {
      expect((await draftText()).status).toBe(200);
    }
    const res = await draftText();
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe('ai_cap_reached');
    expect(t.workout.calls).toHaveLength(WORKOUT_DRAFT_LIMITS.textsPerDay);
    // A new UTC day starts a new count.
    t.clock.now = new Date('2026-11-12T00:30:00Z');
    expect((await draftText({ today: '2026-11-12', localDate: '2026-11-12' })).status).toBe(200);
  });

  it('never stores the sentence (AC20)', async () => {
    benchAndLarsen();
    await draftText();
    const rows = JSON.stringify(t.store.rows(USER_ID));
    expect(rows).not.toContain('press banca');
    expect(rows).not.toContain('Larsen 3x8');
  });
});
