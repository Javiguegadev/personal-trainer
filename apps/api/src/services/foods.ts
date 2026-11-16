import type { Food, Locale, MealItem, Portion, RecentFood } from '@pt/contracts';
import {
  buildFoodSearchIndex,
  productEnergyMismatch,
  searchableBrandedFood,
  type FoodSearchIndex,
} from '@pt/core';
import type { CatalogFood, Store } from '../deps';
import { offProductUrl } from '../off/client';

/** A stored food in one language, as the API returns it. */
export function toFood(food: CatalogFood, locale: Locale): Food {
  const isProduct = food.origin === 'off';
  return {
    id: food.id,
    key: food.key,
    name: locale === 'en' ? food.nameEn : food.nameEs,
    per100g: food.per100g,
    servings: food.servings.map((s) => ({
      id: s.id,
      label: locale === 'en' ? s.labelEn : s.labelEs,
      grams: s.grams,
    })),
    source: food.source,
    origin: food.origin,
    unit: food.unit,
    brand: food.brand,
    barcode: food.barcode,
    allergens: food.allergens,
    traces: food.traces,
    // Only Open Food Facts values are unchecked by us and by the user (spec 006 AC5).
    sourceUrl: isProduct && food.barcode ? offProductUrl(food.barcode) : null,
    energyMismatch: isProduct && productEnergyMismatch(food.per100g),
  };
}

export interface Catalog {
  foods: CatalogFood[];
  byId: Map<string, CatalogFood>;
  index: FoodSearchIndex;
}

/** The catalog changes only when the importer runs, so each API instance keeps it for a while. */
const CATALOG_TTL_MS = 10 * 60 * 1000;

/**
 * Loads the curated catalog once per instance and builds the search index (spec 005 AC4). Products and
 * custom foods are never in it: a custom food is private, so nothing of a user stays in shared memory.
 */
export function createCatalogCache(store: Store, now: () => Date) {
  let cached: { catalog: Catalog; loadedAt: number } | null = null;
  let loading: Promise<Catalog> | null = null;

  return async function getCatalog(): Promise<Catalog> {
    if (cached && now().getTime() - cached.loadedAt < CATALOG_TTL_MS) return cached.catalog;
    loading ??= store
      .listCatalog()
      .then((foods) => {
        const catalog = {
          foods,
          byId: new Map(foods.map((f) => [f.id, f])),
          index: buildFoodSearchIndex(foods),
        };
        cached = { catalog, loadedAt: now().getTime() };
        return catalog;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  };
}

/**
 * The foods with these ids that the user may read (spec 006 AC13): the catalog from the cache, and
 * products and the user's own foods from the database.
 */
export async function resolveFoods(
  store: Store,
  catalog: Catalog,
  userId: string,
  ids: readonly string[],
): Promise<Map<string, CatalogFood>> {
  const found = new Map<string, CatalogFood>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const food = catalog.byId.get(id);
    if (food) found.set(id, food);
    else missing.push(id);
  }
  if (missing.length > 0) {
    for (const food of await store.getFoods(userId, missing)) found.set(food.id, food);
  }
  return found;
}

/** How many of the user's logged products join their search (spec 006 AC11). */
const LOGGED_PRODUCTS_MAX = 300;

/** The user's own foods and the products they logged: what only their search adds to the catalog. */
export async function userSearchFoods(store: Store, userId: string) {
  const [own, products] = await Promise.all([
    store.listCustomFoods(userId),
    store.listLoggedProducts(userId, LOGGED_PRODUCTS_MAX),
  ]);
  const foods = [...own, ...products];
  return {
    byId: new Map(foods.map((f) => [f.id, f])),
    index: buildFoodSearchIndex(
      foods.map((f) => searchableBrandedFood({ id: f.id, name: f.nameEs, brand: f.brand })),
    ),
  };
}

/** The portion of a logged item, to preselect it in the portion sheet (AC8). */
export function portionOf(item: MealItem, food: CatalogFood): Portion | null {
  if (item.servingId !== null && item.servings !== null) {
    if (food.servings.some((s) => s.id === item.servingId)) {
      return { kind: 'serving', servingId: item.servingId, servings: item.servings };
    }
  }
  return item.grams !== null ? { kind: 'grams', grams: item.grams } : null;
}

/** Recently logged foods with the portion used last (AC7). */
export function toRecentFoods(
  items: MealItem[],
  foods: ReadonlyMap<string, CatalogFood>,
  locale: Locale,
): RecentFood[] {
  return items.flatMap((item) => {
    const food = item.foodId ? foods.get(item.foodId) : undefined;
    const portion = food ? portionOf(item, food) : null;
    return food && portion ? [{ food: toFood(food, locale), lastPortion: portion }] : [];
  });
}
