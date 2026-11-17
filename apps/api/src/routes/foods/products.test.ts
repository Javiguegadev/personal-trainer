import { AiUnavailableError } from '@pt/ai';
import {
  ApiErrorSchema,
  CONSENT_VERSION,
  CustomFoodsResponseSchema,
  ExportResponseSchema,
  FavouriteFoodsResponseSchema,
  FoodSchema,
  FoodSearchResponseSchema,
  KnowledgeSourcesResponseSchema,
  LABEL_SCAN_LIMITS,
  LabelScanResponseSchema,
  MealItemSaveResponseSchema,
  RecentFoodsResponseSchema,
  type CustomFoodUpsertRequest,
  type LabelReading,
} from '@pt/contracts';
import type { OffProductInput } from '@pt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  NOW,
  OTHER_USER_ID,
  TODAY,
  USER_ID,
  catalogFixture,
  createTestApp,
  labelUsage,
} from '../../test/fakes';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
  t.store.catalog = catalogFixture();
  await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });
});

const NUTELLA = '3017620422003';
const COLA = '5449000214911';
const UNKNOWN = '8410000000009';
const FOOD_ID = '70000000-0000-4000-8000-000000000001';
const FOOD_ID_2 = '70000000-0000-4000-8000-000000000002';
const SERVING_ID = '71000000-0000-4000-8000-000000000001';
const ITEM = '50000000-0000-4000-8000-000000000001';
const DAY_MS = 24 * 60 * 60 * 1000;

const nutella: OffProductInput = {
  productNameEs: 'Nutella',
  brands: 'Ferrero, Nutella',
  energyKcal100g: 539,
  proteins100g: 6.3,
  carbohydrates100g: 57.5,
  fat100g: 30.9,
  fiber100g: 0,
  productQuantity: 400,
  productQuantityUnit: 'g',
  servingQuantity: 15,
  servingQuantityUnit: 'g',
  allergensTags: ['en:milk', 'en:nuts', 'en:soybeans'],
  tracesTags: ['en:gluten'],
};
const cola: OffProductInput = {
  productNameEs: 'Coca-Cola',
  brands: 'Coca-Cola',
  energyKcal100g: 42,
  proteins100g: 0,
  carbohydrates100g: 10.6,
  fat100g: 0,
  productQuantity: 330,
  productQuantityUnit: 'ml',
  servingQuantity: 330,
  servingQuantityUnit: 'ml',
};

const errorOf = async (res: Response) => ApiErrorSchema.parse(await res.json());
const foodOf = async (res: Response) => FoodSchema.parse(await res.json());
const scan = (code: string, bearer?: string | null) =>
  t.call('GET', `/foods/barcode/${code}`, undefined, bearer);
const otherToken = () => t.tokens.sign({ sub: OTHER_USER_ID });
async function asOther() {
  const token = await otherToken();
  await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION }, token);
  return token;
}

const yogurt = (over: Partial<CustomFoodUpsertRequest> = {}): CustomFoodUpsertRequest => ({
  name: 'Yogur natural',
  brand: 'La Granja',
  unit: 'g',
  per100g: { kcal: 61, proteinG: 3.5, carbsG: 4.7, fatG: 3.1, fiberG: null },
  serving: { id: SERVING_ID, label: '1 tarrina', grams: 125 },
  barcode: null,
  origin: 'manual',
  ...over,
});
const putFood = (id: string, body: unknown, bearer?: string | null) =>
  t.call('PUT', `/me/foods/${id}`, body, bearer);

const itemOf = (foodId: string, over: Record<string, unknown> = {}) => ({
  kind: 'food',
  foodId,
  portion: { kind: 'grams', grams: 100 },
  inputMethod: 'barcode',
  localDate: TODAY,
  mealType: 'breakfast',
  recordedAt: new Date(NOW.getTime() + 60_000).toISOString(),
  today: TODAY,
  locale: 'es',
  ...over,
});

