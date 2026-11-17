import type { MealItem } from '@pt/contracts';
import { USER_FOOD_SOURCE } from '@pt/core';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  isNotNull,
  lte,
  ne,
  or,
  schema,
  sql,
  type Db,
  type SQL,
} from '@pt/db';
import type { BarcodeMissReason, CatalogFood, Store } from '../deps';
import { toFood } from '../services/foods';

const { barcodeMisses, favouriteFoods, foodServings, foods, knowledgeSources, mealItems } = schema;

type MealItemRow = typeof mealItems.$inferSelect;
type FoodRow = typeof foods.$inferSelect;
type ServingRow = typeof foodServings.$inferSelect;

/** `knowledge_sources.id` of the products read from Open Food Facts. */
const OFF_SOURCE = 'open-food-facts';

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
    unit: row.quantityUnit,
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

function toCatalogFood(row: FoodRow, servings: ServingRow[]): CatalogFood {
  return {
    id: row.id,
    key: row.key,
    source: row.source,
    nameEs: row.nameEs,
    nameEn: row.nameEn,
    synonymsEs: row.synonymsEs,
    popularity: row.popularity,
    per100g: {
      kcal: row.kcal100g,
      proteinG: row.proteinG100g,
      carbsG: row.carbsG100g,
      fatG: row.fatG100g,
      fiberG: row.fiberG100g,
    },
    servings: servings.map((s) => ({
      id: s.id,
      labelEs: s.labelEs,
      labelEn: s.labelEn,
      grams: s.grams,
    })),
    origin: row.origin,
    unit: row.quantityUnit,
    brand: row.brand,
    barcode: row.barcode,
    ownerId: row.ownerId,
    allergens: row.allergens,
    traces: row.traces,
    fetchedAt: row.fetchedAt?.toISOString() ?? null,
  };
}

const live = (userId: string) => and(eq(mealItems.userId, userId), isNull(mealItems.deletedAt));

/** What a user may read: everything without an owner, and their own foods (spec 006 AC13). */
const visibleTo = (userId: string) => or(isNull(foods.ownerId), eq(foods.ownerId, userId));

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
  | 'getFoods'
  | 'findFoodsByBarcode'
  | 'saveProduct'
  | 'getBarcodeMiss'
  | 'recordBarcodeMiss'
  | 'listCustomFoods'
  | 'upsertCustomFood'
  | 'deleteCustomFood'
  | 'listLoggedProducts'
>;

type Reader = Pick<Db, 'select'>;

/** Foods matching `where`, each with its servings in order. Most recently changed first. */
async function loadFoods(db: Reader, where: SQL | undefined): Promise<CatalogFood[]> {
  const [foodRows, servingRows] = await Promise.all([
    db.select().from(foods).where(where).orderBy(desc(foods.updatedAt), asc(foods.id)),
    db
      .select({ serving: foodServings })
      .from(foodServings)
      .innerJoin(foods, eq(foods.id, foodServings.foodId))
      .where(where)
      .orderBy(asc(foodServings.foodId), asc(foodServings.sort)),
  ]);
  const servingsByFood = new Map<string, ServingRow[]>();
  for (const { serving } of servingRows) {
    const list = servingsByFood.get(serving.foodId) ?? [];
    list.push(serving);
    servingsByFood.set(serving.foodId, list);
  }
  return foodRows.map((f) => toCatalogFood(f, servingsByFood.get(f.id) ?? []));
}

