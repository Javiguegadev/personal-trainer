import { createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  CHECKIN_LIMITS,
  CheckinDateParamSchema,
  CheckinDeleteQuerySchema,
  CheckinListQuerySchema,
  CheckinListResponseSchema,
  CheckinSaveResponseSchema,
  CheckinUpsertRequestSchema,
} from '@pt/contracts';
import { checkCheckinWrite, daysBetween } from '@pt/core';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});

/**
 * The daily check-in (spec 011). Every route needs the current consent: sleep and stress are health
 * data. The API stores the answers only; the readiness is computed on the device.
 */
export function checkinRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);
  const saved = {
    description:
      'The check-in stored for that day after the write (a newer one if it won), or null',
    content: { 'application/json': { schema: CheckinSaveResponseSchema } },
  };

  const listCheckins = createRoute({
    method: 'get',
    path: '/me/checkins',
    tags: ['checkins'],
    middleware: [auth, consent] as const,
    request: { query: CheckinListQuerySchema },
    responses: {
      200: {
        description: 'Check-ins of the range, oldest first, without deleted ones',
        content: { 'application/json': { schema: CheckinListResponseSchema } },
      },
      400: error('Invalid range (`from` after `to`, or more than 92 days)'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const putCheckin = createRoute({
    method: 'put',
    path: '/me/checkins/{localDate}',
    tags: ['checkins'],
    middleware: [auth, consent] as const,
    request: {
      params: CheckinDateParamSchema,
      body: { content: { 'application/json': { schema: CheckinUpsertRequestSchema } } },
    },
    responses: {
      200: saved,
      400: error(
        'Invalid body, a day in the future or more than a year back, or a device clock ahead',
      ),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const deleteCheckin = createRoute({
    method: 'delete',
    path: '/me/checkins/{localDate}',
    tags: ['checkins'],
    middleware: [auth, consent] as const,
    request: { params: CheckinDateParamSchema, query: CheckinDeleteQuerySchema },
    responses: {
      200: saved,
      400: error('A day in the future or more than a year back, or a device clock ahead'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  return createRouter()
    .openapi(listCheckins, async (c) => {
      const { from, to } = c.req.valid('query');
      if (from > to) return apiError(c, 400, 'validation_error', { from: 'after_to' });
      if (daysBetween(from, to) > CHECKIN_LIMITS.listDaysMax) {
        return apiError(c, 400, 'validation_error', { to: 'too_big' });
      }
      const checkins = await deps.store.listCheckins(c.var.user.userId, from, to);
      return c.json({ checkins }, 200);
    })
    .openapi(putCheckin, async (c) => {
      const { localDate } = c.req.valid('param');
      const { today, ...answers } = c.req.valid('json');
      const invalid = checkCheckinWrite(
        { localDate, today, recordedAt: answers.recordedAt },
        deps.now(),
      );
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      const checkin = await deps.store.upsertCheckin(c.var.user.userId, {
        localDate,
        ...answers,
        source: 'manual',
      });
      return c.json({ checkin }, 200);
    })
    .openapi(deleteCheckin, async (c) => {
      const { localDate } = c.req.valid('param');
      const { recordedAt, today } = c.req.valid('query');
      const invalid = checkCheckinWrite({ localDate, today, recordedAt }, deps.now());
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      const checkin = await deps.store.deleteCheckin(c.var.user.userId, localDate, recordedAt);
      return c.json({ checkin }, 200);
    });
}
