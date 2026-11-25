import { createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  CustomExerciseDeleteQuerySchema,
  CustomExerciseSaveResponseSchema,
  CustomExerciseUpsertRequestSchema,
  ExerciseCatalogResponseSchema,
  ExerciseHistoryQuerySchema,
  ExerciseHistoryResponseSchema,
  ExerciseIdParamSchema,
  ExerciseStatsResponseSchema,
  WORKOUT_LIMITS,
  WorkoutDeleteQuerySchema,
  WorkoutIdParamSchema,
  WorkoutLogQuerySchema,
  WorkoutLogResponseSchema,
  WorkoutSaveResponseSchema,
  WorkoutUpsertRequestSchema,
} from '@pt/contracts';
import {
  buildExerciseStats,
  checkWorkoutRange,
  checkWorkoutWrite,
  exerciseHistory,
  workoutFromRequest,
} from '@pt/core';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';
import { createExerciseCatalogCache, loggableExercises } from '../../services/training';
import { workoutDraftRoutes } from './drafts';
import { programRoutes } from './program';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});
const json = <T>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Exercise catalog, custom exercises, workout log and exercise stats (spec 009). Every route needs the
 * current consent: what a user trains is health data, and so is the list of their own exercises.
 */
export function trainingRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);
  const getCatalog = createExerciseCatalogCache(deps.store, deps.now);
  /** A device clock more than a day ahead of the server is rejected (same rule as the food log). */
  const inFuture = (recordedAt: string) => Date.parse(recordedAt) > deps.now().getTime() + DAY_MS;

  const catalog = createRoute({
    method: 'get',
    path: '/exercises',
    tags: ['training'],
    middleware: [auth, consent] as const,
    responses: {
      200: json(
        'The catalog and the user’s own exercises (AC3, AC22)',
        ExerciseCatalogResponseSchema,
      ),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const putExercise = createRoute({
    method: 'put',
    path: '/me/exercises/{id}',
    tags: ['training'],
    middleware: [auth, consent] as const,
    request: {
      params: ExerciseIdParamSchema,
      body: { content: { 'application/json': { schema: CustomExerciseUpsertRequestSchema } } },
    },
    responses: {
      200: json(
        'The exercise stored after the write (idempotent)',
        CustomExerciseSaveResponseSchema,
      ),
      400: error('Invalid body, a device clock ahead, or `exercise_limit_reached`'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      409: error('The id is a catalog exercise or another user’s (`id_taken`)'),
    },
  });

  const deleteExercise = createRoute({
    method: 'delete',
    path: '/me/exercises/{id}',
    tags: ['training'],
    middleware: [auth, consent] as const,
    request: { params: ExerciseIdParamSchema, query: CustomExerciseDeleteQuerySchema },
    responses: {
      200: json(
        'Deleted (also when it did not exist); past sets keep their label',
        CustomExerciseSaveResponseSchema,
      ),
      400: error('Invalid id or time'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const stats = createRoute({
    method: 'get',
    path: '/me/exercises/stats',
    tags: ['training'],
    middleware: [auth, consent] as const,
    responses: {
      200: json(
        'Last session, bests and last rest of every exercise done (AC7, AC9, AC10, AC14)',
        ExerciseStatsResponseSchema,
      ),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const history = createRoute({
    method: 'get',
    path: '/me/exercises/{id}/history',
    tags: ['training'],
    middleware: [auth, consent] as const,
    request: { params: ExerciseIdParamSchema, query: ExerciseHistoryQuerySchema },
    responses: {
      200: json(
        'The last sessions and the bests of one exercise (AC15)',
        ExerciseHistoryResponseSchema,
      ),
      400: error('Invalid id or limit'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      404: error('Unknown exercise, or another user’s'),
    },
  });

  const listWorkouts = createRoute({
    method: 'get',
    path: '/me/workouts',
    tags: ['training'],
    middleware: [auth, consent] as const,
    request: { query: WorkoutLogQuerySchema },
    responses: {
      200: json('Workouts of the range, newest first', WorkoutLogResponseSchema),
      400: error('Invalid range (`from` after `to`, or more than 62 days)'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const putWorkout = createRoute({
    method: 'put',
    path: '/me/workouts/{id}',
    tags: ['training'],
    middleware: [auth, consent] as const,
    request: {
      params: WorkoutIdParamSchema,
      body: { content: { 'application/json': { schema: WorkoutUpsertRequestSchema } } },
    },
    responses: {
      200: json('The workout stored after the write (AC23)', WorkoutSaveResponseSchema),
      400: error('Invalid body, day or set values, or too many workouts that day'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      404: error(
        'Unknown exercise, or another user’s exercise, routine session or planned session',
      ),
    },
  });

  const deleteWorkout = createRoute({
    method: 'delete',
    path: '/me/workouts/{id}',
    tags: ['training'],
    middleware: [auth, consent] as const,
    request: { params: WorkoutIdParamSchema, query: WorkoutDeleteQuerySchema },
    responses: {
      200: json('Deleted (also when it did not exist)', WorkoutSaveResponseSchema),
      400: error('Invalid id or time'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  return createRouter()
    .openapi(catalog, async (c) => {
      const [{ exercises, version }, own] = await Promise.all([
        getCatalog(),
        deps.store.listCustomExercises(c.var.user.userId),
      ]);
      return c.json({ version, exercises: [...exercises, ...own] }, 200);
    })
    .openapi(putExercise, async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const { userId } = c.var.user;
      if (inFuture(body.recordedAt)) {
        return apiError(c, 400, 'validation_error', { recordedAt: 'in_future' });
      }
      const own = await deps.store.listCustomExercises(userId);
      if (own.length >= WORKOUT_LIMITS.customExercisesMax && !own.some((e) => e.id === id)) {
        return apiError(c, 400, 'exercise_limit_reached');
      }
      const saved = await deps.store.upsertCustomExercise(userId, id, body);
      if (saved === 'id_taken') return apiError(c, 409, 'id_taken', { id: 'taken' });
      return c.json({ exercise: saved }, 200);
    })
    .openapi(deleteExercise, async (c) => {
      const { id } = c.req.valid('param');
      const { recordedAt } = c.req.valid('query');
      if (inFuture(recordedAt)) {
        return apiError(c, 400, 'validation_error', { recordedAt: 'in_future' });
      }
      await deps.store.deleteCustomExercise(c.var.user.userId, id, recordedAt);
      return c.json({ exercise: null }, 200);
    })
    .openapi(stats, async (c) => {
      const rows = await deps.store.listExerciseSetRows(c.var.user.userId);
      return c.json({ stats: buildExerciseStats(rows) }, 200);
    })
    .openapi(history, async (c) => {
      const { id } = c.req.valid('param');
      const { limit } = c.req.valid('query');
      const { userId } = c.var.user;
      const [exercise] = await deps.store.getLoggableExercises(userId, [id]);
      if (!exercise) return apiError(c, 404, 'not_found', { id: 'not_found' });
      const rows = await deps.store.listExerciseSetRows(userId, id);
      return c.json(exerciseHistory(id, rows, limit), 200);
    })
    .openapi(listWorkouts, async (c) => {
      const { from, to } = c.req.valid('query');
      const invalid = checkWorkoutRange(from, to);
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      return c.json({ workouts: await deps.store.listWorkouts(c.var.user.userId, from, to) }, 200);
    })
    .openapi(putWorkout, async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const { userId } = c.var.user;
      const invalid = checkWorkoutWrite(body, deps.now());
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      const ids = body.kind === 'gym' ? body.exercises.map((e) => e.exerciseId) : [];
      const workout = workoutFromRequest(
        id,
        body,
        await loggableExercises(deps.store, userId, ids),
      );
      if ('error' in workout) {
        // Another user's custom exercise is not found: a set cannot point to it.
        if (workout.error === 'exercise_not_found') {
          return apiError(c, 404, 'not_found', { exerciseId: 'not_found' });
        }
        const index = ids.indexOf(workout.exerciseId);
        return apiError(c, 400, 'validation_error', {
          [`exercises.${index}.sets.${workout.setNumber - 1}`]: 'set_mismatch',
        });
      }
      const ofDay = await deps.store.listWorkoutIdsOfDay(userId, body.localDate);
      if (ofDay.length >= WORKOUT_LIMITS.workoutsPerDayMax && !ofDay.includes(id)) {
        return apiError(c, 400, 'validation_error', { localDate: 'too_many_workouts' });
      }
      if (workout.programSessionId !== null) {
        const owner = await deps.store.programSessionOwner(userId, workout.programSessionId);
        if (owner === 'other') {
          return apiError(c, 404, 'not_found', { programSessionId: 'not_found' });
        }
        // A session removed from the routine before this write arrived (a queued workout): the
        // workout keeps its sets and loses the link, as when the session is removed later (AC22).
        if (owner === 'missing') workout.programSessionId = null;
      }
      if (workout.plannedWorkoutId !== null) {
        const owner = await deps.store.plannedWorkoutOwner(userId, workout.plannedWorkoutId);
        if (owner === 'other') {
          return apiError(c, 404, 'not_found', { plannedWorkoutId: 'not_found' });
        }
        // A planned session that never reached the API: stored without the link (spec 013 AC23).
        if (owner === 'missing') workout.plannedWorkoutId = null;
      }
      return c.json({ workout: await deps.store.upsertWorkout(userId, workout) }, 200);
    })
    .openapi(deleteWorkout, async (c) => {
      const { id } = c.req.valid('param');
      const { recordedAt } = c.req.valid('query');
      if (inFuture(recordedAt)) {
        return apiError(c, 400, 'validation_error', { recordedAt: 'in_future' });
      }
      await deps.store.deleteWorkout(c.var.user.userId, id, recordedAt);
      return c.json({ workout: null }, 200);
    })
    .route('/', programRoutes(deps))
    .route('/', workoutDraftRoutes(deps, getCatalog));
}
