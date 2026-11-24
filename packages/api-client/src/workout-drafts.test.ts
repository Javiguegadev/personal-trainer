import {
  CONSENT_VERSION,
  WORKOUT_DRAFT_LIMITS,
  type WorkoutDraft,
  type WorkoutDraftResponse,
} from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { createApiClient, isApiError } from './client';
import { createMockApiClient } from './mock/backend';
import { mockAccessToken, mockUserFromEmail } from './mock/identity';

const NOW = new Date('2026-11-24T10:00:00.000Z');
const TODAY = '2026-11-24';
const BASE = 'https://api.test';

const codeOf = (error: unknown) => (isApiError(error) ? error.code : String(error));

async function setup() {
  const token = mockAccessToken(mockUserFromEmail('ana@example.com'));
  const api = createMockApiClient({ getAccessToken: async () => token, now: () => NOW });
  await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
  return api;
}

const body = (text: string, localDate = TODAY) => ({
  text,
  today: TODAY,
  localDate,
  locale: 'es' as const,
});

function draftOf(response: WorkoutDraftResponse): WorkoutDraft {
  if (response.status !== 'ok') throw new Error(`expected a draft, got ${response.reason}`);
  return response.draft;
}

describe('createApiClient: workout drafts (spec 012)', () => {
  it('posts the sentence to its route', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const empty: WorkoutDraftResponse = { status: 'unreadable', reason: 'not_workout' };
    const api = createApiClient({
      baseUrl: BASE,
      fetchImpl: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        return new Response(JSON.stringify(empty), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
      getAccessToken: async () => 'token',
    });
    expect(await api.draftWorkoutFromText(body('hola'))).toEqual(empty);
    expect(calls.map((c) => [c.init.method, c.url.replace(BASE, '')])).toEqual([
      ['POST', '/me/workouts/drafts/text'],
    ]);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(body('hola'));
  });
});

describe('mock backend: workout drafts (spec 012)', () => {
  it('drafts a gym session with sets, a day and an exercise it does not know', async () => {
    const api = await setup();
    const draft = draftOf(
      await api.draftWorkoutFromText(
        body('ayer press banca 4x8 con 60, sentadilla 3x10 y press larsen 3x8 con 50'),
      ),
    );
    expect(draft.localDate).toBe('2026-11-23');
    expect(draft.exercises.map((e) => [e.exercise.key, e.sets.length])).toEqual([
      ['press-banca', 4],
      ['sentadilla', 3],
    ]);
    expect(draft.exercises[0]?.sets[0]?.values).toMatchObject({ reps: 8, weightKg: 60 });
    expect(draft.exercises[1]?.sets[0]?.values).toMatchObject({ reps: 10, weightKg: null });
    expect(draft.unresolved.map((u) => [u.mention, u.sets.length, u.position])).toEqual([
      ['press larsen 3x8 con 50', 3, 2],
    ]);
  });

  it('drafts an activity, and a gym session with another activity as a line', async () => {
    const api = await setup();
    const padel = draftOf(await api.draftWorkoutFromText(body('pádel hora y media')));
    expect(padel.activity).toMatchObject({ activity: 'padel', minutes: 90 });
    const both = draftOf(
      await api.draftWorkoutFromText(body('press banca 3x8 con 60 y por la tarde fútbol 60 min')),
    );
    expect(both.exercises).toHaveLength(1);
    expect(both.extraActivities).toMatchObject([{ activity: 'football', minutes: 60 }]);
  });

  it('flags pain and reads a start time', async () => {
    const api = await setup();
    const draft = draftOf(
      await api.draftWorkoutFromText(
        body('a las 7 de la tarde press banca 3x8 con 60, me dolía el hombro'),
      ),
    );
    expect(draft.startTime).toBe('19:00');
    expect(draft.painMentioned).toBe(true);
    expect(draft.exercises).toHaveLength(1);
  });

  it('says a sentence without a workout has none, and a vague one is unclear (AC9)', async () => {
    const api = await setup();
    expect(await api.draftWorkoutFromText(body('hola, qué tal'))).toEqual({
      status: 'unreadable',
      reason: 'not_workout',
    });
    expect(await api.draftWorkoutFromText(body('lo de siempre'))).toEqual({
      status: 'unreadable',
      reason: 'unclear',
    });
  });

  it('rejects a short sentence and a screen day out of range', async () => {
    const api = await setup();
    expect(await api.draftWorkoutFromText(body('ab')).catch(codeOf)).toBe('validation_error');
    expect(await api.draftWorkoutFromText(body('remo 3x10', '2026-11-10')).catch(codeOf)).toBe(
      'validation_error',
    );
  });

  it('stops at its own daily cap and never keeps the sentence (AC17, AC20)', async () => {
    const api = await setup();
    for (let i = 0; i < WORKOUT_DRAFT_LIMITS.textsPerDay; i++) {
      await api.draftWorkoutFromText(body('remo con barra 3x10 con 40'));
    }
    expect(await api.draftWorkoutFromText(body('remo 3x10')).catch(codeOf)).toBe('ai_cap_reached');
    expect((await api.draftFromText({ text: 'dos huevos', locale: 'es' })).status).toBe('ok');
    const exported = await api.exportData();
    const features = exported.aiUsage.map((u) => u.feature);
    expect(features.filter((f) => f === 'workout_text')).toHaveLength(
      WORKOUT_DRAFT_LIMITS.textsPerDay,
    );
    expect(JSON.stringify(exported)).not.toContain('remo con barra 3x10');
  });
});
