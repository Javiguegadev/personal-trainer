import { AiUnavailableError } from '@pt/ai';
import {
  ApiErrorSchema,
  CONSENT_VERSION,
  LABEL_SCAN_LIMITS,
  MEAL_DRAFT_LIMITS,
  MealDraftResponseSchema,
  type MealReadingItem,
} from '@pt/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FOOD,
  NOW,
  TODAY,
  USER_ID,
  catalogFixture,
  createTestApp,
  mealUsage,
  type FakeToolResult,
} from '../../test/fakes';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
  t.store.catalog = catalogFixture();
  await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });
});

const IMAGE = Buffer.from('a photo of a plate').toString('base64');
const SENTENCE = 'dos huevos y un vaso de leche';

const draftText = (body: unknown = { text: SENTENCE }, bearer?: string | null) =>
  t.call('POST', '/me/food-log/drafts/text', body, bearer);
const draftPhoto = (
  body: unknown = { image: { mediaType: 'image/jpeg', data: IMAGE } },
  bearer?: string | null,
) => t.call('POST', '/me/food-log/drafts/photo', body, bearer);
const usage = () => t.store.rows(USER_ID).aiUsage;

/** The ref the tool gave a food (by its name), and the ref of that food's serving number `n`. */
function refs(results: FakeToolResult[], name: string, n = 1) {
  const food = results
    .flatMap((r) => r.results)
    .flatMap((r) => r.foods)
    .find((f) => f.name === name);
  if (!food) throw new Error(`the tool did not return ${name}`);
  return { food: food.ref, serving: food.servings[n - 1]?.ref ?? null };
}

const item = (over: Partial<MealReadingItem>): MealReadingItem => ({
  mention: 'dos huevos',
  foodId: null,
  servingId: null,
  servings: null,
  grams: null,
  confidence: 'high',
  quantityAssumed: false,
  inferred: false,
  ...over,
});

/** The model of a sentence that searches "huevo" and "leche" and picks two eggs and a glass of milk. */
function eggsAndMilk() {
  t.meal.searches = [['huevo', 'leche']];
  t.meal.answer = (results) => {
    const egg = refs(results, 'Huevo');
    const milk = refs(results, 'Leche semidesnatada');
    return {
      status: 'ok',
      items: [
        item({ foodId: egg.food, servingId: egg.serving, servings: 2 }),
        item({
          mention: 'un vaso de leche',
          foodId: milk.food,
          servingId: milk.serving,
          servings: 1,
        }),
      ],
    };
  };
}

