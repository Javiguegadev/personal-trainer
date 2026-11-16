import {
  CONSENT_VERSION,
  LABEL_SCAN_LIMITS,
  type CustomFoodUpsertRequest,
  type Food,
  type MealItem,
  type MealItemSaveResponse,
  type RecentFood,
} from '@pt/contracts';
import { customFoodAsFood } from '@pt/core';
import {
  MutationObserver,
  QueryClient,
  dehydrate,
  hydrate,
  onlineManager,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient, isApiError } from './client';
import {
  cachedFoodByBarcode,
  customFoodsQueryOptions,
  foodByBarcodeQueryOptions,
  foodKeys,
  foodLogQueryOptions,
  registerCustomFoodMutations,
  registerFoodMutations,
  saveItemVariables,
  type DeleteCustomFoodVariables,
  type RejectedFoodWrite,
  type SaveCustomFoodVariables,
  type SaveMealItemVariables,
} from './foods';
import { createMockApiClient } from './mock/backend';
import { mockAccessToken, mockUserFromEmail } from './mock/identity';
import { MOCK_INCOMPLETE_BARCODE, MOCK_PRODUCTS } from './mock/products';

const NOW = new Date('2026-11-16T10:00:00.000Z');
const TODAY = '2026-11-16';
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const FOOD_ID = '70000000-0000-4000-8000-000000000001';
const FOOD_ID_2 = '70000000-0000-4000-8000-000000000002';
const SERVING_ID = '71000000-0000-4000-8000-000000000001';
const ITEM_ID = '50000000-0000-4000-8000-000000000001';
const NUTELLA = '3017620422003';
const COLA = '5449000214911';
const WINE = '8410261211015';
const UNKNOWN = '8410000000009';
const IMAGE = 'A'.repeat(4000);

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

function mockApi(email = 'ana@example.com', now: () => Date = () => NOW) {
  const token = mockAccessToken(mockUserFromEmail(email));
  return createMockApiClient({ getAccessToken: async () => token, now });
}

async function setup() {
  const api = mockApi();
  await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
  return { api, ...client(api) };
}

function client(api: ReturnType<typeof createMockApiClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  registerFoodMutations(queryClient, api);
  registerCustomFoodMutations(queryClient, api);
  const observe =
    <V, R>(key: readonly string[]) =>
    (variables: V) =>
      new MutationObserver<R, unknown, V>(queryClient, { mutationKey: key }).mutate(variables);
  return {
    queryClient,
    saveFood: observe<SaveCustomFoodVariables, Food>(foodKeys.saveFood),
    deleteFood: observe<DeleteCustomFoodVariables, void>(foodKeys.deleteFood),
    saveItem: observe<SaveMealItemVariables, MealItemSaveResponse>(foodKeys.saveItem),
    own: () => queryClient.getQueryData<Food[]>(foodKeys.customFoods('es')) ?? [],
    log: () => queryClient.getQueryData<MealItem[]>(foodKeys.log) ?? [],
    load: async () => {
      await queryClient.fetchQuery(customFoodsQueryOptions(api, 'es'));
      await queryClient.fetchQuery(foodLogQueryOptions(api, TODAY));
    },
  };
}

const firstItem = (food: Food) =>
  saveItemVariables(
    ITEM_ID,
    {
      kind: 'food',
      foodId: food.id,
      portion: { kind: 'serving', servingId: food.servings[0]!.id, servings: 2 },
      inputMethod: 'custom',
      localDate: TODAY,
      mealType: 'breakfast',
      recordedAt: at(60),
      today: TODAY,
      locale: 'es',
    },
    food,
  );

