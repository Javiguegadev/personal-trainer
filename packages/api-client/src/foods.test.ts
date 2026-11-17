import {
  CONSENT_VERSION,
  type Food,
  type MealItem,
  type MealItemSaveResponse,
  type MealItemUpsertRequest,
} from '@pt/contracts';
import { itemToRequest, repeatMeal, type ItemPlacement } from '@pt/core';
import {
  MutationObserver,
  QueryClient,
  dehydrate,
  hydrate,
  onlineManager,
  skipToken,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import {
  favouriteFoodsQueryOptions,
  foodKeys,
  foodLogQueryOptions,
  foodSearchQueryOptions,
  recentFoodsQueryOptions,
  registerFoodMutations,
  saveItemVariables,
  withFavourite,
  withMealItem,
  type DeleteMealItemVariables,
  type FavouriteFoodVariables,
  type SaveMealItemVariables,
} from './foods';
import { createMockApiClient } from './mock/backend';
import { MOCK_CATALOG, toMockFood } from './mock/foods';
import { mockAccessToken, mockUserFromEmail } from './mock/identity';

const NOW = new Date('2026-11-16T10:00:00.000Z');
const TODAY = '2026-11-16';
const YESTERDAY = '2026-11-15';
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const itemId = (n: number) => `50000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

const food = (key: string): Food => {
  const found = MOCK_CATALOG.find((f) => f.key === key);
  if (!found) throw new Error(`no mock food ${key}`);
  return toMockFood(found, 'es');
};
const egg = food('d-huevo');
const milk = food('c-leche-semidesnatada');

const placement = (over: Partial<ItemPlacement> = {}) => ({
  localDate: TODAY,
  mealType: 'breakfast' as const,
  recordedAt: at(60),
  today: TODAY,
  locale: 'es' as const,
  ...over,
});

/** Two medium eggs, or `grams` of milk. */
const eggs = (id: string, over: Partial<ItemPlacement> = {}) =>
  saveItemVariables(
    id,
    {
      kind: 'food',
      foodId: egg.id,
      portion: { kind: 'serving', servingId: egg.servings[0]!.id, servings: 2 },
      inputMethod: 'search',
      ...placement(over),
    },
    egg,
  );
const milkGrams = (id: string, grams: number, over: Partial<ItemPlacement> = {}) =>
  saveItemVariables(
    id,
    {
      kind: 'food',
      foodId: milk.id,
      portion: { kind: 'grams', grams },
      inputMethod: 'recent',
      ...placement(over),
    },
    milk,
  );

async function setup() {
  const token = mockAccessToken(mockUserFromEmail('ana@example.com'));
  const api = createMockApiClient({ getAccessToken: async () => token, now: () => NOW });
  await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
  return { api, ...client(api) };
}

function client(api: ReturnType<typeof createMockApiClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  registerFoodMutations(queryClient, api);
  const observe =
    <V, R>(key: readonly string[]) =>
    (variables: V) =>
      new MutationObserver<R, unknown, V>(queryClient, { mutationKey: key }).mutate(variables);
  return {
    queryClient,
    save: observe<SaveMealItemVariables, MealItemSaveResponse>(foodKeys.saveItem),
    remove: observe<DeleteMealItemVariables, MealItemSaveResponse>(foodKeys.deleteItem),
    favourite: observe<FavouriteFoodVariables, void>(foodKeys.favourite),
    cached: () => queryClient.getQueryData<MealItem[]>(foodKeys.log) ?? [],
    load: () => queryClient.fetchQuery(foodLogQueryOptions(api, TODAY)),
  };
}

const stored = async (api: Awaited<ReturnType<typeof setup>>['api']) =>
  (await api.listFoodLog({ from: '2026-11-01', to: TODAY })).items;

/** Lets the optimistic update (which awaits a cancel) reach the cache. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => onlineManager.setOnline(true));

describe('withMealItem and withFavourite', () => {
  const a = eggs(itemId(1)).preview;
  const b = { ...a, id: itemId(2), recordedAt: at(10) };
  const c = { ...a, id: itemId(3), localDate: YESTERDAY, recordedAt: at(99) };

  it('keeps the items by day and time, replaces and removes', () => {
    expect(withMealItem([b, a], itemId(3), c).map((i) => i.id)).toEqual([
      itemId(3),
      itemId(2),
      itemId(1),
    ]);
    expect(withMealItem([a, b], itemId(1), null)).toEqual([b]);
    expect(withMealItem([a], itemId(1), { ...a, servings: 3 })[0]!.servings).toBe(3);
  });

  it('adds a favourite first, once, and removes it', () => {
    expect(withFavourite([milk], egg, true)).toEqual([egg, milk]);
    expect(withFavourite([egg, milk], egg, true)).toEqual([egg, milk]);
    expect(withFavourite([egg, milk], egg, false)).toEqual([milk]);
  });
});

describe('saveItemVariables (AC9)', () => {
  it('previews the snapshot the API will store', () => {
    const { preview } = eggs(itemId(1));
    const grams = 2 * egg.servings[0]!.grams;
    expect(preview).toMatchObject({
      id: itemId(1),
      foodId: egg.id,
      label: 'Huevo',
      grams,
      servings: 2,
      servingLabel: egg.servings[0]!.label,
    });
    expect(preview.nutrients.kcal).toBeCloseTo((egg.per100g.kcal * grams) / 100, 1);
  });

  it('refuses a serving of another food', () => {
    expect(() =>
      saveItemVariables(
        itemId(1),
        { ...eggs(itemId(1)).request, foodId: milk.id } as MealItemUpsertRequest,
        milk,
      ),
    ).toThrow();
  });
});

describe('food queries', () => {
  it('loads the log of today and the 7 days before', async () => {
    const { api, save, load } = await setup();
    await save(eggs(itemId(1), { localDate: '2026-11-09' }));
    await save(eggs(itemId(2), { localDate: '2026-11-08' }));
    expect((await load()).map((i) => i.id)).toEqual([itemId(1)]);
    expect(await stored(api)).toHaveLength(2);
  });

  it('searches from 2 characters, in the requested language', async () => {
    const { api, queryClient } = await setup();
    expect(foodSearchQueryOptions(api, ' l ', 'es').queryFn).toBe(skipToken);
    const foods = await queryClient.fetchQuery(foodSearchQueryOptions(api, 'leche', 'es'));
    expect(foods[0]!.key).toBe('c-leche-semidesnatada');
    const en = await queryClient.fetchQuery(foodSearchQueryOptions(api, 'milk', 'en'));
    expect(en.map((f) => f.name)).toContain('Semi-skimmed milk');
  });
});

describe('food-log mutations (AC11, AC19–AC21)', () => {
  it('shows the item at once, then the stored one, and refreshes the recents', async () => {
    const { api, queryClient, save, cached, load } = await setup();
    await load();
    await queryClient.fetchQuery(recentFoodsQueryOptions(api, 'es'));

    const pending = save(eggs(itemId(1)));
    await tick();
    expect(cached()).toEqual([eggs(itemId(1)).preview]);

    await pending;
    expect(cached()).toEqual(await stored(api));
    expect(queryClient.getQueryState(foodKeys.recents('es'))?.isInvalidated).toBe(true);
  });

  it('removes the item at once, and an undo brings it back', async () => {
    const { api, save, remove, cached, load } = await setup();
    await save(eggs(itemId(1)));
    await load();
    const [item] = cached();

    const pending = remove({ id: itemId(1), recordedAt: at(120) });
    await tick();
    expect(cached()).toEqual([]);
    await pending;
    expect(await stored(api)).toEqual([]);

    // Undo: the same item written again after the delete (AC11).
    const request = itemToRequest(item!, placement({ recordedAt: at(125) }));
    await save({ id: item!.id, request, preview: { ...item!, recordedAt: at(125) } });
    expect((await stored(api)).map((i) => [i.id, i.servings])).toEqual([[itemId(1), 2]]);
  });

  it('moves an item to another meal, keeping its portion', async () => {
    const { api, save, load, cached } = await setup();
    await save(milkGrams(itemId(1), 250));
    await load();
    const [item] = cached();
    const moved = placement({ mealType: 'mid_morning', recordedAt: at(200) });
    await save({
      id: item!.id,
      request: itemToRequest(item!, moved),
      preview: { ...item!, mealType: 'mid_morning', recordedAt: moved.recordedAt },
    });
    expect(await stored(api)).toMatchObject([{ mealType: 'mid_morning', grams: 250 }]);
  });

  it('repeats yesterday with new ids, previews at once, snapshots from the catalog (AC13)', async () => {
    const { api, save, cached, load } = await setup();
    await save(eggs(itemId(1), { localDate: YESTERDAY }));
    await save(milkGrams(itemId(2), 200, { localDate: YESTERDAY, recordedAt: at(70) }));
    await load();

    const copies = repeatMeal({
      items: cached(),
      mealType: 'breakfast',
      from: YESTERDAY,
      to: TODAY,
      ids: [itemId(3), itemId(4)],
      recordedAt: at(300),
      today: TODAY,
    });
    const pending = copies.map((copy) => save(copy));
    await tick();
    expect(cached().filter((i) => i.localDate === TODAY)).toHaveLength(2);
    await Promise.all(pending);

    const today = (await stored(api)).filter((i) => i.localDate === TODAY);
    expect(today.map((i) => [i.id, i.inputMethod, i.label])).toEqual([
      [itemId(3), 'repeat', 'Huevo'],
      [itemId(4), 'repeat', 'Leche semidesnatada'],
    ]);
    expect(cached()).toEqual(await stored(api));
  });

  it('queues writes made offline, in order, and sends them once after a restart (AC19, AC20)', async () => {
    const { api, queryClient, save, remove, cached, load } = await setup();
    await load();
    onlineManager.setOnline(false);

    void save(eggs(itemId(1)));
    void save(milkGrams(itemId(2), 250, { recordedAt: at(70) }));
    void remove({ id: itemId(1), recordedAt: at(80) });
    await tick();
    expect(cached().map((i) => i.id)).toEqual([itemId(2)]);
    expect(queryClient.isMutating({ mutationKey: foodKeys.mutations })).toBe(3);
    expect(await stored(api)).toEqual([]);

    // The app is closed: only the dehydrated state survives.
    const saved = JSON.parse(JSON.stringify(dehydrate(queryClient))) as ReturnType<
      typeof dehydrate
    >;
    expect(saved.mutations).toHaveLength(3);

    const restarted = client(api);
    hydrate(restarted.queryClient, saved);
    expect(restarted.cached().map((i) => i.id)).toEqual([itemId(2)]);

    onlineManager.setOnline(true);
    await restarted.queryClient.resumePausedMutations();
    expect((await stored(api)).map((i) => [i.id, i.grams])).toEqual([[itemId(2), 250]]);
    expect(restarted.queryClient.isMutating()).toBe(0);
  });

  it('undoes a write the API rejects and says why (AC21)', async () => {
    const { api, queryClient, save, cached, load } = await setup();
    await load();
    await expect(save(eggs(itemId(1), { localDate: '2026-11-17' }))).rejects.toMatchObject({
      status: 400,
    });
    expect(cached()).toEqual([]);
    expect(queryClient.getQueryData(foodKeys.rejected)).toEqual({
      id: itemId(1),
      code: 'validation_error',
      fields: { localDate: 'in_future' },
    });
    expect(await stored(api)).toEqual([]);
  });

  it('keeps retrying a write that fails with a network error (AC21)', async () => {
    const { api, load } = await setup();
    let failures = 2;
    const flaky = {
      ...api,
      saveMealItem: (...args: Parameters<typeof api.saveMealItem>) => {
        if (failures-- > 0) return Promise.reject(new TypeError('Network request failed'));
        return api.saveMealItem(...args);
      },
    };
    const { queryClient, save } = client(flaky);
    queryClient.setMutationDefaults(foodKeys.saveItem, {
      ...queryClient.getMutationDefaults(foodKeys.saveItem),
      retryDelay: 0,
    });
    await load();
    await save(eggs(itemId(1)));
    expect(await stored(api)).toHaveLength(1);
    expect(queryClient.getQueryData(foodKeys.rejected)).toBeNull();
  });
});

describe('favourite mutations (AC14, AC19)', () => {
  it('stars and unstars a food at once', async () => {
    const { api, queryClient, favourite } = await setup();
    const list = () => queryClient.getQueryData<Food[]>(foodKeys.favourites('es'));
    await queryClient.fetchQuery(favouriteFoodsQueryOptions(api, 'es'));

    const pending = favourite({ food: egg, favourite: true, locale: 'es' });
    await tick();
    expect(list()).toEqual([egg]);
    await pending;
    expect((await api.favouriteFoods('es')).foods).toEqual([egg]);

    await favourite({ food: egg, favourite: false, locale: 'es' });
    expect(list()).toEqual([]);
    expect((await api.favouriteFoods('es')).foods).toEqual([]);
  });

  it('undoes a star the API rejects', async () => {
    const { api, queryClient, favourite } = await setup();
    await queryClient.fetchQuery(favouriteFoodsQueryOptions(api, 'es'));
    const unknown = { ...egg, id: 'f9999999-0000-4000-8000-000000000000' };
    await expect(favourite({ food: unknown, favourite: true, locale: 'es' })).rejects.toMatchObject(
      { status: 404 },
    );
    expect(queryClient.getQueryData(foodKeys.favourites('es'))).toEqual([]);
    expect(queryClient.getQueryData(foodKeys.rejected)).toMatchObject({
      id: unknown.id,
      code: 'not_found',
    });
  });
});
