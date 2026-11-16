import {
  ApiErrorSchema,
  CONSENT_VERSION,
  ExportResponseSchema,
  FavouriteFoodsResponseSchema,
  FoodLogResponseSchema,
  FoodSearchResponseSchema,
  KnowledgeSourcesResponseSchema,
  MealItemSaveResponseSchema,
  RecentFoodsResponseSchema,
  type MealItemUpsertRequest,
} from '@pt/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FOOD,
  NOW,
  OTHER_USER_ID,
  TODAY,
  USER_ID,
  catalogFixture,
  createTestApp,
} from '../../test/fakes';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
  t.store.catalog = catalogFixture();
  t.store.sources = [
    {
      id: 'ciqual-2025',
      name: 'Ciqual 2025 (Anses)',
      url: 'https://doi.org/10.57745/RDMHWY',
      license: 'Licence Ouverte / Etalab 2.0',
      version: '2025-11-03',
      attributionEs: 'Valores nutricionales: Anses, Ciqual 2025.',
      attributionEn: 'Nutrition values: Anses, Ciqual 2025.',
    },
  ];
});

const ITEM = '50000000-0000-4000-8000-000000000001';
const ITEM_2 = '50000000-0000-4000-8000-000000000002';
/** Device time `seconds` after the server clock of the tests. */
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const errorOf = async (res: Response) => ApiErrorSchema.parse(await res.json());

async function consent() {
  await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });
}

const eggs = (over: Partial<Extract<MealItemUpsertRequest, { kind: 'food' }>> = {}) => ({
  kind: 'food' as const,
  foodId: FOOD.egg,
  portion: { kind: 'serving' as const, servingId: FOOD.eggMedium, servings: 2 },
  inputMethod: 'search' as const,
  localDate: TODAY,
  mealType: 'breakfast' as const,
  recordedAt: at(60),
  today: TODAY,
  locale: 'es' as const,
  ...over,
});

async function put(id: string, body: unknown, status = 200) {
  const res = await t.call('PUT', `/me/food-log/items/${id}`, body);
  expect(res.status).toBe(status);
  return res;
}

const saved = async (res: Response) => MealItemSaveResponseSchema.parse(await res.json()).item;
const log = async (from = TODAY, to = TODAY) =>
  FoodLogResponseSchema.parse(
    await (await t.call('GET', `/me/food-log?from=${from}&to=${to}`)).json(),
  ).items;

const ROUTES = [
  ['GET', '/foods/search?q=leche', undefined],
  ['GET', `/me/food-log?from=${TODAY}&to=${TODAY}`, undefined],
  ['PUT', `/me/food-log/items/${ITEM}`, eggs()],
  ['DELETE', `/me/food-log/items/${ITEM}?recordedAt=${encodeURIComponent(at(0))}`, undefined],
  ['GET', '/me/foods/recent', undefined],
  ['GET', '/me/foods/favourites', undefined],
  ['PUT', `/me/foods/favourites/${FOOD.egg}`, undefined],
  ['DELETE', `/me/foods/favourites/${FOOD.egg}`, undefined],
] as const;

