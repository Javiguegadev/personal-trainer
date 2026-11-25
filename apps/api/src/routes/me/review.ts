import { createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  CalibrationResetResponseSchema,
  ReviewDecisionRequestSchema,
  ReviewDecisionResponseSchema,
  ReviewQuerySchema,
  ReviewResponseSchema,
  ReviewWeekParamSchema,
} from '@pt/contracts';
import { checkClientDates, weekStartOf } from '@pt/core';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';
import { decideReview, getReview, resetCalibration } from '../../services/review';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});

/**
 * The weekly review, the streak and the energy calibration (spec 014). Every route needs the current
 * consent: they read and change health data. "Aplicar" and the reset need a connection in the app
 * (AC15): they recompute the targets here.
 */
export function reviewRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);

  const getReviewRoute = createRoute({
    method: 'get',
    path: '/me/review',
    tags: ['review'],
    middleware: [auth, consent] as const,
    request: { query: ReviewQuerySchema },
    responses: {
      200: {
        description:
          'The review of the last complete week (stored on its first read), the reviews before it and the streak',
        content: { 'application/json': { schema: ReviewResponseSchema } },
      },
      400: error('A `today` far from the server date'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const postDecision = createRoute({
    method: 'post',
    path: '/me/review/{weekStart}/decision',
    tags: ['review'],
    middleware: [auth, consent] as const,
    request: {
      params: ReviewWeekParamSchema,
      body: { content: { 'application/json': { schema: ReviewDecisionRequestSchema } } },
    },
    responses: {
      200: {
        description: 'The decided review and the current targets (new ones after "Aplicar")',
        content: { 'application/json': { schema: ReviewDecisionResponseSchema } },
      },
      400: error('Invalid body, a `weekStart` that is not a Monday, or no profile'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      404: error('No review of that week'),
      409: error(
        '`review_decided`: decided already; `review_stale`: a newer review, or no longer valid',
      ),
    },
  });

  const deleteCalibration = createRoute({
    method: 'delete',
    path: '/me/energy-calibration',
    tags: ['review'],
    middleware: [auth, consent] as const,
    request: { query: ReviewQuerySchema },
    responses: {
      200: {
        description: 'The calibration back to 0 and the targets computed again',
        content: { 'application/json': { schema: CalibrationResetResponseSchema } },
      },
      400: error('A `today` far from the server date, or no profile'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  return createRouter()
    .openapi(getReviewRoute, async (c) => {
      const { today } = c.req.valid('query');
      const invalid = checkClientDates({ today }, deps.now());
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      return c.json(await getReview(deps, c.var.user.userId, today), 200);
    })
    .openapi(postDecision, async (c) => {
      const { weekStart } = c.req.valid('param');
      const body = c.req.valid('json');
      if (weekStartOf(weekStart) !== weekStart) {
        return apiError(c, 400, 'validation_error', { weekStart: 'not_monday' });
      }
      const invalid = checkClientDates({ today: body.today }, deps.now());
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      const result = await decideReview(deps, c.var.user.userId, weekStart, body);
      if (result === 'no_profile') {
        return apiError(c, 400, 'validation_error', { profile: 'required' });
      }
      if (result === 'not_found') return apiError(c, 404, 'not_found');
      if (result === 'decided') return apiError(c, 409, 'review_decided');
      if (result === 'stale') return apiError(c, 409, 'review_stale');
      return c.json(result, 200);
    })
    .openapi(deleteCalibration, async (c) => {
      const { today } = c.req.valid('query');
      const invalid = checkClientDates({ today }, deps.now());
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      const result = await resetCalibration(deps, c.var.user.userId, today);
      if (result === 'no_profile') {
        return apiError(c, 400, 'validation_error', { profile: 'required' });
      }
      return c.json(result, 200);
    });
}
