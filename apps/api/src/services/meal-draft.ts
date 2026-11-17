import type { AiUsage, MealInput } from '@pt/ai';
import {
  FOOD_LOG_LIMITS,
  MEAL_DRAFT_LIMITS,
  type Food,
  type Locale,
  type MealDraftResponse,
  type MealReading,
} from '@pt/contracts';
import { addDays, mealDraft, searchFoods } from '@pt/core';
import type { CatalogFood, Deps } from '../deps';
import { toFood, userSearchFoods, type Catalog } from './foods';

/** How many recently logged foods rank first in the tool's search (spec 007). */
const RECENT_FOODS_MAX = 100;

export interface MealDraftResult {
  draft: MealDraftResponse;
  usage: AiUsage;
}

/** What the model may refer to: the foods and servings the tool showed it in this request. */
interface Refs {
  foods: Map<string, Food>;
  /** Ref of a serving → the serving id and the id of its food. */
  servings: Map<string, { foodId: string; servingId: string }>;
  byFoodId: Map<string, string>;
}

function refer(refs: Refs, food: Food): string {
  const known = refs.byFoodId.get(food.id);
  if (known) return known;
  const ref = `f${refs.foods.size + 1}`;
  refs.foods.set(ref, food);
  refs.byFoodId.set(food.id, ref);
  food.servings.forEach((serving, i) => {
    refs.servings.set(`${ref}s${i + 1}`, { foodId: food.id, servingId: serving.id });
  });
  return ref;
}

/** The reading with our ids instead of the short refs; an unknown ref becomes null (AC9). */
function resolveRefs(reading: MealReading, refs: Refs): MealReading {
  return {
    ...reading,
    items: reading.items.map((item) => {
      const food = item.foodId === null ? undefined : refs.foods.get(item.foodId);
      const serving = item.servingId === null ? undefined : refs.servings.get(item.servingId);
      return {
        ...item,
        foodId: food?.id ?? null,
        servingId: food && serving?.foodId === food.id ? serving.servingId : null,
      };
    }),
  };
}

/**
 * A meal draft from a sentence or a plate photo (spec 007 AC4–AC6, AC9). The model searches the same
 * catalog as `GET /foods/search` (curated foods, the user's own foods and logged products), with the
 * foods the user logged in the last 60 days first among equal matches. The tool shows short refs
 * (`f1`, `f1s1`) instead of ids: fewer tokens, and an id the tool never showed cannot come back.
 * `@pt/core` then checks every item and portion. Nothing is stored: the user saves the draft.
 */
export function createMealDrafter(
  deps: Pick<Deps, 'store' | 'readMeal' | 'now'>,
  getCatalog: () => Promise<Catalog>,
) {
  return async function draftMeal(
    userId: string,
    input: MealInput,
    locale: Locale,
  ): Promise<MealDraftResult> {
    const since = addDays(deps.now().toISOString().slice(0, 10), -FOOD_LOG_LIMITS.recentsDays);
    const [catalog, mine, recentItems] = await Promise.all([
      getCatalog(),
      userSearchFoods(deps.store, userId),
      deps.store.listRecentFoodItems(userId, since, RECENT_FOODS_MAX),
    ]);
    const recent = new Set(recentItems.flatMap((item) => (item.foodId ? [item.foodId] : [])));
    const refs: Refs = { foods: new Map(), servings: new Map(), byFoodId: new Map() };
    const findFood = (id: string): CatalogFood | undefined =>
      mine.byId.get(id) ?? catalog.byId.get(id);

    const search = async (queries: string[]) => {
      const results = queries
        .map((query) => query.trim().slice(0, FOOD_LOG_LIMITS.searchMaxLength))
        .filter((query) => query.length >= FOOD_LOG_LIMITS.searchMinLength)
        .slice(0, MEAL_DRAFT_LIMITS.toolQueriesMax)
        .map((query) => {
          const ids = searchFoods(
            catalog.index,
            query,
            locale,
            MEAL_DRAFT_LIMITS.toolResultsPerQuery,
            mine.index,
            recent,
          );
          const foods = ids.flatMap((id) => {
            const food = findFood(id);
            if (!food) return [];
            const shown = toFood(food, locale);
            const ref = refer(refs, shown);
            return [
              {
                ref,
                name: shown.brand ? `${shown.name} (${shown.brand})` : shown.name,
                unit: shown.unit,
                kcalPer100: Math.round(shown.per100g.kcal),
                servings: shown.servings.map((s, i) => ({
                  ref: `${ref}s${i + 1}`,
                  label: s.label,
                  grams: s.grams,
                })),
              },
            ];
          });
          return { query, foods };
        });
      return JSON.stringify({ results });
    };

    const { reading, usage } = await deps.readMeal(input, search);
    return { draft: mealDraft(resolveRefs(reading, refs), byId(refs)), usage };
  };
}

function byId(refs: Refs): Map<string, Food> {
  return new Map([...refs.foods.values()].map((food) => [food.id, food]));
}
