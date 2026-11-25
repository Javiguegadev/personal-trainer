import { createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  FOOD_LOG_LIMITS,
  FavouriteFoodParamSchema,
  FavouriteFoodsResponseSchema,
  FoodLocaleQuerySchema,
  FoodLogQuerySchema,
  FoodIdParamSchema,
  FoodLogResponseSchema,
  FoodSchema,
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
  USER_FOOD_SOURCE,
} from '@pt/core';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';
import {
  createCatalogCache,
  resolveFoods,
  toFood,
  toRecentFoods,
  userSearchFoods,
} from '../../services/foods';

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
 * current consent, search included: the query says what the user eats. A food id may also be a scanned
 * product or one of the user's own foods (spec 006): those are read per request, never cached.
 */
export function foodRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);
  const getCatalog = createCatalogCache(deps.store, deps.now);
  /** A food the user may read: of the catalog, a scanned product or one of their own. */
  const findFood = async (userId: string, foodId: string) =>
    (await resolveFoods(deps.store, await getCatalog(), userId, [foodId])).get(foodId) ?? null;

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

  const getFood = createRoute({
    method: 'get',
    path: '/foods/{foodId}',
    tags: ['foods'],
    middleware: [auth, consent] as const,
    request: { params: FoodIdParamSchema, query: FoodLocaleQuerySchema },
    responses: {
      200: json('One catalog food, to edit a logged portion (AC11)', FoodSchema),
      400: error('Invalid food id'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      404: error('Unknown food'),
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
      404: error('Unknown food, or another user’s planned item'),
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

  return (
    createRouter()
      .openapi(search, async (c) => {
        const { q, locale } = c.req.valid('query');
        // The user's own foods and the products they logged rank with the catalog (spec 006 AC11).
        const [catalog, mine] = await Promise.all([
          getCatalog(),
          userSearchFoods(deps.store, c.var.user.userId),
        ]);
        const ids = searchFoods(
          catalog.index,
          q,
          locale,
          FOOD_LOG_LIMITS.searchResultsMax,
          mine.index,
        );
        const foods = ids.flatMap((id) => {
          const food = mine.byId.get(id) ?? catalog.byId.get(id);
          return food ? [toFood(food, locale)] : [];
        });
        return c.json({ foods }, 200);
      })
      .openapi(sources, async (c) => {
        const { locale } = c.req.valid('query');
        const rows = await deps.store.listKnowledgeSources();
        return c.json(
          {
            // The source of the user's own foods is a technical row, not a source of data.
            sources: rows
              .filter((source) => source.id !== USER_FOOD_SOURCE)
              .map(({ attributionEs, attributionEn, ...source }) => ({
                ...source,
                attribution: locale === 'en' ? attributionEn : attributionEs,
              })),
          },
          200,
        );
      })
      // After the fixed `/foods/*` paths, so they are never read as an id.
      .openapi(getFood, async (c) => {
        const { foodId } = c.req.valid('param');
        const { locale } = c.req.valid('query');
        const food = await findFood(c.var.user.userId, foodId);
        if (!food) return apiError(c, 404, 'not_found', { foodId: 'not_found' });
        return c.json(toFood(food, locale), 200);
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
        // Another user's own food is not found: an item cannot point to it (spec 006 AC13).
        const catalogFood = body.kind === 'food' ? await findFood(userId, body.foodId) : null;
        const item = mealItemFromRequest(id, body, catalogFood && toFood(catalogFood, body.locale));
        if ('error' in item) {
          return item.error === 'food_not_found'
            ? apiError(c, 404, 'not_found', { foodId: 'not_found' })
            : apiError(c, 400, 'validation_error', { 'portion.servingId': 'not_found' });
        }
        if (item.plannedItemId !== null) {
          const owner = await deps.store.plannedItemOwner(userId, item.plannedItemId);
          if (owner === 'other') {
            return apiError(c, 404, 'not_found', { plannedItemId: 'not_found' });
          }
          // A planned item that never reached the API: the item is stored without the link, so the
          // queue never gets stuck (spec 013 AC23).
          if (owner === 'missing') item.plannedItemId = null;
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
        const foods = await resolveFoods(
          deps.store,
          await getCatalog(),
          c.var.user.userId,
          items.flatMap((i) => (i.foodId ? [i.foodId] : [])),
        );
        return c.json({ recents: toRecentFoods(items, foods, locale) }, 200);
      })
      .openapi(favourites, async (c) => {
        const { locale } = c.req.valid('query');
        const { userId } = c.var.user;
        const [ids, catalog] = await Promise.all([
          deps.store.listFavouriteFoodIds(userId),
          getCatalog(),
        ]);
        const byId = await resolveFoods(deps.store, catalog, userId, ids);
        const foods = ids.flatMap((id) => {
          const food = byId.get(id);
          return food ? [toFood(food, locale)] : [];
        });
        return c.json({ foods }, 200);
      })
      .openapi(putFavourite, async (c) => {
        const { foodId } = c.req.valid('param');
        if (!(await findFood(c.var.user.userId, foodId))) {
          return apiError(c, 404, 'not_found', { foodId: 'not_found' });
        }
        await deps.store.setFavouriteFood(c.var.user.userId, foodId, true, deps.now());
        return c.body(null, 204);
      })
      .openapi(deleteFavourite, async (c) => {
        const { foodId } = c.req.valid('param');
        await deps.store.setFavouriteFood(c.var.user.userId, foodId, false, deps.now());
        return c.body(null, 204);
      })
  );
}