/** Lets the optimistic update (which awaits a cancel) reach the cache. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const codeOf = (error: unknown) => (isApiError(error) ? error.code : String(error));

afterEach(() => onlineManager.setOnline(true));

describe('createApiClient: products, custom foods and labels (spec 006)', () => {
  const BASE = 'https://api.test';
  const food = customFoodAsFood(FOOD_ID, yogurt());

  it('maps each method to its route, verb and JSON body', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers = [
      () => Response.json(food),
      () => Response.json({ foods: [food] }),
      () => Response.json(food),
      () => new Response(null, { status: 204 }),
      () => Response.json({ status: 'unreadable', reason: 'blurry' }),
    ];
    const api = createApiClient({
      baseUrl: BASE,
      getAccessToken: async () => 'token',
      fetchImpl: (async (input: string | URL | Request, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        return answers[calls.length - 1]!();
      }) as typeof fetch,
    });

    expect(await api.foodByBarcode(NUTELLA, 'en')).toEqual(food);
    expect(await api.customFoods('es')).toEqual({ foods: [food] });
    expect(await api.saveCustomFood(FOOD_ID, yogurt())).toEqual(food);
    await api.deleteCustomFood(FOOD_ID);
    const scan = {
      image: { mediaType: 'image/jpeg' as const, data: IMAGE },
      locale: 'es' as const,
    };
    expect(await api.scanLabel(scan)).toEqual({ status: 'unreadable', reason: 'blurry' });

    expect(calls.map((c) => [c.init.method ?? 'GET', c.url.replace(BASE, '')])).toEqual([
      ['GET', `/foods/barcode/${NUTELLA}?locale=en`],
      ['GET', '/me/foods?locale=es'],
      ['PUT', `/me/foods/${FOOD_ID}`],
      ['DELETE', `/me/foods/${FOOD_ID}`],
      ['POST', '/me/foods/label-scan'],
    ]);
    expect(JSON.parse(calls[2]!.init.body as string)).toEqual(yogurt());
    expect(JSON.parse(calls[4]!.init.body as string)).toEqual(scan);
  });

  it('carries the codes of a missing product and a failed lookup', async () => {
    const answer = (status: number, code: string) =>
      createApiClient({
        baseUrl: BASE,
        fetchImpl: (async () =>
          Response.json({ code, message: 'x' }, { status })) as unknown as typeof fetch,
      });
    const error = (api: ReturnType<typeof createApiClient>) =>
      api.foodByBarcode(NUTELLA, 'es').catch(codeOf);
    expect(await error(answer(404, 'product_not_found'))).toBe('product_not_found');
    expect(await error(answer(404, 'product_incomplete'))).toBe('product_incomplete');
    expect(await error(answer(503, 'lookup_unavailable'))).toBe('lookup_unavailable');
  });
});

describe('mock backend: barcode (AC2–AC6)', () => {
  it('finds a product with its servings, its unit, its allergens and its source', async () => {
    const { api } = await setup();
    const nutella = await api.foodByBarcode(NUTELLA, 'es');
    expect(nutella).toMatchObject({
      name: 'Nutella',
      brand: 'Ferrero',
      barcode: NUTELLA,
      origin: 'off',
      unit: 'g',
      allergens: ['en:milk', 'en:nuts', 'en:soybeans'],
      sourceUrl: `https://world.openfoodfacts.org/product/${NUTELLA}`,
      energyMismatch: false,
    });
    expect(nutella.servings.map((s) => [s.label, s.grams])).toEqual([
      ['1 ración', 15],
      ['1 envase', 400],
    ]);
    const cola = await api.foodByBarcode(COLA, 'en');
    expect(cola.unit).toBe('ml');
    expect(cola.servings.map((s) => s.label)).toEqual(['1 serving']);
    expect((await api.foodByBarcode(WINE, 'es')).energyMismatch).toBe(true);
    // The same product keeps its id, so a logged item still finds it after a reload.
    expect((await api.foodByBarcode(NUTELLA, 'en')).id).toBe(nutella.id);
    expect(await api.getFood(nutella.id, 'es')).toEqual(nutella);
  });

  it('accepts every product of the fixture', async () => {
    const { api } = await setup();
    for (const barcode of Object.keys(MOCK_PRODUCTS)) {
      expect((await api.foodByBarcode(barcode, 'es')).barcode, barcode).toBe(barcode);
    }
  });

  it('answers like the API for an unknown, an incomplete, an in-store and an invalid code', async () => {
    const { api } = await setup();
    const error = (code: string) => api.foodByBarcode(code, 'es').catch(codeOf);
    expect(await error(UNKNOWN)).toBe('product_not_found');
    expect(await error(MOCK_INCOMPLETE_BARCODE)).toBe('product_incomplete');
    expect(await error('2000000000008')).toBe('product_not_found');
    expect(await error('3017620422004')).toBe('validation_error');
    expect(await error('abc')).toBe('validation_error');
  });

  it('needs consent', async () => {
    expect(await mockApi().foodByBarcode(NUTELLA, 'es').catch(codeOf)).toBe('consent_required');
  });

  it('logs a product, then finds it in the recents and in the search of that user', async () => {
    const { api } = await setup();
    const cola = await api.foodByBarcode(COLA, 'es');
    expect((await api.searchFoods('coca', 'es')).foods).toEqual([]);
    const saved = await api.saveMealItem(ITEM_ID, {
      kind: 'food',
      foodId: cola.id,
      portion: { kind: 'serving', servingId: cola.servings[0]!.id, servings: 1 },
      inputMethod: 'barcode',
      localDate: TODAY,
      mealType: 'lunch',
      recordedAt: at(60),
      today: TODAY,
      locale: 'es',
    });
    expect(saved.item).toMatchObject({
      label: 'Coca-Cola',
      grams: 330,
      unit: 'ml',
      inputMethod: 'barcode',
      nutrients: { kcal: 138.6 },
    });
    expect((await api.recentFoods('es')).recents.map((r) => r.food.id)).toEqual([cola.id]);
    expect((await api.searchFoods('coca', 'es')).foods.map((f) => f.id)).toEqual([cola.id]);
    await api.setFavouriteFood(cola.id, true);
    expect((await api.favouriteFoods('es')).foods.map((f) => f.id)).toEqual([cola.id]);
  });
});

describe('mock backend: custom foods (AC9–AC13)', () => {
  it('stores, lists, updates and deletes a food of the user’s own', async () => {
    const { api } = await setup();
    expect(await api.saveCustomFood(FOOD_ID, yogurt())).toEqual(
      customFoodAsFood(FOOD_ID, yogurt()),
    );
    await api.saveCustomFood(FOOD_ID_2, yogurt({ name: 'Pan de casa', brand: null, serving: null }));
    await api.saveCustomFood(FOOD_ID, yogurt({ name: 'Yogur griego' }));
    expect((await api.customFoods('es')).foods.map((f) => f.name)).toEqual([
      'Yogur griego',
      'Pan de casa',
    ]);
    expect((await api.searchFoods('granja', 'es')).foods.map((f) => f.id)).toEqual([FOOD_ID]);
    expect((await api.exportData()).customFoods).toHaveLength(2);

    await api.deleteCustomFood(FOOD_ID);
    await api.deleteCustomFood(FOOD_ID);
    expect((await api.customFoods('es')).foods.map((f) => f.id)).toEqual([FOOD_ID_2]);
    expect(await api.getFood(FOOD_ID, 'es').catch(codeOf)).toBe('not_found');
  });

  it('finds the user’s own food by its barcode before the product', async () => {
    const { api } = await setup();
    await api.saveCustomFood(FOOD_ID, yogurt({ barcode: NUTELLA }));
    expect(await api.foodByBarcode(NUTELLA, 'es')).toMatchObject({ id: FOOD_ID, origin: 'manual' });
    const second = api.saveCustomFood(FOOD_ID_2, yogurt({ barcode: NUTELLA }));
    await expect(second).rejects.toMatchObject({ fields: { barcode: 'already_used' } });
  });

  it('keeps the logged item when its food is deleted (AC12)', async () => {
    const { api } = await setup();
    const food = await api.saveCustomFood(FOOD_ID, yogurt());
    await api.saveMealItem(ITEM_ID, firstItem(food).request);
    await api.setFavouriteFood(FOOD_ID, true);
    await api.deleteCustomFood(FOOD_ID);
    expect((await api.listFoodLog({ from: TODAY, to: TODAY })).items).toMatchObject([
      { id: ITEM_ID, foodId: null, servingId: null, label: 'Yogur natural', grams: 250 },
    ]);
    expect((await api.favouriteFoods('es')).foods).toEqual([]);
  });

  it('applies the rules of the API: ranges, the limit and the owner (AC10, AC12, AC13)', async () => {
    const { api } = await setup();
    const per100g = { kcal: 500, proteinG: 40, carbsG: 40, fatG: 30, fiberG: null };
    await expect(api.saveCustomFood(FOOD_ID, yogurt({ per100g }))).rejects.toMatchObject({
      fields: { per100g: 'macros_too_high' },
    });
    await expect(
      api.saveCustomFood(FOOD_ID, yogurt({ barcode: '3017620422004' })),
    ).rejects.toMatchObject({ fields: { barcode: 'invalid' } });

    await api.saveCustomFood(FOOD_ID, yogurt());
    const other = mockApi('luis@example.com');
    // Each mock client has its own database; the owner rule is tested through the product ids.
    await other.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    const product = await other.foodByBarcode(NUTELLA, 'es');
    expect(await other.saveCustomFood(product.id, yogurt()).catch(codeOf)).toBe('not_found');
    expect(await other.getFood(FOOD_ID, 'es').catch(codeOf)).toBe('not_found');

    const id = (n: number) => `72000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    for (let n = 1; n < 200; n++) {
      await api.saveCustomFood(id(n), yogurt({ name: `Alimento ${n}`, serving: null }));
    }
    expect(await api.saveCustomFood(id(200), yogurt()).catch(codeOf)).toBe('food_limit_reached');
    await expect(api.saveCustomFood(id(1), yogurt({ name: 'Editado' }))).resolves.toMatchObject({
      name: 'Editado',
    });
  });
});

describe('mock backend: label photo (AC15–AC18)', () => {
  const scan = (api: ReturnType<typeof mockApi>, data = IMAGE) =>
    api.scanLabel({ image: { mediaType: 'image/jpeg', data }, locale: 'es' });

  it('returns a draft per 100 g, and "not a label" for a tiny image', async () => {
    const { api } = await setup();
    expect(await scan(api)).toEqual({
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
    expect(await scan(api, 'AAAA')).toEqual({ status: 'unreadable', reason: 'not_a_label' });
    const usage = (await api.exportData()).aiUsage;
    expect(usage.map((u) => u.feature)).toEqual(['label_scan', 'label_scan']);
    // Nothing of the image is kept (AC19).
    expect(JSON.stringify(await api.exportData())).not.toContain(IMAGE);
  });

  it('stops at 20 reads a day and rejects what is not an image', async () => {
    let now = NOW;
    const api = mockApi('ana@example.com', () => now);
    await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    for (let n = 0; n < LABEL_SCAN_LIMITS.perDay; n++) await scan(api);
    expect(await scan(api).catch(codeOf)).toBe('ai_cap_reached');
    now = new Date('2026-11-17T00:00:01.000Z');
    await expect(scan(api)).resolves.toMatchObject({ status: 'ok' });
    expect(await scan(api, 'not base64!').catch(codeOf)).toBe('validation_error');
    const big = 'A'.repeat(Math.ceil((LABEL_SCAN_LIMITS.imageBytesMax * 4) / 3) + 8);
    expect(await scan(api, big).catch(codeOf)).toBe('image_too_large');
  });
});

describe('custom food mutations (AC11, AC12)', () => {
  it('shows a new food at once, also to the portion sheet, and stores it', async () => {
    const { api, queryClient, saveFood, own, load } = await setup();
    await load();
    const pending = saveFood({ id: FOOD_ID, request: yogurt() });
    await tick();
    expect(own()).toEqual([customFoodAsFood(FOOD_ID, yogurt())]);
    expect(queryClient.getQueryData<Food>(foodKeys.food(FOOD_ID, 'es'))?.name).toBe(
      'Yogur natural',
    );
    await pending;
    expect((await api.customFoods('es')).foods).toEqual(own());
  });

  it('sends a food created offline before its first item, once, after a restart', async () => {
    const { api, queryClient, saveFood, saveItem, own, log, load } = await setup();
    await load();
    onlineManager.setOnline(false);

    const food = customFoodAsFood(FOOD_ID, yogurt());
    void saveFood({ id: FOOD_ID, request: yogurt() });
    void saveItem(firstItem(food));
    await tick();
    expect(own().map((f) => f.id)).toEqual([FOOD_ID]);
    expect(log()).toMatchObject([{ id: ITEM_ID, foodId: FOOD_ID, grams: 250 }]);
    expect((await api.customFoods('es')).foods).toEqual([]);

    // The app is closed: only the dehydrated state survives.
    const saved = JSON.parse(JSON.stringify(dehydrate(queryClient))) as ReturnType<
      typeof dehydrate
    >;
    const restarted = client(api);
    hydrate(restarted.queryClient, saved);
    onlineManager.setOnline(true);
    await restarted.queryClient.resumePausedMutations();

    expect((await api.customFoods('es')).foods.map((f) => f.id)).toEqual([FOOD_ID]);
    // The item reached the API after its food: otherwise it would be a 404 and no item.
    expect((await api.listFoodLog({ from: TODAY, to: TODAY })).items).toMatchObject([
      { id: ITEM_ID, foodId: FOOD_ID, label: 'Yogur natural', inputMethod: 'custom' },
    ]);
    expect(restarted.queryClient.getQueryData(foodKeys.rejected) ?? null).toBeNull();
  });

  it('undoes a food the API rejects and says why (AC21 of spec 005)', async () => {
    const { queryClient, saveFood, own, load } = await setup();
    await load();
    const per100g = { kcal: 500, proteinG: 40, carbsG: 40, fatG: 30, fiberG: null };
    await saveFood({ id: FOOD_ID, request: yogurt({ per100g }) }).catch(() => null);
    expect(own()).toEqual([]);
    expect(queryClient.getQueryData<RejectedFoodWrite>(foodKeys.rejected)).toMatchObject({
      id: FOOD_ID,
      code: 'validation_error',
      fields: { per100g: 'macros_too_high' },
    });
    expect(queryClient.getQueryData(foodKeys.food(FOOD_ID, 'es'))).toBeUndefined();
  });

  it('deletes a food at once and leaves its logged item without the food', async () => {
    const { api, queryClient, saveFood, saveItem, deleteFood, own, log, load } = await setup();
    await load();
    await saveFood({ id: FOOD_ID, request: yogurt() });
    const food = own()[0]!;
    await saveItem(firstItem(food));
    queryClient.setQueryData<RecentFood[]>(foodKeys.recents('es'), [
      { food, lastPortion: { kind: 'grams', grams: 100 } },
    ]);

    const pending = deleteFood({ food });
    await tick();
    expect(own()).toEqual([]);
    expect(log()).toMatchObject([{ id: ITEM_ID, foodId: null, label: 'Yogur natural' }]);
    expect(queryClient.getQueryData<RecentFood[]>(foodKeys.recents('es'))).toEqual([]);
    await pending;
    expect((await api.customFoods('es')).foods).toEqual([]);
  });
});

describe('barcode lookups on the device (AC3, AC8)', () => {
  it('finds a food with that barcode among the own foods, the recents and the favourites', async () => {
    const { queryClient } = await setup();
    const own = customFoodAsFood(FOOD_ID, yogurt({ barcode: NUTELLA }));
    const recent = { ...customFoodAsFood(FOOD_ID_2, yogurt()), barcode: COLA };
    const favourite = { ...recent, id: ITEM_ID, barcode: WINE };
    expect(cachedFoodByBarcode(queryClient, NUTELLA, 'es')).toBeNull();
    queryClient.setQueryData(foodKeys.customFoods('es'), [own]);
    queryClient.setQueryData(foodKeys.recents('es'), [
      { food: recent, lastPortion: { kind: 'grams', grams: 100 } },
      // The same barcode as the own food: the own food wins, as in the API.
      { food: { ...recent, barcode: NUTELLA }, lastPortion: { kind: 'grams', grams: 100 } },
    ]);
    queryClient.setQueryData(foodKeys.favourites('es'), [favourite]);
    expect(cachedFoodByBarcode(queryClient, NUTELLA, 'es')?.id).toBe(FOOD_ID);
    expect(cachedFoodByBarcode(queryClient, COLA, 'es')?.id).toBe(FOOD_ID_2);
    expect(cachedFoodByBarcode(queryClient, WINE, 'es')?.id).toBe(ITEM_ID);
    expect(cachedFoodByBarcode(queryClient, UNKNOWN, 'es')).toBeNull();
  });

  it('fetches a product once and does not retry a "not found"', async () => {
    const { api, queryClient } = await setup();
    let calls = 0;
    const counting = {
      ...api,
      foodByBarcode: (code: string, locale: 'es' | 'en') => {
        calls += 1;
        return api.foodByBarcode(code, locale);
      },
    };
    const lookup = (code: string) =>
      queryClient.fetchQuery(foodByBarcodeQueryOptions(counting, code, 'es'));
    expect((await lookup(NUTELLA)).name).toBe('Nutella');
    expect((await lookup(NUTELLA)).name).toBe('Nutella');
    expect(calls).toBe(1);
    expect(await lookup(UNKNOWN).catch(codeOf)).toBe('product_not_found');
    expect(calls).toBe(2);
  });
});