describe('POST /me/food-log/drafts/text (spec 007 AC4, AC6, AC9)', () => {
  it('returns the editable draft with catalog foods and portions, and records the call', async () => {
    eggsAndMilk();
    const res = await draftText();
    expect(res.status).toBe(200);
    const draft = MealDraftResponseSchema.parse(await res.json());
    if (draft.status !== 'ok') throw new Error('expected a draft');
    expect(draft.unresolved).toEqual([]);
    expect(draft.items.map((i) => [i.food.id, i.portion, i.mention])).toEqual([
      [FOOD.egg, { kind: 'serving', servingId: FOOD.eggMedium, servings: 2 }, 'dos huevos'],
      [FOOD.milk, { kind: 'serving', servingId: FOOD.milkGlass, servings: 1 }, 'un vaso de leche'],
    ]);
    expect(t.meal.calls).toEqual([{ kind: 'text', text: SENTENCE }]);
    expect(usage()).toMatchObject([
      { feature: 'meal_text', model: 'claude-haiku-5-5', status: 'ok' },
    ]);
  });

  it('shows the model short refs, names, servings and kcal, never our ids', async () => {
    eggsAndMilk();
    await draftText();
    const [raw] = t.meal.toolResults;
    expect(raw).not.toContain(FOOD.egg);
    expect(raw).not.toContain(FOOD.eggMedium);
    const parsed = JSON.parse(raw ?? '') as FakeToolResult;
    expect(parsed.results[0]?.query).toBe('huevo');
    expect(parsed.results[0]?.foods[0]).toEqual({
      ref: 'f1',
      name: 'Huevo',
      unit: 'g',
      kcalPer100: 140,
      servings: [
        { ref: 'f1s1', label: '1 huevo mediano', grams: 55 },
        { ref: 'f1s2', label: '1 huevo grande', grams: 65 },
      ],
    });
  });

  it('puts a food the user logged recently first among equal matches', async () => {
    const put = await t.call('PUT', '/me/food-log/items/50000000-0000-4000-8000-000000000001', {
      kind: 'food',
      foodId: FOOD.goatMilk,
      portion: { kind: 'grams', grams: 200 },
      inputMethod: 'search',
      localDate: TODAY,
      mealType: 'breakfast',
      recordedAt: NOW.toISOString(),
      today: TODAY,
    });
    expect(put.status).toBe(200);
    t.meal.searches = [['leche']];
    t.meal.answer = () => ({ status: 'ok', items: [] });
    await draftText();
    const parsed = JSON.parse(t.meal.toolResults[0] ?? '') as FakeToolResult;
    expect(parsed.results[0]?.foods.map((f) => f.name)).toEqual([
      'Leche de cabra',
      'Leche semidesnatada',
    ]);
  });

  it('turns a ref the tool never showed, or an id, into an unresolved mention (AC6, AC9)', async () => {
    t.meal.searches = [['huevo']];
    t.meal.answer = () => ({
      status: 'ok',
      items: [
        item({ mention: 'salmorejo', foodId: 'f99' }),
        item({ mention: 'leche', foodId: FOOD.milk }),
        item({ mention: 'gazpacho', foodId: null }),
      ],
    });
    const draft = MealDraftResponseSchema.parse(await (await draftText()).json());
    expect(draft).toEqual({
      status: 'ok',
      items: [],
      unresolved: [{ mention: 'salmorejo' }, { mention: 'leche' }, { mention: 'gazpacho' }],
    });
  });

  it('ignores a serving ref of another food and clamps the portion (AC9)', async () => {
    t.meal.searches = [['huevo', 'leche']];
    t.meal.answer = (results) => {
      const egg = refs(results, 'Huevo');
      const milk = refs(results, 'Leche semidesnatada');
      return {
        status: 'ok',
        items: [
          item({ foodId: egg.food, servingId: milk.serving, servings: 3 }),
          item({ mention: 'leche', foodId: milk.food, grams: 9000 }),
        ],
      };
    };
    const draft = MealDraftResponseSchema.parse(await (await draftText()).json());
    if (draft.status !== 'ok') throw new Error('expected a draft');
    expect(draft.items.map((i) => [i.portion, i.quantityAssumed, i.confidence])).toEqual([
      [{ kind: 'serving', servingId: FOOD.eggMedium, servings: 3 }, false, 'low'],
      [{ kind: 'grams', grams: 2000 }, false, 'low'],
    ]);
  });

  it('says a sentence without food gives no draft (AC10)', async () => {
    t.meal.answer = () => ({ status: 'not_food', items: [] });
    const res = await draftText({ text: 'hola, qué tal' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'unreadable', reason: 'not_food' });
    expect(usage()).toHaveLength(1);
  });

  it('rejects a sentence shorter than 3 or longer than 300 characters', async () => {
    for (const text of ['', 'ab', 'x'.repeat(MEAL_DRAFT_LIMITS.textMax + 1)]) {
      const res = await draftText({ text });
      expect(res.status).toBe(400);
    }
    expect(t.meal.calls).toEqual([]);
  });

  it('answers 503 when the model gives no usable draft, and records the failed call (AC11)', async () => {
    t.meal.answer = new AiUnavailableError('refusal', mealUsage('meal_text', 'refusal'), 'refusal');
    const res = await draftText();
    expect(res.status).toBe(503);
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('ai_unavailable');
    expect(usage()).toMatchObject([{ feature: 'meal_text', status: 'refusal' }]);
  });

  it('stores neither the sentence nor the draft (AC16)', async () => {
    eggsAndMilk();
    await draftText();
    const rows = t.store.rows(USER_ID);
    expect(rows.mealItems).toEqual([]);
    expect(JSON.stringify(rows.aiUsage)).not.toContain('huevos');
  });
});