describe('food routes: auth and consent', () => {
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

describe('GET /foods/search (AC4)', () => {
  beforeEach(consent);

  it('returns the matches in the requested language, best first', async () => {
    const res = await t.call('GET', '/foods/search?q=leche');
    expect(res.status).toBe(200);
    const { foods } = FoodSearchResponseSchema.parse(await res.json());
    expect(foods.map((f) => f.key)).toEqual(['c-leche-semidesnatada', 'c-leche-cabra']);
    expect(foods[0]).toMatchObject({
      name: 'Leche semidesnatada',
      servings: [{ id: FOOD.milkGlass, label: '1 vaso', grams: 200 }],
      per100g: { kcal: 46 },
    });

    const en = FoodSearchResponseSchema.parse(
      await (await t.call('GET', '/foods/search?q=milk&locale=en')).json(),
    );
    expect(en.foods[0]).toMatchObject({
      name: 'Semi-skimmed milk',
      servings: [{ label: '1 glass' }],
    });
  });

  it('ignores accents and tolerates a typo', async () => {
    const res = await t.call('GET', '/foods/search?q=hevos');
    expect(FoodSearchResponseSchema.parse(await res.json()).foods.map((f) => f.key)).toEqual([
      'd-huevo',
    ]);
  });

  it('rejects a query shorter than 2 characters', async () => {
    const res = await t.call('GET', '/foods/search?q=l');
    expect(res.status).toBe(400);
  });
});

describe('GET /foods/sources (AC3)', () => {
  it('returns the attribution in the requested language, signed in without consent', async () => {
    const res = await t.call('GET', '/foods/sources?locale=en');
    expect(res.status).toBe(200);
    const { sources } = KnowledgeSourcesResponseSchema.parse(await res.json());
    expect(sources).toEqual([
      expect.objectContaining({
        id: 'ciqual-2025',
        attribution: 'Nutrition values: Anses, Ciqual 2025.',
      }),
    ]);
  });

  it('needs a token', async () => {
    expect((await t.call('GET', '/foods/sources', undefined, null)).status).toBe(401);
  });
});

describe('PUT /me/food-log/items/:id (AC8–AC10)', () => {
  beforeEach(consent);

  it('stores a serving portion with a snapshot computed from the catalog', async () => {
    const item = await saved(await put(ITEM, eggs()));
    expect(item).toEqual({
      id: ITEM,
      localDate: TODAY,
      mealType: 'breakfast',
      foodId: FOOD.egg,
      servingId: FOOD.eggMedium,
      servings: 2,
      servingLabel: '1 huevo mediano',
      grams: 110,
      label: 'Huevo',
      nutrients: { kcal: 154, proteinG: 13.97, carbsG: 0.33, fatG: 10.81, fiberG: 0 },
      inputMethod: 'search',
      recordedAt: at(60),
    });
    expect(await log()).toEqual([item]);
  });

  it('stores a grams portion and snapshots the name in the requested language', async () => {
    const item = await saved(
      await put(ITEM, eggs({ portion: { kind: 'grams', grams: 50 }, locale: 'en' })),
    );
    expect(item).toMatchObject({
      grams: 50,
      label: 'Egg',
      servingId: null,
      nutrients: { kcal: 70 },
    });
  });

  it('stores a quick add as typed', async () => {
    const item = await saved(
      await put(ITEM, {
        kind: 'quick_add',
        label: 'Bocadillo del bar',
        kcal: 450,
        proteinG: null,
        carbsG: 50,
        fatG: null,
        inputMethod: 'quick_add',
        localDate: TODAY,
        mealType: 'lunch',
        recordedAt: at(60),
        today: TODAY,
      }),
    );
    expect(item).toMatchObject({
      foodId: null,
      grams: null,
      nutrients: { kcal: 450, proteinG: 0, carbsG: 50, fatG: 0, fiberG: null },
    });
  });

  it('rejects an unknown food (404) and a serving of another food (400)', async () => {
    const unknown = await put(ITEM, eggs({ foodId: '60000000-0000-4000-8000-000000000001' }), 404);
    expect((await errorOf(unknown)).fields).toEqual({ foodId: 'not_found' });
    const serving = await put(
      ITEM,
      eggs({ portion: { kind: 'serving', servingId: FOOD.milkGlass, servings: 1 } }),
      400,
    );
    expect((await errorOf(serving)).fields).toEqual({ 'portion.servingId': 'not_found' });
  });

  it('rejects portions out of range, a future day and a clock far ahead (400)', async () => {
    await put(ITEM, eggs({ portion: { kind: 'grams', grams: 2001 } }), 400);
    await put(
      ITEM,
      eggs({ portion: { kind: 'serving', servingId: FOOD.eggMedium, servings: 0.75 } }),
      400,
    );
    const future = await put(ITEM, eggs({ localDate: '2026-11-12' }), 400);
    expect((await errorOf(future)).fields).toEqual({ localDate: 'in_future' });
    await put(ITEM, eggs({ recordedAt: at(2 * 24 * 3600) }), 400);
  });

  it('keeps one item when the same write is sent twice (AC20)', async () => {
    await put(ITEM, eggs());
    await put(ITEM, eggs());
    expect(await log()).toHaveLength(1);
  });

  it('keeps the write recorded later, whatever the order of arrival (AC20)', async () => {
    await put(ITEM, eggs({ recordedAt: at(120), mealType: 'dinner' }));
    const res = await put(ITEM, eggs({ recordedAt: at(60), mealType: 'lunch' }));
    expect((await saved(res))?.mealType).toBe('dinner');
  });

  it("never touches another user's item", async () => {
    await put(ITEM, eggs());
    const other = await t.tokens.sign({ sub: OTHER_USER_ID });
    await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION }, other);
    const res = await t.call(
      'PUT',
      `/me/food-log/items/${ITEM}`,
      eggs({ recordedAt: at(300) }),
      other,
    );
    expect(await saved(res)).toBeNull();
    expect((await log())[0]?.recordedAt).toBe(at(60));
  });

  it('rejects a new item on a day that already has 150', async () => {
    const template = (await saved(await put(ITEM_2, eggs())))!;
    for (let i = 1; i < 150; i++) {
      const id = `70000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      await t.store.upsertMealItem(USER_ID, { ...template, id });
    }
    const res = await put(ITEM, eggs(), 400);
    expect((await errorOf(res)).fields).toEqual({ localDate: 'too_many_items' });
    // editing an item of that day is still allowed
    await put(ITEM_2, eggs({ recordedAt: at(90) }));
  });
});

describe('DELETE /me/food-log/items/:id (AC11, AC20)', () => {
  beforeEach(consent);
  const remove = (id: string, recordedAt: string) =>
    t.call('DELETE', `/me/food-log/items/${id}?recordedAt=${encodeURIComponent(recordedAt)}`);

  it('deletes the item, and succeeds when it does not exist', async () => {
    await put(ITEM, eggs());
    expect((await remove(ITEM, at(120))).status).toBe(200);
    expect(await log()).toEqual([]);
    expect((await remove(ITEM_2, at(120))).status).toBe(200);
  });

  it('does not bring the item back with an older write', async () => {
    await put(ITEM, eggs({ recordedAt: at(60) }));
    await remove(ITEM, at(120));
    expect(await saved(await put(ITEM, eggs({ recordedAt: at(90) })))).toBeNull();
    expect(await log()).toEqual([]);
  });

  it('keeps an item edited after the delete was made', async () => {
    await put(ITEM, eggs({ recordedAt: at(200) }));
    await remove(ITEM, at(120));
    expect(await log()).toHaveLength(1);
  });
});

describe('GET /me/food-log', () => {
  beforeEach(consent);

  it('lists the items of the range by day and time, and rejects ranges over 31 days', async () => {
    await put(ITEM_2, eggs({ localDate: '2026-11-10', recordedAt: at(10) }));
    await put(ITEM, eggs({ recordedAt: at(5) }));
    expect((await log('2026-11-10', TODAY)).map((i) => i.id)).toEqual([ITEM_2, ITEM]);
    const res = await t.call('GET', '/me/food-log?from=2026-10-01&to=2026-11-11');
    expect(res.status).toBe(400);
  });
});

describe('recents and favourites (AC7, AC14)', () => {
  beforeEach(consent);

  it('lists the foods logged most recently with the portion used last', async () => {
    await put(ITEM, eggs({ recordedAt: at(10) }));
    await put(ITEM_2, {
      ...eggs({ foodId: FOOD.milk, portion: { kind: 'grams', grams: 250 } }),
      recordedAt: at(20),
    });
    await put('50000000-0000-4000-8000-000000000003', {
      ...eggs({ portion: { kind: 'serving', servingId: FOOD.eggLarge, servings: 1 } }),
      recordedAt: at(30),
    });
    const res = await t.call('GET', '/me/foods/recent');
    const { recents } = RecentFoodsResponseSchema.parse(await res.json());
    expect(recents.map((r) => [r.food.key, r.lastPortion])).toEqual([
      ['d-huevo', { kind: 'serving', servingId: FOOD.eggLarge, servings: 1 }],
      ['c-leche-semidesnatada', { kind: 'grams', grams: 250 }],
    ]);
  });

  it('stars and unstars foods, idempotently, most recent first', async () => {
    expect((await t.call('PUT', `/me/foods/favourites/${FOOD.egg}`)).status).toBe(204);
    expect((await t.call('PUT', `/me/foods/favourites/${FOOD.egg}`)).status).toBe(204);
    const favourites = async () =>
      FavouriteFoodsResponseSchema.parse(
        await (await t.call('GET', '/me/foods/favourites')).json(),
      ).foods.map((f) => f.key);
    expect(await favourites()).toEqual(['d-huevo']);
    expect((await t.call('DELETE', `/me/foods/favourites/${FOOD.egg}`)).status).toBe(204);
    expect((await t.call('DELETE', `/me/foods/favourites/${FOOD.egg}`)).status).toBe(204);
    expect(await favourites()).toEqual([]);
  });

  it('rejects starring an unknown food', async () => {
    const res = await t.call('PUT', '/me/foods/favourites/60000000-0000-4000-8000-000000000001');
    expect(res.status).toBe(404);
  });
});

describe('GET /me/export (AC23)', () => {
  it('includes the food log and the favourites', async () => {
    await consent();
    await put(ITEM, eggs());
    await t.call('PUT', `/me/foods/favourites/${FOOD.bread}`);
    const exported = ExportResponseSchema.parse(await (await t.call('GET', '/me/export')).json());
    expect(exported.mealItems.map((i) => i.id)).toEqual([ITEM]);
    expect(exported.favouriteFoods).toEqual([
      { foodId: FOOD.bread, key: 'c-pan-blanco', createdAt: NOW.toISOString() },
    ]);
  });
});
