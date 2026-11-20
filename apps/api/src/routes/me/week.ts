import { createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  MeResponseSchema,
  TrainingProfileUpdateSchema,
  WeekRequestSchema,
} from '@pt/contracts';
import { checkClientDates } from '@pt/core';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';
import { toMeResponse } from '../../services/profile';
import { saveWeek } from '../../services/week';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});
const me = (description: string) => ({
  description,
  content: { 'application/json': { schema: MeResponseSchema } },
});

/**
 * "Mi semana" and the routine wizard's answers (spec 010). Work hours and training days are health
 * data in the consent text (AC23), so both routes need the current consent.
 */
export function weekRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);

  const putWeek = createRoute({
    method: 'put',
    path: '/me/week',
    tags: ['me'],
    middleware: [auth, consent] as const,
    request: { body: { content: { 'application/json': { schema: WeekRequestSchema } } } },
    responses: {
      200: me('The week stored, with new targets when the training load changed (AC4)'),
      400: error('Invalid body or day, or no profile yet'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      422: error('Under 16 (`age_blocked`): nothing is stored'),
    },
  });

  const putTrainingProfile = createRoute({
    method: 'put',
    path: '/me/training-profile',
    tags: ['me'],
    middleware: [auth, consent] as const,
    request: {
      body: { content: { 'application/json': { schema: TrainingProfileUpdateSchema } } },
    },
    responses: {
      200: me('Experience and equipment stored (AC14)'),
      400: error('Invalid body, or no profile yet'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  return createRouter()
    .openapi(putWeek, async (c) => {
      const body = c.req.valid('json');
      const invalid = checkClientDates({ today: body.today }, deps.now());
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      const result = await saveWeek(deps, c.var.user.userId, body);
      if (result === 'no_profile') {
        return apiError(c, 400, 'validation_error', { profile: 'required' });
      }
      if (result === 'blocked') return apiError(c, 422, 'age_blocked');
      return c.json(result, 200);
    })
    .openapi(putTrainingProfile, async (c) => {
      const { userId } = c.var.user;
      const saved = await deps.store.saveTrainingProfile(userId, c.req.valid('json'), deps.now());
      if (!saved) return apiError(c, 400, 'validation_error', { profile: 'required' });
      return c.json(toMeResponse(userId, await deps.store.getMe(userId)), 200);
    });
}