/** The food catalog, the food log (spec 005), scanned products and custom foods (spec 006), on Drizzle. */
export function createFoodStore(db: Db): FoodStore {
  return {
    async listCatalog() {
      return loadFoods(db, eq(foods.origin, 'catalog'));
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
        quantityUnit: item.unit,
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

    async getFoods(userId, ids) {
      if (ids.length === 0) return [];
      return loadFoods(db, and(inArray(foods.id, [...ids]), visibleTo(userId)));
    },

    async findFoodsByBarcode(userId, barcode) {
      const rows = await loadFoods(
        db,
        and(eq(foods.barcode, barcode), or(eq(foods.ownerId, userId), eq(foods.origin, 'off'))),
      );
      return {
        own: rows.find((f) => f.ownerId === userId) ?? null,
        product: rows.find((f) => f.origin === 'off') ?? null,
      };
    },

    async saveProduct(product, at) {
      const id = await db.transaction(async (tx) => {
        const row = {
          key: `off-${product.barcode}`,
          source: OFF_SOURCE,
          sourceId: product.barcode,
          nameEs: product.name,
          nameEn: product.name,
          kcal100g: product.per100g.kcal,
          proteinG100g: product.per100g.proteinG,
          carbsG100g: product.per100g.carbsG,
          fatG100g: product.per100g.fatG,
          fiberG100g: product.per100g.fiberG,
          origin: 'off' as const,
          quantityUnit: product.unit,
          brand: product.brand,
          barcode: product.barcode,
          allergens: product.allergens,
          traces: product.traces,
          fetchedAt: at,
        };
        const [food] = await tx
          .insert(foods)
          .values(row)
          .onConflictDoUpdate({ target: foods.key, set: { ...row, updatedAt: sql`now()` } })
          .returning({ id: foods.id });
        const foodId = food!.id;
        // Servings keep their ids by position, as in the catalog importer: logged items point to them.
        const existing = await tx
          .select({ id: foodServings.id, sort: foodServings.sort })
          .from(foodServings)
          .where(eq(foodServings.foodId, foodId));
        for (const [sort, serving] of product.servings.entries()) {
          const current = existing.find((s) => s.sort === sort);
          if (current) {
            await tx.update(foodServings).set(serving).where(eq(foodServings.id, current.id));
          } else {
            await tx.insert(foodServings).values({ ...serving, foodId, sort });
          }
        }
        await tx
          .delete(foodServings)
          .where(
            and(
              eq(foodServings.foodId, foodId),
              gt(foodServings.sort, product.servings.length - 1),
            ),
          );
        await tx.delete(barcodeMisses).where(eq(barcodeMisses.barcode, product.barcode));
        return foodId;
      });
      const [saved] = await loadFoods(db, eq(foods.id, id));
      return saved!;
    },

    async getBarcodeMiss(barcode, since) {
      const [row] = await db
        .select({ reason: barcodeMisses.reason })
        .from(barcodeMisses)
        .where(and(eq(barcodeMisses.barcode, barcode), gt(barcodeMisses.checkedAt, since)));
      return row ? (row.reason as BarcodeMissReason) : null;
    },

    async recordBarcodeMiss(barcode, reason, at) {
      await db
        .insert(barcodeMisses)
        .values({ barcode, reason, checkedAt: at })
        .onConflictDoUpdate({ target: barcodeMisses.barcode, set: { reason, checkedAt: at } });
    },

    async listCustomFoods(userId) {
      return loadFoods(db, eq(foods.ownerId, userId));
    },

    async upsertCustomFood(userId, id, food, at) {
      const outcome = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ ownerId: foods.ownerId })
          .from(foods)
          .where(eq(foods.id, id));
        if (existing && existing.ownerId !== userId) return 'not_owner' as const;
        if (food.barcode !== null) {
          const [other] = await tx
            .select({ id: foods.id })
            .from(foods)
            .where(
              and(eq(foods.ownerId, userId), eq(foods.barcode, food.barcode), ne(foods.id, id)),
            );
          if (other) return 'barcode_taken' as const;
        }
        const row = {
          key: `user-${id}`,
          source: USER_FOOD_SOURCE,
          sourceId: id,
          nameEs: food.name,
          nameEn: food.name,
          kcal100g: food.per100g.kcal,
          proteinG100g: food.per100g.proteinG,
          carbsG100g: food.per100g.carbsG,
          fatG100g: food.per100g.fatG,
          fiberG100g: food.per100g.fiberG,
          origin: food.origin,
          quantityUnit: food.unit,
          brand: food.brand,
          barcode: food.barcode,
          ownerId: userId,
        };
        await tx
          .insert(foods)
          .values({ id, ...row, createdAt: at, updatedAt: at })
          .onConflictDoUpdate({ target: foods.id, set: { ...row, updatedAt: at } });
        // A custom food has at most one serving, whose id the device chose.
        const keep = food.serving?.id;
        await tx
          .delete(foodServings)
          .where(
            keep
              ? and(eq(foodServings.foodId, id), ne(foodServings.id, keep))
              : eq(foodServings.foodId, id),
          );
        if (food.serving) {
          const serving = {
            labelEs: food.serving.label,
            labelEn: food.serving.label,
            grams: food.serving.grams,
            sort: 0,
          };
          await tx
            .insert(foodServings)
            .values({ id: food.serving.id, foodId: id, ...serving })
            .onConflictDoUpdate({
              target: foodServings.id,
              set: serving,
              // An id that is already a serving of another food is left alone.
              setWhere: eq(foodServings.foodId, id),
            });
        }
        return 'saved' as const;
      });
      if (outcome !== 'saved') return outcome;
      const [saved] = await loadFoods(db, eq(foods.id, id));
      return saved!;
    },

    async deleteCustomFood(userId, id) {
      await db.delete(foods).where(and(eq(foods.id, id), eq(foods.ownerId, userId)));
    },

    async listLoggedProducts(userId, limit) {
      const rows = await db
        .selectDistinct({ id: foods.id })
        .from(mealItems)
        .innerJoin(foods, eq(foods.id, mealItems.foodId))
        .where(and(live(userId), eq(foods.origin, 'off')))
        .limit(limit);
      if (rows.length === 0) return [];
      return loadFoods(
        db,
        inArray(
          foods.id,
          rows.map((r) => r.id),
        ),
      );
    },
  };
}

/** The food log, the favourites and the user's own foods for "Download my data" (AC23, spec 006 AC22). */
export async function exportFoodLog(db: Db, userId: string) {
  const [items, favourites, customFoods] = await Promise.all([
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
    loadFoods(db, eq(foods.ownerId, userId)),
  ]);
  return {
    mealItems: items.map(toMealItem),
    favouriteFoods: favourites.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() })),
    customFoods: customFoods.map((f) => toFood(f, 'es')),
  };
}
