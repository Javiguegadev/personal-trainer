import { createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  ProgramDeleteQuerySchema,
  ProgramIdParamSchema,
  ProgramResponseSchema,
  ProgramUpsertRequestSchema,
} from '@pt/contracts';
import { programFromRequest } from '@pt/core';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';
import { loggableExercises } from '../../services/training';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});
const json = (description: string) => ({
  description,
  content: { 'application/json': { schema: ProgramResponseSchema } },
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The user's routine (spec 010 AC16–AC22): one active routine, replaced as a whole, last write wins by
 * device time, deleted as a tombstone. What a user trains is health data: every route needs consent.
 */
export function programRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);
  /** A device clock more than a day ahead of the server is rejected (same rule as the workout log). */
  const inFuture = (recordedAt: string) => Date.parse(recordedAt) > deps.now().getTime() + DAY_MS;

  const getProgram = createRoute({
    method: 'get',
    path: '/me/program',
    tags: ['training'],
    middleware: [auth, consent] as const,
    responses: {
      200: json('The active routine, or null'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const putProgram = createRoute({
    method: 'put',
    path: '/me/program/{id}',
    tags: ['training'],
    middleware: [auth, consent] as const,
    request: {
      params: ProgramIdParamSchema,
      body: { content: { 'application/json': { schema: ProgramUpsertRequestSchema } } },
    },
    responses: {
      200: json('The routine stored after the write, or the newer one that won (AC22)'),
      400: error('Invalid body, a target its exercise cannot use, or a device clock ahead'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      404: error('Unknown exercise, or another user’s'),
      409: error(
        'Another routine is active (`program_exists`), or an id is another user’s (`id_taken`)',
      ),
    },
  });

  const deleteProgram = createRoute({
    method: 'delete',
    path: '/me/program/{id}',
    tags: ['training'],
    middleware: [auth, consent] as const,
    request: { params: ProgramIdParamSchema, query: ProgramDeleteQuerySchema },
    responses: {
      200: json('Deleted (also when it did not exist); past workouts keep their sets'),
      400: error('Invalid id or time'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  return createRouter()
    .openapi(getProgram, async (c) => {
      return c.json({ program: await deps.store.getProgram(c.var.user.userId) }, 200);
    })
    .openapi(putProgram, async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const { userId } = c.var.user;
      if (inFuture(body.recordedAt)) {
        return apiError(c, 400, 'validation_error', { recordedAt: 'in_future' });
      }
      const ids = body.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId));
      const program = programFromRequest(
        id,
        body,
        await loggableExercises(deps.store, userId, ids),
      );
      if ('error' in program) {
        // Another user's custom exercise is not found: a routine cannot point to it.
        if (program.error === 'exercise_not_found') {
          return apiError(c, 404, 'not_found', { exerciseId: 'not_found' });
        }
        return apiError(c, 400, 'validation_error', {
          [`sessions.${program.sessionIndex}.exercises.${program.exerciseIndex}`]:
            'target_mismatch',
        });
      }
      const saved = await deps.store.upsertProgram(userId, program);
      if (saved === 'id_taken') return apiError(c, 409, 'id_taken', { id: 'taken' });
      if (saved === 'program_exists') return apiError(c, 409, 'program_exists');
      return c.json({ program: saved }, 200);
    })
    .openapi(deleteProgram, async (c) => {
      const { id } = c.req.valid('param');
      const { recordedAt } = c.req.valid('query');
      if (inFuture(recordedAt)) {
        return apiError(c, 400, 'validation_error', { recordedAt: 'in_future' });
      }
      await deps.store.deleteProgram(c.var.user.userId, id, recordedAt);
      return c.json({ program: null }, 200);
    });
}