describe('POST /me/food-log/drafts/photo (spec 007 AC3, AC5, AC10)', () => {
  it('sends the photo to the model and returns the draft, metered as meal_photo', async () => {
    t.meal.searches = [['huevo']];
    t.meal.answer = (results) => {
      const egg = refs(results, 'Huevo');
      return {
        status: 'ok',
        items: [
          item({ mention: 'huevo frito', foodId: egg.food, grams: 120, confidence: 'medium' }),
        ],
      };
    };
    const res = await draftPhoto();
    expect(res.status).toBe(200);
    const draft = MealDraftResponseSchema.parse(await res.json());
    expect(draft.status === 'ok' && draft.items[0]).toMatchObject({
      portion: { kind: 'grams', grams: 120 },
      confidence: 'medium',
    });
    expect(t.meal.calls).toEqual([
      { kind: 'photo', image: { mediaType: 'image/jpeg', data: IMAGE } },
    ]);
    expect(usage()).toMatchObject([{ feature: 'meal_photo', status: 'ok' }]);
  });

  it('says why a photo gives no draft (AC10)', async () => {
    t.meal.answer = () => ({ status: 'blurry', items: [] });
    expect(await (await draftPhoto()).json()).toEqual({ status: 'unreadable', reason: 'blurry' });
  });

  it('rejects an image that is not base64 (400) or too large (413)', async () => {
    const invalid = await draftPhoto({ image: { mediaType: 'image/jpeg', data: 'not base64!' } });
    expect(invalid.status).toBe(400);
    const big = 'A'.repeat(Math.ceil((LABEL_SCAN_LIMITS.imageBytesMax * 4) / 3) + 8);
    const tooLarge = await draftPhoto({ image: { mediaType: 'image/jpeg', data: big } });
    expect(tooLarge.status).toBe(413);
    expect(ApiErrorSchema.parse(await tooLarge.json()).code).toBe('image_too_large');
    expect(t.meal.calls).toEqual([]);
  });

  it('keeps the photo out of the usage row (AC16)', async () => {
    t.meal.answer = () => ({ status: 'not_food', items: [] });
    await draftPhoto();
    expect(JSON.stringify(t.store.rows(USER_ID).aiUsage)).not.toContain(IMAGE);
  });
});

describe('daily caps (spec 007 AC12)', () => {
  const fill = (feature: 'meal_text' | 'meal_photo' | 'label_scan', count: number, at = NOW) => {
    for (let i = 0; i < count; i++) {
      t.store.rows(USER_ID).aiUsage.push({
        ...mealUsage('meal_text'),
        feature,
        createdAt: at.toISOString(),
      });
    }
  };

  it('stops the 41st sentence of the UTC day with 429', async () => {
    t.meal.answer = () => ({ status: 'not_food', items: [] });
    fill('meal_text', MEAL_DRAFT_LIMITS.textsPerDay - 1);
    expect((await draftText()).status).toBe(200);
    const res = await draftText();
    expect(res.status).toBe(429);
    expect(ApiErrorSchema.parse(await res.json()).code).toBe('ai_cap_reached');
    expect(t.meal.calls).toHaveLength(1);
  });

  it('stops the 21st plate photo, and each shortcut counts only its own calls', async () => {
    t.meal.answer = () => ({ status: 'not_food', items: [] });
    fill('meal_photo', MEAL_DRAFT_LIMITS.photosPerDay);
    fill('label_scan', 20);
    expect((await draftPhoto()).status).toBe(429);
    expect((await draftText()).status).toBe(200);
  });

  it('does not count the calls of the day before', async () => {
    t.meal.answer = () => ({ status: 'not_food', items: [] });
    fill('meal_text', MEAL_DRAFT_LIMITS.textsPerDay, new Date('2026-11-10T23:59:00Z'));
    expect((await draftText()).status).toBe(200);
  });
});

describe('access', () => {
  it('needs a session (401)', async () => {
    expect((await draftText(undefined, null)).status).toBe(401);
    expect((await draftPhoto(undefined, null)).status).toBe(401);
  });

  it('needs the current consent (403)', async () => {
    t.store.rows(USER_ID).consents = [];
    const text = await draftText();
    expect(text.status).toBe(403);
    expect(ApiErrorSchema.parse(await text.json()).code).toBe('consent_required');
    expect((await draftPhoto()).status).toBe(403);
    expect(t.meal.calls).toEqual([]);
  });
});
