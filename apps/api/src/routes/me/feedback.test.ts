import { AiUnavailableError, type FeedbackPromptInput } from '@pt/ai';
import {
  ApiErrorSchema,
  CONSENT_VERSION,
  DailyFeedbackResponseSchema,
  FEEDBACK_LIMITS,
  type FeedbackReading,
} from '@pt/contracts';
import { addDays, feedbackFingerprint } from '@pt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FOOD,
  NOW,
  TODAY,
  USER_ID,
  catalogFixture,
  createTestApp,
  feedbackUsage,
  profileInput,
} from '../../test/fakes';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

const ITEM = '50000000-0000-4000-8000-000000000001';
const ITEM_2 = '50000000-0000-4000-8000-000000000002';
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const errorOf = async (res: Response) => ApiErrorSchema.parse(await res.json());

beforeEach(async () => {
  t = await createTestApp();
  t.store.catalog = catalogFixture();
  await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });
  await t.call(
    'PUT',
    '/me/profile',
    profileInput({
      dietaryPrefs: {
        dietType: 'vegetarian',
        allergies: ['frutos secos'],
        dislikes: ['coliflor'],
        restrictions: ['sin gluten'],
      },
    }),
  );
});

/** Two medium eggs at breakfast: about 14 g of protein and no fiber. */
async function logEggs(localDate = TODAY, id = ITEM, mealType = 'breakfast') {
  const res = await t.call('PUT', `/me/food-log/items/${id}`, {
    kind: 'food',
    foodId: FOOD.egg,
    portion: { kind: 'serving', servingId: FOOD.eggMedium, servings: 2 },
    inputMethod: 'search',
    localDate,
    mealType,
    recordedAt: at(60),
    today: TODAY,
    locale: 'es',
  });
  expect(res.status).toBe(200);
}

const request = (over: Record<string, unknown> = {}) => ({
  localDate: TODAY,
  today: TODAY,
  localTime: '10:30',
  trainingDay: false,
  locale: 'es',
  ...over,
});

const ask = (body: unknown = request(), bearer?: string | null) =>
  t.call('POST', '/me/food-log/feedback', body, bearer);

async function feedbackOf(res: Response) {
  expect(res.status).toBe(200);
  return DailyFeedbackResponseSchema.parse(await res.json());
}

/** A fake model that words every observation and picks its first candidate. */
const kindAnswer = (input: FeedbackPromptInput) =>
  ({
    notes: input.observations.map(({ kind }) => ({
      observation: kind,
      text: `Una nota sobre ${kind.replace('_', ' ')}.`,
      suggestionRefs: (input.candidates[kind] ?? []).slice(0, 1).map((c) => c.ref),
    })),
  }) satisfies FeedbackReading;

const usage = () => t.store.rows(USER_ID).aiUsage;