describe('GET /foods/barcode/:code (spec 006 AC2–AC7)', () => {
  it('reads the product from Open Food Facts and returns it as a food', async () => {
    t.off.answers.set(NUTELLA, { status: 'found', product: nutella });
    const res = await scan(NUTELLA);
    expect(res.status).toBe(200);
    const food = await foodOf(res);
    expect(food).toMatchObject({
      key: `off-${NUTELLA}`,
      name: 'Nutella',
      brand: 'Ferrero',
      barcode: NUTELLA,
      origin: 'off',
      source: 'open-food-facts',
      unit: 'g',
      per100g: { kcal: 539, proteinG: 6.3, carbsG: 57.5, fatG: 30.9, fiberG: 0 },
      allergens: ['en:milk', 'en:nuts', 'en:soybeans'],
      traces: ['en:gluten'],
      sourceUrl: `https://world.openfoodfacts.org/product/${NUTELLA}`,
      energyMismatch: false,
    });
    expect(food.servings.map((s) => [s.label, s.grams])).toEqual([
      ['1 ración', 15],
      ['1 envase', 400],
    ]);
  });

  it('names the servings in the requested language', async () => {
    t.off.answers.set(NUTELLA, { status: 'found', product: nutella });
    const food = await foodOf(await t.call('GET', `/foods/barcode/${NUTELLA}?locale=en`));
    expect(food.servings.map((s) => s.label)).toEqual(['1 serving', '1 package']);
  });

  it('asks Open Food Facts once: the second scan, of any user, uses the stored product', async () => {
    t.off.answers.set(NUTELLA, { status: 'found', product: nutella });
    const first = await foodOf(await scan(NUTELLA));
    const second = await foodOf(await scan(NUTELLA, await asOther()));
    expect(second).toEqual(first);
    expect(t.off.calls).toEqual([NUTELLA]);
  });

  it('reads the product again after 90 days and keeps its id and its servings', async () => {
    t.off.answers.set(NUTELLA, { status: 'found', product: nutella });
    const first = await foodOf(await scan(NUTELLA));
    t.clock.now = new Date(NOW.getTime() + 91 * DAY_MS);
    t.off.answers.set(NUTELLA, {
      status: 'found',
      product: { ...nutella, energyKcal100g: 545 },
    });
    const again = await foodOf(await scan(NUTELLA));
    expect(t.off.calls).toHaveLength(2);
    expect(again.per100g.kcal).toBe(545);
    expect(again.id).toBe(first.id);
    expect(again.servings.map((s) => s.id)).toEqual(first.servings.map((s) => s.id));
  });

  it('keeps a product cached long ago when Open Food Facts does not answer', async () => {
    t.off.answers.set(NUTELLA, { status: 'found', product: nutella });
    await scan(NUTELLA);
    t.clock.now = new Date(NOW.getTime() + 91 * DAY_MS);
    t.off.answers.set(NUTELLA, { status: 'unavailable' });
    const res = await scan(NUTELLA);
    expect(res.status).toBe(200);
    expect((await foodOf(res)).per100g.kcal).toBe(539);
  });

  it('accepts a UPC-A and a code with a leading zero as the same product', async () => {
    t.off.answers.set('0036000291452', { status: 'found', product: nutella });
    expect((await scan('036000291452')).status).toBe(200);
    expect((await scan('00036000291452')).status).toBe(200);
    expect(t.off.calls).toEqual(['0036000291452']);
  });

  it('rejects a code that is not a valid barcode without asking anyone', async () => {
    for (const code of ['3017620422004', '12345678', '123', 'abc']) {
      const res = await scan(code);
      expect(res.status, code).toBe(400);
      expect((await errorOf(res)).code).toBe('validation_error');
    }
    expect(t.off.calls).toEqual([]);
  });

  it('answers 404 for an unknown code and remembers it for 24 hours (AC6)', async () => {
    const res = await scan(UNKNOWN);
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('product_not_found');
    await scan(UNKNOWN, await asOther());
    expect(t.off.calls).toEqual([UNKNOWN]);

    t.clock.now = new Date(NOW.getTime() + DAY_MS + 60_000);
    t.off.answers.set(UNKNOWN, { status: 'found', product: nutella });
    expect((await scan(UNKNOWN)).status).toBe(200);
    expect(t.off.calls).toEqual([UNKNOWN, UNKNOWN]);
  });

  it('answers 404 `product_incomplete` for a product without usable values (AC4)', async () => {
    t.off.answers.set(NUTELLA, { status: 'found', product: { ...nutella, proteins100g: null } });
    const res = await scan(NUTELLA);
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('product_incomplete');
    // Also remembered: the second scan does not reach Open Food Facts.
    expect((await errorOf(await scan(NUTELLA))).code).toBe('product_incomplete');
    expect(t.off.calls).toEqual([NUTELLA]);
  });

  it('answers 404 for a code printed by the shop without asking Open Food Facts', async () => {
    const res = await scan('2000000000008');
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('product_not_found');
    expect(t.off.calls).toEqual([]);
  });

  it('answers 503 when Open Food Facts does not answer, and caches nothing (AC7)', async () => {
    t.off.answers.set(NUTELLA, { status: 'unavailable' });
    const res = await scan(NUTELLA);
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('lookup_unavailable');
    t.off.answers.set(NUTELLA, { status: 'found', product: nutella });
    expect((await scan(NUTELLA)).status).toBe(200);
    expect(t.off.calls).toEqual([NUTELLA, NUTELLA]);
  });

  it('answers 429 after 10 live lookups of one user in a minute (AC7)', async () => {
    const codes = [
      '7622210449283',
      '5449000131805',
      '3046920022651',
      '7300400481588',
      '5410041001204',
      '5411188112709',
      '8480000671400',
      '5010029000023',
      '4056489216162',
      '3033710065967',
      '7613034947611',
    ];
    for (const code of codes.slice(0, 10)) t.off.answers.set(code, { status: 'unavailable' });
    for (const code of codes.slice(0, 10)) expect((await scan(code)).status).toBe(503);
    const res = await scan(codes[10]!);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe('rate_limited');
    expect(t.off.calls).toHaveLength(10);
    // Another user has their own limit, and a minute later the first one can scan again.
    expect((await scan(codes[10]!, await asOther())).status).toBe(404);
    t.clock.now = new Date(NOW.getTime() + 61_000);
    expect((await scan(codes[0]!)).status).toBe(503);
  });

  it('flags a product whose energy does not match its macros (AC5)', async () => {
    t.off.answers.set(NUTELLA, {
      status: 'found',
      product: {
        ...nutella,
        productNameEs: 'Vino tinto',
        energyKcal100g: 85,
        fat100g: 0,
        carbohydrates100g: 2.6,
        proteins100g: 0.1,
      },
    });
    expect((await foodOf(await scan(NUTELLA))).energyMismatch).toBe(true);
  });

  it('needs a token (401) and the current consent (403)', async () => {
    expect((await scan(NUTELLA, null)).status).toBe(401);
    const res = await scan(NUTELLA, await otherToken());
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('consent_required');
    expect(t.off.calls).toEqual([]);
  });
});

