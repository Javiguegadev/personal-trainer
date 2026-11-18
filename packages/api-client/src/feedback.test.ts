import {
  CONSENT_VERSION,
  FEEDBACK_LIMITS,
  type DailyFeedbackResponse,
  type MealItem,
} from '@pt/contracts';
import { feedbackFingerprint } from '@pt/core';
import { describe, expect, it } from 'vitest';
import { createApiClient, isApiError } from './client';
import { feedbackIsStale, writeTouchesDay } from './feedback';
import { foodKeys } from './foods';
import { MOCK_CATALOG, toMockFood } from './mock/foods';
import { createMockApiClient } from './mock/backend';
import { mockAccessToken, mockUserFromEmail } from './mock/identity';
import { profileInput } from './test/fixtures';

const NOW = new Date('2026-11-11T10:00:00.000Z');
const TODAY = '2026-11-11';
const BASE = 'https://api.test';
const ITEM = '50000000-0000-4000-8000-000000000001';

const codeOf = (error: unknown) => (isApiError(error) ? error.code : String(error));
const request = (
  over: Partial<Parameters<ReturnType<typeof createApiClient>['dailyFeedback']>[0]> = {},
) => ({
  localDate: TODAY,
  today: TODAY,
  localTime: '10:30',
  trainingDay: false,
  locale: 'es' as const,
  ...over,
});

async function setup(healthFlags: ('ed_soft_stop' | 'pregnancy')[] = []) {
  const token = mockAccessToken(mockUserFromEmail('ana@example.com'));
  const api = createMockApiClient({ getAccessToken: async () => token, now: () => NOW });
  await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
  await api.updateProfile({ ...profileInput, healthFlags });
  return api;
}

const egg = toMockFood(
  MOCK_CATALOG.find((f) => f.key === 'd-huevo')!,
  'es',
);

async function logEggs(api: Awaited<ReturnType<typeof setup>>) {
  await api.saveMealItem(ITEM, {
    kind: 'food',
    foodId: egg.id,
    portion: { kind: 'serving', servingId: egg.servings[0]!.id, servings: 2 },
    inputMethod: 'search',
    localDate: TODAY,
    mealType: 'breakfast',
    recordedAt: NOW.toISOString(),
    today: TODAY,
    locale: 'es',
  });
}

describe('createApiClient: daily feedback (spec 008)', () => {
  it('posts the request to its route', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const body: DailyFeedbackResponse = {
      localDate: TODAY,
      state: 'closed',
      notes: [
        {
          observation: {
            kind: 'on_track',
            numbers: {
              nutrient: null,
              eaten: null,
              target: null,
              left: null,
              mealsLeft: [],
              perMeal: [],
            },
            citation: 'own_targets',
          },
          text: null,
          source: 'template',
          suggestions: [],
        },
      ],
      citations: ['own_targets'],
      fingerprint: '0-811c9dc5',
    };
    const api = createApiClient({
      baseUrl: BASE,
      fetchImpl: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        return Response.json(body);
      }) as typeof fetch,
    });
    expect(await api.dailyFeedback(request())).toEqual(body);
    expect(calls.map((c) => [c.init.method, c.url.replace(BASE, '')])).toEqual([
      ['POST', '/me/food-log/feedback'],
    ]);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(request());
  });
});

describe('mock backend: daily feedback (spec 008)', () => {
  it('gives scripted AI notes with the user foods, and the fixed wording for the rest', async () => {
    const api = await setup();
    await logEggs(api);
    const feedback = await api.dailyFeedback(request());
    expect(feedback.state).toBe('in_progress');
    expect(feedback.notes.map((n) => [n.observation.kind, n.source])).toEqual([
      ['protein_gap', 'ai'],
      ['fiber_gap', 'ai'],
    ]);
    expect(feedback.notes[0]?.suggestions.map((s) => s.food.id)).toEqual([egg.id]);
    const { items } = await api.listFoodLog({ from: TODAY, to: TODAY });
    expect(feedback.fingerprint).toBe(feedbackFingerprint(items));

    const past = await api.dailyFeedback(request({ localDate: '2026-11-10' }));
    expect(past.notes.map((n) => [n.observation.kind, n.source])).toEqual([
      ['day_incomplete', 'template'],
    ]);
  });

  it('uses only the fixed wording past the daily cap (AC15)', async () => {
    const api = await setup();
    await logEggs(api);
    for (let i = 0; i < FEEDBACK_LIMITS.aiPerDay; i++) await api.dailyFeedback(request());
    const capped = await api.dailyFeedback(request());
    expect(capped.notes.every((n) => n.source === 'template' && n.text === null)).toBe(true);
  });

  it('answers 422 with ed_soft_stop or without numeric targets, 400 for a bad day (AC2)', async () => {
    for (const flags of [['ed_soft_stop'], ['pregnancy']] as const) {
      const api = await setup([...flags]);
      expect(await api.dailyFeedback(request()).catch(codeOf)).toBe('feedback_unavailable');
    }
    const api = await setup();
    expect(await api.dailyFeedback(request({ localDate: '2026-11-12' })).catch(codeOf)).toBe(
      'validation_error',
    );
    expect(await api.dailyFeedback(request({ localDate: '2026-11-04' })).catch(codeOf)).toBe(
      'validation_error',
    );
  });
});

describe('feedbackIsStale (AC17)', () => {
  const item = (id: string, recordedAt: string, localDate = TODAY) =>
    ({ id, recordedAt, localDate }) as Pick<MealItem, 'id' | 'recordedAt' | 'localDate'>;
  const items = [
    item('a', '2026-11-11T08:00:00Z'),
    item('b', '2026-11-10T08:00:00Z', '2026-11-10'),
  ];
  const feedback = { localDate: TODAY, fingerprint: feedbackFingerprint([items[0]!]) };

  it('is fresh while the items of that day are the same, whatever other days do', () => {
    expect(feedbackIsStale(feedback, items)).toBe(false);
    expect(feedbackIsStale(feedback, [items[0]!])).toBe(false);
  });

  it('is stale after an add, an edit or a delete of that day', () => {
    expect(feedbackIsStale(feedback, [...items, item('c', '2026-11-11T09:00:00Z')])).toBe(true);
    expect(feedbackIsStale(feedback, [item('a', '2026-11-11T08:30:00Z')])).toBe(true);
    expect(feedbackIsStale(feedback, [])).toBe(true);
  });
});

describe('writeTouchesDay (AC3)', () => {
  const mutation = (mutationKey: readonly string[], variables: unknown) =>
    ({ options: { mutationKey }, state: { variables } }) as unknown as Parameters<
      typeof writeTouchesDay
    >[0];

  it('counts a save of that day and any delete, nothing else', () => {
    const save = (localDate: string) =>
      mutation(foodKeys.saveItem, { id: 'a', request: { localDate } });
    expect(writeTouchesDay(save(TODAY), TODAY)).toBe(true);
    expect(writeTouchesDay(save('2026-11-10'), TODAY)).toBe(false);
    expect(
      writeTouchesDay(mutation(foodKeys.deleteItem, { id: 'a', recordedAt: 'x' }), TODAY),
    ).toBe(true);
    expect(writeTouchesDay(mutation(foodKeys.favourite, { food: { id: 'a' } }), TODAY)).toBe(false);
  });
});