describe('POST /me/food-log/feedback (spec 008)', () => {
  it('answers 401 without a token and 403 without the current consent', async () => {
    expect((await ask(request(), null)).status).toBe(401);
    t.store.rows(USER_ID).consents = [];
    const res = await ask();
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('consent_required');
  });

  it('words the observations of a day in progress, with suggestions from the user foods (AC13)', async () => {
    await logEggs();
    t.feedback.answer = kindAnswer;
    const body = await feedbackOf(await ask());

    expect(body.state).toBe('in_progress');
    expect(body.notes.map((n) => [n.observation.kind, n.source])).toEqual([
      ['protein_gap', 'ai'],
      ['fiber_gap', 'ai'],
    ]);
    expect(body.notes[0]?.text).toBe('Una nota sobre protein gap.');
    expect(body.notes[0]?.observation.numbers).toMatchObject({
      nutrient: 'protein',
      eaten: 14,
      mealsLeft: ['lunch', 'dinner'],
    });
    // The eggs, with the portion used last; nothing to suggest for fiber.
    expect(body.notes[0]?.suggestions).toEqual([
      {
        food: expect.objectContaining({ id: FOOD.egg, name: 'Huevo' }),
        portion: { kind: 'serving', servingId: FOOD.eggMedium, servings: 2 },
      },
    ]);
    expect(body.notes[1]?.suggestions).toEqual([]);
    expect(body.citations).toEqual(['issn_protein_2017', 'efsa_fibre_2010']);
    const items = t.store.rows(USER_ID).mealItems;
    expect(body.fingerprint).toBe(feedbackFingerprint(items));
    expect(usage()).toEqual([{ ...feedbackUsage(), createdAt: NOW.toISOString() }]);
  });

  it('sends the model only the locale, focus, diet, observations and candidates (AC20)', async () => {
    await logEggs();
    t.feedback.answer = kindAnswer;
    await feedbackOf(await ask());
    const [input] = t.feedback.calls;
    expect(Object.keys(input ?? {}).sort()).toEqual([
      'allergies',
      'candidates',
      'dietType',
      'dislikes',
      'locale',
      'observations',
      'state',
      'trainingFocus',
    ]);
    expect(input).toMatchObject({
      locale: 'es',
      state: 'in_progress',
      trainingFocus: 'general_fitness',
      dietType: 'vegetarian',
      allergies: ['frutos secos'],
      dislikes: ['coliflor'],
    });
    expect(input?.candidates.protein_gap).toEqual([
      { ref: 'c1', name: 'Huevo', portion: '2 × 1 huevo mediano (110 g)', amount: 14 },
    ]);
    // No weight, age, sex, goal, flags or ids anywhere in what the model receives.
    const sent = JSON.stringify(input);
    for (const secret of ['70', '1991', 'female', 'lose', FOOD.egg, USER_ID]) {
      expect(sent).not.toContain(secret);
    }
  });

  it('replaces a note with digits or a compensation term by the fixed wording (AC14)', async () => {
    await logEggs();
    t.feedback.answer = () => ({
      notes: [
        { observation: 'protein_gap', text: 'Te faltan 100 g.', suggestionRefs: ['c1'] },
        { observation: 'fiber_gap', text: 'Sáltate la merienda.', suggestionRefs: [] },
        { observation: 'kcal_above', text: 'Nota de más.', suggestionRefs: [] },
      ],
    });
    const body = await feedbackOf(await ask());
    expect(body.notes.map((n) => [n.observation.kind, n.source, n.text])).toEqual([
      ['protein_gap', 'template', null],
      ['fiber_gap', 'template', null],
    ]);
    // The fixed wording keeps core's best candidates.
    expect(body.notes[0]?.suggestions.map((s) => s.food.id)).toEqual([FOOD.egg]);
  });

  it('answers 200 in fixed wording when the AI fails, and records the failed call (AC15)', async () => {
    await logEggs();
    t.feedback.answer = new AiUnavailableError('error', feedbackUsage('error'), 'time-out');
    const body = await feedbackOf(await ask());
    expect(body.notes.every((n) => n.source === 'template' && n.text === null)).toBe(true);
    expect(usage().map((u) => u.status)).toEqual(['error']);
  });

  it('does not call the AI past the daily cap (AC15)', async () => {
    await logEggs();
    t.feedback.answer = kindAnswer;
    for (let i = 0; i < FEEDBACK_LIMITS.aiPerDay; i++) {
      await t.store.recordAiUsage(USER_ID, feedbackUsage(), NOW);
    }
    const body = await feedbackOf(await ask());
    expect(body.notes.every((n) => n.source === 'template')).toBe(true);
    expect(t.feedback.calls).toHaveLength(0);
    expect(usage()).toHaveLength(FEEDBACK_LIMITS.aiPerDay);
  });

  it('gives a closed past day a recap, and only day_incomplete when it is thin (AC4, AC5)', async () => {
    const yesterday = addDays(TODAY, -1);
    await logEggs(yesterday);
    t.feedback.answer = kindAnswer;
    const body = await feedbackOf(await ask(request({ localDate: yesterday })));
    expect(body.state).toBe('closed');
    expect(body.localDate).toBe(yesterday);
    expect(body.notes.map((n) => n.observation.kind)).toEqual(['day_incomplete']);
    expect(body.citations).toEqual(['own_targets']);
  });

  it('reads only the items of the day asked for', async () => {
    await logEggs(TODAY);
    await logEggs(addDays(TODAY, -2), ITEM_2);
    t.feedback.answer = kindAnswer;
    const body = await feedbackOf(await ask());
    const today = t.store.rows(USER_ID).mealItems.filter((i) => i.localDate === TODAY);
    expect(body.fingerprint).toBe(feedbackFingerprint(today));
  });

  it('answers 422 feedback_unavailable with ed_soft_stop or without numeric targets (AC2)', async () => {
    for (const healthFlags of [['ed_soft_stop'], ['pregnancy']] as const) {
      t = await createTestApp();
      await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });
      await t.call('PUT', '/me/profile', profileInput({ healthFlags: [...healthFlags] }));
      const res = await ask();
      expect(res.status).toBe(422);
      expect((await errorOf(res)).code).toBe('feedback_unavailable');
    }
    t = await createTestApp();
    await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });
    expect((await ask()).status).toBe(422);
  });

  it('answers 400 for a day in the future, too far back, an implausible today or a bad time', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ localDate: addDays(TODAY, 1) }, 'localDate'],
      [{ localDate: addDays(TODAY, -FEEDBACK_LIMITS.daysBack - 1) }, 'localDate'],
      [{ today: addDays(TODAY, 3), localDate: addDays(TODAY, 3) }, 'today'],
      [{ localTime: '25:00' }, 'localTime'],
    ];
    t.feedback.answer = kindAnswer;
    for (const [over, field] of cases) {
      const res = await ask(request(over));
      expect(res.status).toBe(400);
      expect(Object.keys((await errorOf(res)).fields ?? {})).toContain(field);
    }
    expect(
      (await ask(request({ localDate: addDays(TODAY, -FEEDBACK_LIMITS.daysBack) }))).status,
    ).toBe(200);
  });
});
