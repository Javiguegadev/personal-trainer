import type { MealItem } from '@pt/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNull,
  isNotNull,
  lte,
  schema,
  sql,
  type Db,
} from '@pt/db';
import type { CatalogFood, Store } from '../deps';

const { favouriteFoods, foodServings, foods, knowledgeSources, mealItems } = schema;

type MealItemRow = typeof mealItems.$inferSelect;

function toMealItem(row: MealItemRow): MealItem {
  return {
    id: row.id,
    localDate: row.localDate,
    mealType: row.mealType,
    foodId: row.foodId,
    servingId: row.servingId,
    servings: row.servings,
    servingLabel: row.servingLabel,
    grams: row.grams,
    label: row.label,
    nutrients: {
      kcal: row.kcal,
      proteinG: row.proteinG,
      carbsG: row.carbsG,
      fatG: row.fatG,
      fiberG: row.fiberG,
    },
    inputMethod: row.inputMethod,
    recordedAt: row.recordedAt.toISOString(),
  };
}

const live = (userId: string) => and(eq(mealItems.userId, userId), isNull(mealItems.deletedAt));

type FoodStore = Pick<
  Store,
  | 'listCatalog'
  | 'listKnowledgeSources'
  | 'listMealItems'
  | 'countMealItems'
  | 'upsertMealItem'
  | 'deleteMealItem'
  | 'listRecentFoodItems'
  | 'listFavouriteFoodIds'
  | 'setFavouriteFood'
>;

/** The food catalog and the food log (spec 005), on Drizzle. */
export function createFoodStore(db: Db): FoodStore {
  return {
    async listCatalog() {
      const [foodRows, servingRows] = await Promise.all([
        db.select().from(foods),
        db.select().from(foodServings).orderBy(asc(foodServings.foodId), asc(foodServings.sort)),
      ]);
      const servingsByFood = new Map<string, CatalogFood['servings']>();
      for (const s of servingRows) {
        const list = servingsByFood.get(s.foodId) ?? [];
        list.push({ id: s.id, labelEs: s.labelEs, labelEn: s.labelEn, grams: s.grams });
        servingsByFood.set(s.foodId, list);
      }
      return foodRows.map((f) => ({
        id: f.id,
        key: f.key,
        source: f.source,
        nameEs: f.nameEs,
        nameEn: f.nameEn,
        synonymsEs: f.synonymsEs,
        popularity: f.popularity,
        per100g: {
          kcal: f.kcal100g,
          proteinG: f.proteinG100g,
          carbsG: f.carbsG100g,
          fatG: f.fatG100g,
          fiberG: f.fiberG100g,
        },
        servings: servingsByFood.get(f.id) ?? [],
      }));
    },

    async listKnowledgeSources() {
      const rows = await db.select().from(knowledgeSources).orderBy(asc(knowledgeSources.id));
      return rows.map(({ importedAt: _, ...source }) => source);
    },

    async listMealItems(userId, from, to) {
      const rows = await db
        .select()
        .from(mealItems)
        .where(and(live(userId), gte(mealItems.localDate, from), lte(mealItems.localDate, to)))
        .orderBy(asc(mealItems.localDate), asc(mealItems.recordedAt));
      return rows.map(toMealItem);
    },

    async countMealItems(userId, localDate) {
      const [row] = await db
        .select({ n: count() })
        .from(mealItems)
        .where(and(live(userId), eq(mealItems.localDate, localDate)));
      return row?.n ?? 0;
    },

    async upsertMealItem(userId, item) {
      const update = {
        localDate: item.localDate,
        mealType: item.mealType,
        foodId: item.foodId,
        servingId: item.servingId,
        servings: item.servings,
        servingLabel: item.servingLabel,
        label: item.label,
        grams: item.grams,
        kcal: item.nutrients.kcal,
        proteinG: item.nutrients.proteinG,
        carbsG: item.nutrients.carbsG,
        fatG: item.nutrients.fatG,
        fiberG: item.nutrients.fiberG,
        inputMethod: item.inputMethod,
        recordedAt: new Date(item.recordedAt),
        deletedAt: null,
      };
      const values = { id: item.id, userId, ...update };
      // AC20: the later device time wins, also against a delete; another user's id is never touched.
      await db
        .insert(mealItems)
        .values(values)
        .onConflictDoUpdate({
          target: mealItems.id,
          set: { ...update, updatedAt: sql`now()` },
          setWhere: sql`${mealItems.userId} = ${userId} and ${mealItems.recordedAt} <= ${item.recordedAt}::timestamptz`,
        });
      const [row] = await db
        .select()
        .from(mealItems)
        .where(and(eq(mealItems.id, item.id), eq(mealItems.userId, userId)));
      return row && row.deletedAt === null ? toMealItem(row) : null;
    },

    async deleteMealItem(userId, id, recordedAt) {
      const at = new Date(recordedAt);
      await db
        .update(mealItems)
        .set({ deletedAt: sql`now()`, recordedAt: at, updatedAt: sql`now()` })
        .where(
          and(eq(mealItems.id, id), eq(mealItems.userId, userId), lte(mealItems.recordedAt, at)),
        );
    },

    async listRecentFoodItems(userId, since, limit) {
      const rows = await db
        .selectDistinctOn([mealItems.foodId])
        .from(mealItems)
        .where(and(live(userId), isNotNull(mealItems.foodId), gte(mealItems.localDate, since)))
        .orderBy(mealItems.foodId, desc(mealItems.recordedAt));
      return rows
        .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
        .slice(0, limit)
        .map(toMealItem);
    },

    async listFavouriteFoodIds(userId) {
      const rows = await db
        .select({ foodId: favouriteFoods.foodId })
        .from(favouriteFoods)
        .where(eq(favouriteFoods.userId, userId))
        .orderBy(desc(favouriteFoods.createdAt));
      return rows.map((r) => r.foodId);
    },

    async setFavouriteFood(userId, foodId, favourite, at) {
      if (favourite) {
        await db
          .insert(favouriteFoods)
          .values({ userId, foodId, createdAt: at })
          .onConflictDoNothing();
      } else {
        await db
          .delete(favouriteFoods)
          .where(and(eq(favouriteFoods.userId, userId), eq(favouriteFoods.foodId, foodId)));
      }
    },
  };
}

/** The food log and the favourites for "Download my data" (AC23). */
export async function exportFoodLog(db: Db, userId: string) {
  const [items, favourites] = await Promise.all([
    db
      .select()
      .from(mealItems)
      .where(live(userId))
      .orderBy(asc(mealItems.localDate), asc(mealItems.recordedAt)),
    db
      .select({
        foodId: favouriteFoods.foodId,
        key: foods.key,
        createdAt: favouriteFoods.createdAt,
      })
      .from(favouriteFoods)
      .innerJoin(foods, eq(foods.id, favouriteFoods.foodId))
      .where(eq(favouriteFoods.userId, userId))
      .orderBy(desc(favouriteFoods.createdAt)),
  ]);
  return {
    mealItems: items.map(toMealItem),
    favouriteFoods: favourites.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() })),
  };
}
