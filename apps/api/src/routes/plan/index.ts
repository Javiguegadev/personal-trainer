import { createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  PlanMealChangesRequestSchema,
  PlanMealChangesResponseSchema,
  PlanQuerySchema,
  PlanResponseSchema,
  PlanWorkoutChangesRequestSchema,
  PlanWorkoutChangesResponseSchema,
} from '@pt/contracts';
import { checkPlanRange } from '@pt/core';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';
import { createCatalogCache } from '../../services/foods';
import { savePlanMealChanges, savePlanWorkoutChanges } from '../../services/plan';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});
const json = <T>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});

/**
 * The weekly planner (spec 013): meals and sessions planned by hand. Every route needs the current
 * consent (plans are a data category of their own, AC24). Writes are bulk, one route per queue scope:
 * planned meals with the food log, planned sessions with the workouts (AC22).
 */
export function planRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);
  const getCatalog = createCatalogCache(deps.store, deps.now);

  const getPlan = createRoute({
    method: 'get',
    path: '/me/plan',
    tags: ['plan'],
    middleware: [auth, consent] as const,
    request: { query: PlanQuerySchema },
    responses: {
      200: json('The live planned items and sessions of the range', PlanResponseSchema),
      400: error('Invalid range (`from` after `to`, or more than 63 days)'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const postMealItems = createRoute({
    method: 'post',
    path: '/me/plan/meal-items',
    tags: ['plan'],
    middleware: [auth, consent] as const,
    request: {
      body: { content: { 'application/json': { schema: PlanMealChangesRequestSchema } } },
    },
    responses: {
      200: json(
        'The stored items after the write (newer ones where another write won)',
        PlanMealChangesResponseSchema,
      ),
      400: error('Invalid body, a date out of range, a bad portion, or too many items that day'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      404: error('Unknown food or serving, or another user’s food'),
      409: error('An id of another user'),
    },
  });

  const postWorkouts = createRoute({
    method: 'post',
    path: '/me/plan/workouts',
    tags: ['plan'],
    middleware: [auth, consent] as const,
    request: {
      body: { content: { 'application/json': { schema: PlanWorkoutChangesRequestSchema } } },
    },
    responses: {
      200: json(
        'The stored sessions after the write (newer ones where another write won)',
        PlanWorkoutChangesResponseSchema,
      ),
      400: error('Invalid body, a date out of range, or too many sessions that day'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      404: error('Another user’s routine session or workout'),
      409: error('An id of another user'),
    },
  });

  return createRouter()
    .openapi(getPlan, async (c) => {
      const { from, to } = c.req.valid('query');
      const invalid = checkPlanRange(from, to);
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      return c.json(await deps.store.listPlan(c.var.user.userId, from, to), 200);
    })
    .openapi(postMealItems, async (c) => {
      const result = await savePlanMealChanges(
        deps,
        await getCatalog(),
        c.var.user.userId,
        c.req.valid('json'),
      );
      if (!result.ok) {
        const { status, code, fields } = result.failure;
        return apiError(c, status, code, fields);
      }
      return c.json({ mealItems: result.value }, 200);
    })
    .openapi(postWorkouts, async (c) => {
      const result = await savePlanWorkoutChanges(deps, c.var.user.userId, c.req.valid('json'));
      if (!result.ok) {
        const { status, code, fields } = result.failure;
        return apiError(c, status, code, fields);
      }
      return c.json({ workouts: result.value }, 200);
    });
}