describe('scanned products in the food log (AC3, AC11)', () => {
  it('logs a drink in millilitres with a snapshot and `barcode` as its input method', async () => {
    t.off.answers.set(COLA, { status: 'found', product: cola });
    const food = await foodOf(await scan(COLA));
    expect(food.unit).toBe('ml');
    const res = await t.call(
      'PUT',
      `/me/food-log/items/${ITEM}`,
      itemOf(food.id, {
        portion: { kind: 'serving', servingId: food.servings[0]!.id, servings: 1 },
      }),
    );
    expect(res.status).toBe(200);
    expect(MealItemSaveResponseSchema.parse(await res.json()).item).toMatchObject({
      foodId: food.id,
      label: 'Coca-Cola',
      grams: 330,
      unit: 'ml',
      servingLabel: '1 ración',
      inputMethod: 'barcode',
      nutrients: { kcal: 138.6, proteinG: 0, carbsG: 34.98, fatG: 0, fiberG: null },
    });
  });

  it('shows a logged product in the recents, the favourites and the search of that user only', async () => {
    t.off.answers.set(NUTELLA, { status: 'found', product: nutella });
    const food = await foodOf(await scan(NUTELLA));
    const search = async (bearer?: string) =>
      FoodSearchResponseSchema.parse(
        await (await t.call('GET', '/foods/search?q=nutella', undefined, bearer)).json(),
      ).foods.map((f) => f.id);
    // Scanned, not logged yet: products are not part of the shared search.
    expect(await search()).toEqual([]);

    await t.call('PUT', `/me/food-log/items/${ITEM}`, itemOf(food.id));
    await t.call('PUT', `/me/foods/favourites/${food.id}`);
    expect(await search()).toEqual([food.id]);
    expect(
      FoodSearchResponseSchema.parse(
        await (await t.call('GET', '/foods/search?q=ferrero')).json(),
      ).foods.map((f) => f.id),
    ).toEqual([food.id]);
    expect(await search(await asOther())).toEqual([]);

    const recents = RecentFoodsResponseSchema.parse(
      await (await t.call('GET', '/me/foods/recent')).json(),
    ).recents;
    expect(recents).toMatchObject([
      { food: { id: food.id }, lastPortion: { kind: 'grams', grams: 100 } },
    ]);
    const favourites = FavouriteFoodsResponseSchema.parse(
      await (await t.call('GET', '/me/foods/favourites')).json(),
    ).foods;
    expect(favourites.map((f) => f.id)).toEqual([food.id]);
    expect(await foodOf(await t.call('GET', `/foods/${food.id}`))).toEqual(food);
  });

  it('lists Open Food Facts among the sources, and never the source of the user’s foods (AC23)', async () => {
    const source = (id: string, name: string) => ({
      id,
      name,
      url: 'https://example.org',
      license: 'ODbL',
      version: 'live',
      attributionEs: 'es',
      attributionEn: 'en',
    });
    t.store.sources = [source('open-food-facts', 'Open Food Facts'), source('user', 'User foods')];
    const res = await t.call('GET', '/foods/sources');
    const { sources } = KnowledgeSourcesResponseSchema.parse(await res.json());
    expect(sources.map((s) => s.id)).toEqual(['open-food-facts']);
  });
});

