import { createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  FOOD_LOG_LIMITS,
  FavouriteFoodParamSchema,
  FavouriteFoodsResponseSchema,
  FoodLocaleQuerySchema,
  FoodLogQuerySchema,
  FoodLogResponseSchema,
  FoodSearchQuerySchema,
  FoodSearchResponseSchema,
  KnowledgeSourcesResponseSchema,
  MealItemDeleteQuerySchema,
  MealItemIdParamSchema,
  MealItemSaveResponseSchema,
  MealItemUpsertRequestSchema,
  RecentFoodsResponseSchema,
} from '@pt/contracts';
import {
  addDays,
  checkFoodLogRange,
  checkFoodLogWrite,
  mealItemFromRequest,
  searchFoods,
} from '@pt/core';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';
import { createCatalogCache, toFood, toRecentFoods } from '../../services/foods';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});
const json = <T>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});

/**
 * Food catalog, search and food log (spec 005). Every route that touches what the user eats needs the
 * current consent, search included: the query says what the user eats.
 */
export function foodRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);
  const getCatalog = createCatalogCache(deps.store, deps.now);

  const search = createRoute({
    method: 'get',
    path: '/foods/search',
    tags: ['foods'],
    middleware: [auth, consent] as const,
    request: { query: FoodSearchQuerySchema },
    responses: {
      200: json('Best matches first (AC4)', FoodSearchResponseSchema),
      400: error('Query shorter than 2 or longer than 60 characters'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const sources = createRoute({
    method: 'get',
    path: '/foods/sources',
    tags: ['foods'],
    middleware: [auth] as const,
    request: { query: FoodLocaleQuerySchema },
    responses: {
      200: json('Knowledge sources with their attribution (AC3)', KnowledgeSourcesResponseSchema),
      401: error('Unauthenticated'),
    },
  });

  const listLog = createRoute({
    method: 'get',
    path: '/me/food-log',
    tags: ['food-log'],
    middleware: [auth, consent] as const,
    request: { query: FoodLogQuerySchema },
    responses: {
      200: json('Items of the range', FoodLogResponseSchema),
      400: error('Invalid range (`from` after `to`, or more than 31 days)'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const putItem = createRoute({
    method: 'put',
    path: '/me/food-log/items/{id}',
    tags: ['food-log'],
    middleware: [auth, consent] as const,
    request: {
      params: MealItemIdParamSchema,
      body: { content: { 'application/json': { schema: MealItemUpsertRequestSchema } } },
    },
    responses: {
      200: json('The item stored after the write (AC20)', MealItemSaveResponseSchema),
      400: error('Invalid body, day or portion, or too many items that day'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      404: error('Unknown food'),
    },
  });

  const deleteItem = createRoute({
    method: 'delete',
    path: '/me/food-log/items/{id}',
    tags: ['food-log'],
    middleware: [auth, consent] as const,
    request: { params: MealItemIdParamSchema, query: MealItemDeleteQuerySchema },
    responses: {
      200: json('Deleted (also when it did not exist)', MealItemSaveResponseSchema),
      400: error('Invalid id or time'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const recents = createRoute({
    method: 'get',
    path: '/me/foods/recent',
    tags: ['food-log'],
    middleware: [auth, consent] as const,
    request: { query: FoodLocaleQuerySchema },
    responses: {
      200: json(
        'Foods logged most recently, with the portion used last (AC7)',
        RecentFoodsResponseSchema,
      ),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const favourites = createRoute({
    method: 'get',
    path: '/me/foods/favourites',
    tags: ['food-log'],
    middleware: [auth, consent] as const,
    request: { query: FoodLocaleQuerySchema },
    responses: {
      200: json('Starred foods, most recent first (AC14)', FavouriteFoodsResponseSchema),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const favouriteParams = { params: FavouriteFoodParamSchema };
  const favouriteResponses = {
    204: { description: 'Done (idempotent)' },
    400: error('Invalid food id'),
    401: error('Unauthenticated'),
    403: error('Consent required'),
    404: error('Unknown food'),
  };
  const putFavourite = createRoute({
    method: 'put',
    path: '/me/foods/favourites/{foodId}',
    tags: ['food-log'],
    middleware: [auth, consent] as const,
    request: favouriteParams,
    responses: favouriteResponses,
  });
  const deleteFavourite = createRoute({
    method: 'delete',
    path: '/me/foods/favourites/{foodId}',
    tags: ['food-log'],
    middleware: [auth, consent] as const,
    request: favouriteParams,
    responses: favouriteResponses,
  });

  return createRouter()
    .openapi(search, async (c) => {
      const { q, locale } = c.req.valid('query');
      const catalog = await getCatalog();
      const ids = searchFoods(catalog.index, q, locale, FOOD_LOG_LIMITS.searchResultsMax);
      const foods = ids.flatMap((id) => {
        const food = catalog.byId.get(id);
        return food ? [toFood(food, locale)] : [];
      });
      return c.json({ foods }, 200);
    })
    .openapi(sources, async (c) => {
      const { locale } = c.req.valid('query');
      const rows = await deps.store.listKnowledgeSources();
      return c.json(
        {
          sources: rows.map(({ attributionEs, attributionEn, ...source }) => ({
            ...source,
            attribution: locale === 'en' ? attributionEn : attributionEs,
          })),
        },
        200,
      );
    })
    .openapi(listLog, async (c) => {
      const { from, to } = c.req.valid('query');
      const invalid = checkFoodLogRange(from, to);
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      const items = await deps.store.listMealItems(c.var.user.userId, from, to);
      return c.json({ items }, 200);
    })
    .openapi(putItem, async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const { userId } = c.var.user;
      const invalid = checkFoodLogWrite(body, deps.now());
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      const catalogFood =
        body.kind === 'food' ? ((await getCatalog()).byId.get(body.foodId) ?? null) : null;
      const item = mealItemFromRequest(id, body, catalogFood && toFood(catalogFood, body.locale));
      if ('error' in item) {
        return item.error === 'food_not_found'
          ? apiError(c, 404, 'not_found', { foodId: 'not_found' })
          : apiError(c, 400, 'validation_error', { 'portion.servingId': 'not_found' });
      }
      const onDay = await deps.store.countMealItems(userId, body.localDate);
      if (onDay >= FOOD_LOG_LIMITS.itemsPerDayMax) {
        const existing = await deps.store.listMealItems(userId, body.localDate, body.localDate);
        if (!existing.some((i) => i.id === id)) {
          return apiError(c, 400, 'validation_error', { localDate: 'too_many_items' });
        }
      }
      return c.json({ item: await deps.store.upsertMealItem(userId, item) }, 200);
    })
    .openapi(deleteItem, async (c) => {
      const { id } = c.req.valid('param');
      const { recordedAt } = c.req.valid('query');
      if (Date.parse(recordedAt) > deps.now().getTime() + 24 * 60 * 60 * 1000) {
        return apiError(c, 400, 'validation_error', { recordedAt: 'in_future' });
      }
      await deps.store.deleteMealItem(c.var.user.userId, id, recordedAt);
      return c.json({ item: null }, 200);
    })
    .openapi(recents, async (c) => {
      const { locale } = c.req.valid('query');
      const since = addDays(deps.now().toISOString().slice(0, 10), -FOOD_LOG_LIMITS.recentsDays);
      const items = await deps.store.listRecentFoodItems(
        c.var.user.userId,
        since,
        FOOD_LOG_LIMITS.recentsMax,
      );
      return c.json({ recents: toRecentFoods(items, await getCatalog(), locale) }, 200);
    })
    .openapi(favourites, async (c) => {
      const { locale } = c.req.valid('query');
      const [ids, catalog] = await Promise.all([
        deps.store.listFavouriteFoodIds(c.var.user.userId),
        getCatalog(),
      ]);
      const foods = ids.flatMap((id) => {
        const food = catalog.byId.get(id);
        return food ? [toFood(food, locale)] : [];
      });
      return c.json({ foods }, 200);
    })
    .openapi(putFavourite, async (c) => {
      const { foodId } = c.req.valid('param');
      if (!(await getCatalog()).byId.has(foodId)) {
        return apiError(c, 404, 'not_found', { foodId: 'not_found' });
      }
      await deps.store.setFavouriteFood(c.var.user.userId, foodId, true, deps.now());
      return c.body(null, 204);
    })
    .openapi(deleteFavourite, async (c) => {
      const { foodId } = c.req.valid('param');
      await deps.store.setFavouriteFood(c.var.user.userId, foodId, false, deps.now());
      return c.body(null, 204);
    });
}
