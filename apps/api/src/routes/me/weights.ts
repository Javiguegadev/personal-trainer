import { createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  WEIGHT_LIMITS,
  WeightDateParamSchema,
  WeightDeleteQuerySchema,
  WeightListQuerySchema,
  WeightListResponseSchema,
  WeightSaveResponseSchema,
  WeightUpsertRequestSchema,
} from '@pt/contracts';
import { checkWeightWrite, daysBetween } from '@pt/core';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';
import { writeWeight } from '../../services/weights';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});

/** The weight log (spec 003). Every route needs the current consent: weight is health data. */
export function weightRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);
  const saved = {
    description:
      'The entry stored for that day and, when they changed, the targets before and after',
    content: { 'application/json': { schema: WeightSaveResponseSchema } },
  };

  const listWeights = createRoute({
    method: 'get',
    path: '/me/weights',
    tags: ['weights'],
    middleware: [auth, consent] as const,
    request: { query: WeightListQuerySchema },
    responses: {
      200: {
        description: 'Entries of the range, oldest first',
        content: { 'application/json': { schema: WeightListResponseSchema } },
      },
      400: error('Invalid range (`from` after `to`, or more than 366 days)'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const putWeight = createRoute({
    method: 'put',
    path: '/me/weights/{localDate}',
    tags: ['weights'],
    middleware: [auth, consent] as const,
    request: {
      params: WeightDateParamSchema,
      body: { content: { 'application/json': { schema: WeightUpsertRequestSchema } } },
    },
    responses: {
      200: saved,
      400: error('Invalid body or day, or no profile yet'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const deleteWeight = createRoute({
    method: 'delete',
    path: '/me/weights/{localDate}',
    tags: ['weights'],
    middleware: [auth, consent] as const,
    request: { params: WeightDateParamSchema, query: WeightDeleteQuerySchema },
    responses: {
      200: saved,
      400: error('Invalid day, or no profile yet'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  return createRouter()
    .openapi(listWeights, async (c) => {
      const { from, to } = c.req.valid('query');
      if (from > to) return apiError(c, 400, 'validation_error', { from: 'after_to' });
      if (daysBetween(from, to) > WEIGHT_LIMITS.listDaysMax) {
        return apiError(c, 400, 'validation_error', { to: 'too_big' });
      }
      const entries = await deps.store.listWeights(c.var.user.userId, from, to);
      return c.json({ entries }, 200);
    })
    .openapi(putWeight, async (c) => {
      const { localDate } = c.req.valid('param');
      const body = c.req.valid('json');
      const invalid = checkWeightWrite({ localDate, ...body }, deps.now());
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      const result = await writeWeight(
        deps,
        c.var.user.userId,
        { localDate, entry: { weightKg: body.weightKg, recordedAt: body.recordedAt } },
        body.today,
      );
      if (!result) return apiError(c, 400, 'validation_error', { profile: 'required' });
      return c.json(result, 200);
    })
    .openapi(deleteWeight, async (c) => {
      const { localDate } = c.req.valid('param');
      const query = c.req.valid('query');
      const invalid = checkWeightWrite({ localDate, today: query.today }, deps.now());
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      const result = await writeWeight(
        deps,
        c.var.user.userId,
        { localDate, entry: null },
        query.today,
      );
      if (!result) return apiError(c, 400, 'validation_error', { profile: 'required' });
      return c.json(result, 200);
    });
}