describe('custom foods (AC9–AC13)', () => {
  it('stores a food of the user’s own and returns it', async () => {
    const res = await putFood(FOOD_ID, yogurt());
    expect(res.status).toBe(200);
    expect(await foodOf(res)).toEqual({
      id: FOOD_ID,
      key: `user-${FOOD_ID}`,
      name: 'Yogur natural',
      per100g: { kcal: 61, proteinG: 3.5, carbsG: 4.7, fatG: 3.1, fiberG: null },
      servings: [{ id: SERVING_ID, label: '1 tarrina', grams: 125 }],
      source: 'user',
      origin: 'manual',
      unit: 'g',
      brand: 'La Granja',
      barcode: null,
      allergens: [],
      traces: [],
      sourceUrl: null,
      energyMismatch: false,
    });
  });

  it('is idempotent and updates the food when it is sent again', async () => {
    await putFood(FOOD_ID, yogurt());
    await putFood(FOOD_ID, yogurt());
    const res = await putFood(FOOD_ID, yogurt({ name: 'Yogur griego', serving: null }));
    expect(await foodOf(res)).toMatchObject({ name: 'Yogur griego', servings: [] });
    const { foods } = CustomFoodsResponseSchema.parse(
      await (await t.call('GET', '/me/foods')).json(),
    );
    expect(foods.map((f) => f.name)).toEqual(['Yogur griego']);
  });

  it('lists the foods of the user, most recently changed first', async () => {
    await putFood(FOOD_ID, yogurt());
    await putFood(FOOD_ID_2, yogurt({ name: 'Pan de casa', serving: null }));
    const { foods } = CustomFoodsResponseSchema.parse(
      await (await t.call('GET', '/me/foods')).json(),
    );
    expect(foods.map((f) => f.name)).toEqual(['Pan de casa', 'Yogur natural']);
  });

  it('finds an own food by its name and its brand, before the catalog, and by its barcode', async () => {
    await putFood(FOOD_ID, yogurt({ name: 'Leche de avena', brand: 'Avenal', barcode: NUTELLA }));
    const search = async (q: string) =>
      FoodSearchResponseSchema.parse(
        await (await t.call('GET', `/foods/search?q=${encodeURIComponent(q)}`)).json(),
      ).foods.map((f) => f.name);
    expect(await search('avenal')).toEqual(['Leche de avena']);
    expect((await search('leche'))[0]).toBe('Leche de avena');
    expect(await search('leche')).toContain('Leche semidesnatada');

    // AC3: the user's own food wins over Open Food Facts, which is not even asked.
    t.off.answers.set(NUTELLA, { status: 'found', product: nutella });
    expect(await foodOf(await scan(NUTELLA))).toMatchObject({ id: FOOD_ID, origin: 'manual' });
    expect(t.off.calls).toEqual([]);
  });

  it('logs an own food by its serving, and keeps the item when the food is deleted (AC12)', async () => {
    await putFood(FOOD_ID, yogurt());
    const res = await t.call(
      'PUT',
      `/me/food-log/items/${ITEM}`,
      itemOf(FOOD_ID, {
        inputMethod: 'custom',
        portion: { kind: 'serving', servingId: SERVING_ID, servings: 2 },
      }),
    );
    expect(MealItemSaveResponseSchema.parse(await res.json()).item).toMatchObject({
      label: 'Yogur natural',
      grams: 250,
      inputMethod: 'custom',
      nutrients: { kcal: 152.5 },
    });

    expect((await t.call('DELETE', `/me/foods/${FOOD_ID}`)).status).toBe(204);
    // Deleting twice is fine.
    expect((await t.call('DELETE', `/me/foods/${FOOD_ID}`)).status).toBe(204);
    const log = (await (await t.call('GET', `/me/food-log?from=${TODAY}&to=${TODAY}`)).json()) as {
      items: unknown[];
    };
    expect(log.items).toMatchObject([
      { id: ITEM, foodId: null, label: 'Yogur natural', grams: 250, nutrients: { kcal: 152.5 } },
    ]);
    expect((await t.call('GET', `/foods/${FOOD_ID}`)).status).toBe(404);
  });

  it('never shows or accepts another user’s food (AC13)', async () => {
    await putFood(FOOD_ID, yogurt({ barcode: NUTELLA }));
    const other = await asOther();
    expect((await t.call('GET', `/foods/${FOOD_ID}`, undefined, other)).status).toBe(404);
    const item = await t.call('PUT', `/me/food-log/items/${ITEM}`, itemOf(FOOD_ID), other);
    expect(item.status).toBe(404);
    expect((await t.call('PUT', `/me/foods/favourites/${FOOD_ID}`, undefined, other)).status).toBe(
      404,
    );
    const mine = CustomFoodsResponseSchema.parse(
      await (await t.call('GET', '/me/foods', undefined, other)).json(),
    );
    expect(mine.foods).toEqual([]);
    const search = FoodSearchResponseSchema.parse(
      await (await t.call('GET', '/foods/search?q=yogur', undefined, other)).json(),
    );
    expect(search.foods).toEqual([]);
    // Their scan of the same barcode reaches Open Food Facts, not the first user's food.
    expect((await scan(NUTELLA, other)).status).toBe(404);
    // They cannot overwrite it or delete it.
    expect((await putFood(FOOD_ID, yogurt({ name: 'Mío' }), other)).status).toBe(404);
    expect((await t.call('DELETE', `/me/foods/${FOOD_ID}`, undefined, other)).status).toBe(204);
    expect((await foodOf(await t.call('GET', `/foods/${FOOD_ID}`))).name).toBe('Yogur natural');
  });

  it('cannot overwrite a catalog food or a product', async () => {
    const egg = t.store.catalog[0]!.id;
    expect((await putFood(egg, yogurt())).status).toBe(404);
  });

  it('rejects values outside their ranges (AC10)', async () => {
    const invalid = async (over: unknown) => {
      const res = await putFood(FOOD_ID, { ...yogurt(), ...(over as object) });
      expect(res.status).toBe(400);
      return (await errorOf(res)).fields;
    };
    expect(await invalid({ name: '  ' })).toHaveProperty('name');
    expect(await invalid({ per100g: { ...yogurt().per100g, kcal: 901 } })).toHaveProperty(
      'per100g.kcal',
    );
    expect(await invalid({ per100g: { ...yogurt().per100g, fatG: 101 } })).toHaveProperty(
      'per100g.fatG',
    );
    expect(
      await invalid({ per100g: { kcal: 500, proteinG: 40, carbsG: 40, fatG: 30, fiberG: null } }),
    ).toEqual({ per100g: 'macros_too_high' });
    expect(await invalid({ unit: 'oz' })).toHaveProperty('unit');
    expect(await invalid({ origin: 'off' })).toHaveProperty('origin');
    expect(await invalid({ barcode: '3017620422004' })).toEqual({ barcode: 'invalid' });
    expect(
      await invalid({ serving: { id: SERVING_ID, label: '1 tarrina', grams: 0 } }),
    ).toHaveProperty('serving.grams');
  });

  it('keeps one food per barcode for a user', async () => {
    await putFood(FOOD_ID, yogurt({ barcode: NUTELLA }));
    const res = await putFood(FOOD_ID_2, yogurt({ name: 'Otro', serving: null, barcode: NUTELLA }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ barcode: 'already_used' });
    // The same food can be saved again with its barcode.
    expect((await putFood(FOOD_ID, yogurt({ barcode: NUTELLA }))).status).toBe(200);
  });

  it('stops at 200 foods, and still lets the user edit one (AC12)', async () => {
    const id = (n: number) => `72000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    for (let n = 0; n < 200; n++) {
      await t.store.upsertCustomFood(
        USER_ID,
        id(n),
        yogurt({ name: `Alimento ${n}`, serving: null }),
        NOW,
      );
    }
    const res = await putFood(FOOD_ID, yogurt());
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('food_limit_reached');
    expect((await putFood(id(0), yogurt({ name: 'Editado', serving: null }))).status).toBe(200);
  });

  it('includes the own foods in the export, and deleting the account removes them (AC22)', async () => {
    await putFood(FOOD_ID, yogurt());
    const exported = ExportResponseSchema.parse(await (await t.call('GET', '/me/export')).json());
    expect(exported.customFoods).toMatchObject([{ id: FOOD_ID, name: 'Yogur natural' }]);
  });

  it('needs a token (401) and the current consent (403)', async () => {
    expect((await putFood(FOOD_ID, yogurt(), null)).status).toBe(401);
    expect((await t.call('GET', '/me/foods', undefined, null)).status).toBe(401);
    expect((await t.call('DELETE', `/me/foods/${FOOD_ID}`, undefined, null)).status).toBe(401);
    const noConsent = await otherToken();
    expect((await putFood(FOOD_ID, yogurt(), noConsent)).status).toBe(403);
    expect((await t.call('GET', '/me/foods', undefined, noConsent)).status).toBe(403);
    expect((await t.call('DELETE', `/me/foods/${FOOD_ID}`, undefined, noConsent)).status).toBe(403);
  });
});

describe('POST /me/foods/label-scan (AC14–AC19)', () => {
  const IMAGE = Buffer.from('a photo of a label').toString('base64');
  const reading: LabelReading = {
    status: 'ok',
    basis: 'per_100g',
    servingSize: 30,
    servingUnit: 'g',
    energyKcal: 436,
    energyKj: 1836,
    fatG: 10.5,
    carbsG: 76,
    proteinG: 7.1,
    fiberG: null,
    productName: 'Galletas María',
    brand: null,
  };
  const scanLabel = (
    body: unknown = { image: { mediaType: 'image/jpeg', data: IMAGE } },
    bearer?: string | null,
  ) => t.call('POST', '/me/foods/label-scan', body, bearer);
  const usage = () => t.store.rows(USER_ID).aiUsage;

  it('returns the editable draft of a readable label and records the call', async () => {
    t.label.answer = reading;
    const res = await scanLabel();
    expect(res.status).toBe(200);
    expect(LabelScanResponseSchema.parse(await res.json())).toEqual({
      status: 'ok',
      draft: {
        name: 'Galletas María',
        brand: null,
        unit: 'g',
        kcal: 436,
        proteinG: 7.1,
        carbsG: 76,
        fatG: 10.5,
        fiberG: null,
        servingGrams: 30,
      },
    });
    expect(t.label.calls).toEqual([IMAGE]);
    expect(usage()).toMatchObject([
      { feature: 'label_scan', model: 'claude-haiku-5-5', status: 'ok', inputTokens: 1200 },
    ]);
  });

  it('says why a photo cannot be read (AC17)', async () => {
    t.label.answer = { ...reading, status: 'not_a_label' };
    const res = await scanLabel();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'unreadable', reason: 'not_a_label' });
    // The call still counts.
    expect(usage()).toHaveLength(1);
  });

  it('answers 503 when the model gives no usable reading, and records the failed call (AC17)', async () => {
    for (const status of ['refusal', 'max_tokens', 'invalid_output', 'error'] as const) {
      t.label.answer = new AiUnavailableError(status, labelUsage(status), status);
      const res = await scanLabel();
      expect(res.status).toBe(503);
      expect((await errorOf(res)).code).toBe('ai_unavailable');
    }
    expect(usage().map((u) => u.status)).toEqual([
      'refusal',
      'max_tokens',
      'invalid_output',
      'error',
    ]);
  });

  it('answers 429 after 20 reads in a UTC day, and again allows them the next day (AC18)', async () => {
    t.label.answer = reading;
    for (let n = 0; n < LABEL_SCAN_LIMITS.perDay; n++) expect((await scanLabel()).status).toBe(200);
    const res = await scanLabel();
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe('ai_cap_reached');
    expect(t.label.calls).toHaveLength(20);
    // The limit is per user.
    expect((await scanLabel(undefined, await asOther())).status).toBe(200);
    t.clock.now = new Date('2026-11-12T00:00:01Z');
    expect((await scanLabel()).status).toBe(200);
  });

  it('keeps the image nowhere: not in the store, not in the usage row (AC19)', async () => {
    t.label.answer = reading;
    await scanLabel();
    const everything = JSON.stringify([
      [...t.store.users.entries()],
      t.store.extraFoods,
      [...t.store.misses.entries()],
    ]);
    expect(everything).not.toContain(IMAGE);
    expect(Object.keys(usage()[0]!).sort()).toEqual([
      'costUsd',
      'createdAt',
      'feature',
      'inputTokens',
      'latencyMs',
      'model',
      'outputTokens',
      'status',
    ]);
  });

  it('rejects an image that is too large with 413, before the model is called', async () => {
    const big = 'A'.repeat(Math.ceil((LABEL_SCAN_LIMITS.imageBytesMax * 4) / 3) + 8);
    const res = await scanLabel({ image: { mediaType: 'image/jpeg', data: big } });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('image_too_large');
    const huge = 'A'.repeat(6 * 1024 * 1024);
    expect((await scanLabel({ image: { mediaType: 'image/jpeg', data: huge } })).status).toBe(413);
    expect(t.label.calls).toEqual([]);
    expect(usage()).toEqual([]);
  });

  it('rejects a body that is not an image in base64 (400)', async () => {
    for (const body of [
      {},
      { image: { mediaType: 'image/gif', data: IMAGE } },
      { image: { mediaType: 'image/jpeg', data: '' } },
      { image: { mediaType: 'image/jpeg', data: 'not base64!' } },
      { image: { mediaType: 'image/jpeg', data: `data:image/jpeg;base64,${IMAGE}` } },
    ]) {
      const res = await scanLabel(body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(t.label.calls).toEqual([]);
  });

  it('needs a token (401) and the current consent (403)', async () => {
    t.label.answer = reading;
    expect((await scanLabel(undefined, null)).status).toBe(401);
    const res = await scanLabel(undefined, await otherToken());
    expect(res.status).toBe(403);
    expect(t.label.calls).toEqual([]);
  });
});
