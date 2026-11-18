import { createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  DailyFeedbackRequestSchema,
  DailyFeedbackResponseSchema,
  FEEDBACK_LIMITS,
} from '@pt/contracts';
import { daysBetween, isPlausibleClientDate } from '@pt/core';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';
import { createFeedbackService } from '../../services/feedback';
import { createCatalogCache } from '../../services/foods';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});

/**
 * The daily feedback (spec 008): a few notes on one day of the food log, on request. It writes nothing
 * besides the `ai_usage` row of the AI call. There is no 429 or 503: past the daily cap or when the AI
 * fails, the notes use the fixed wording (AC15).
 */
export function feedbackRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);
  const dailyFeedback = createFeedbackService(deps, createCatalogCache(deps.store, deps.now));

  const post = createRoute({
    method: 'post',
    path: '/me/food-log/feedback',
    tags: ['food-log'],
    middleware: [auth, consent] as const,
    request: {
      body: { content: { 'application/json': { schema: DailyFeedbackRequestSchema } } },
    },
    responses: {
      200: {
        description: 'The notes on the day, worded by the AI or with the fixed wording (AC13–AC15)',
        content: { 'application/json': { schema: DailyFeedbackResponseSchema } },
      },
      400: error('Invalid body, or a day in the future or more than 6 days back'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      422: error('`feedback_unavailable`: `ed_soft_stop` or no numeric targets (AC2)'),
    },
  });

  return createRouter().openapi(post, async (c) => {
    const body = c.req.valid('json');
    if (!isPlausibleClientDate(body.today, deps.now().toISOString())) {
      return apiError(c, 400, 'validation_error', { today: 'implausible' });
    }
    const back = daysBetween(body.localDate, body.today);
    if (back < 0) return apiError(c, 400, 'validation_error', { localDate: 'in_future' });
    if (back > FEEDBACK_LIMITS.daysBack) {
      return apiError(c, 400, 'validation_error', { localDate: 'too_old' });
    }
    const result = await dailyFeedback(c.var.user.userId, body);
    if (result === 'unavailable') return apiError(c, 422, 'feedback_unavailable');
    return c.json(result, 200);
  });
}
