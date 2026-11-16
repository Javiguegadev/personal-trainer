import type { Food, Locale, MealItem, Portion, RecentFood } from '@pt/contracts';
import { buildFoodSearchIndex, type FoodSearchIndex } from '@pt/core';
import type { CatalogFood, Store } from '../deps';

/** A catalog food in one language, as the API returns it. */
export function toFood(food: CatalogFood, locale: Locale): Food {
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
  };
}

export interface Catalog {
  foods: CatalogFood[];
  byId: Map<string, CatalogFood>;
  index: FoodSearchIndex;
}

/** The catalog changes only when the importer runs, so each API instance keeps it for a while. */
const CATALOG_TTL_MS = 10 * 60 * 1000;

/** Loads the catalog once per instance and builds the search index (spec 005 AC4). */
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

/** The portion of a logged item, to preselect it in the portion sheet (AC8). */
export function portionOf(item: MealItem, food: CatalogFood): Portion | null {
  if (item.servingId !== null && item.servings !== null) {
    if (food.servings.some((s) => s.id === item.servingId)) {
      return { kind: 'serving', servingId: item.servingId, servings: item.servings };
    }
  }
  return item.grams !== null ? { kind: 'grams', grams: item.grams } : null;
}

/** Recently logged catalog foods with the portion used last (AC7). */
export function toRecentFoods(items: MealItem[], catalog: Catalog, locale: Locale): RecentFood[] {
  return items.flatMap((item) => {
    const food = item.foodId ? catalog.byId.get(item.foodId) : undefined;
    const portion = food ? portionOf(item, food) : null;
    return food && portion ? [{ food: toFood(food, locale), lastPortion: portion }] : [];
  });
}
