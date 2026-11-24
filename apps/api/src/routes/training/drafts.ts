import { createRoute } from '@hono/zod-openapi';
import { AiUnavailableError } from '@pt/ai';
import {
  ApiErrorSchema,
  WORKOUT_DRAFT_LIMITS,
  WORKOUT_LIMITS,
  WorkoutDraftResponseSchema,
  WorkoutTextDraftRequestSchema,
} from '@pt/contracts';
import { addDays, checkClientDates } from '@pt/core';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { utcDayStart } from '../../images';
import { requireAuth, requireConsent } from '../../middleware/auth';
import type { ExerciseCatalog } from '../../services/training';
import { createWorkoutDrafter } from '../../services/workout-draft';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});

/**
 * The workout sentence shortcut (spec 012): returns an editable draft and writes nothing to the log
 * (the app saves it with `PUT /me/workouts/{id}`). Needs the current consent. The sentence goes to
 * the model and nowhere else: it is not stored or logged, nor in `ai_usage` (AC20).
 */
export function workoutDraftRoutes(deps: Deps, getCatalog: () => Promise<ExerciseCatalog>) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);
  const draftWorkout = createWorkoutDrafter(deps, getCatalog);

  const text = createRoute({
    method: 'post',
    path: '/me/workouts/drafts/text',
    tags: ['training'],
    middleware: [auth, consent] as const,
    request: {
      body: { content: { 'application/json': { schema: WorkoutTextDraftRequestSchema } } },
    },
    responses: {
      200: {
        description: 'The editable draft, or why the sentence gives none (AC3–AC9)',
        content: { 'application/json': { schema: WorkoutDraftResponseSchema } },
      },
      400: error('Invalid body, or `today` / `localDate` out of range'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      429: error('`ai_cap_reached`: 20 sentences per UTC day (AC17)'),
      503: error('`ai_unavailable`: the model gave no usable draft (AC16)'),
    },
  });

  return createRouter().openapi(text, async (c) => {
    const request = c.req.valid('json');
    const userId = c.var.user.userId;
    const invalid = checkClientDates({ today: request.today }, deps.now());
    if (invalid) return apiError(c, 400, 'validation_error', invalid);
    if (
      request.localDate > request.today ||
      request.localDate < addDays(request.today, -WORKOUT_LIMITS.pastDaysUi)
    ) {
      return apiError(c, 400, 'validation_error', { localDate: 'out_of_range' });
    }

    // Cap and metering (AC17): every call writes one `ai_usage` row, failed ones too.
    const used = await deps.store.countAiUsage(userId, 'workout_text', utcDayStart(deps.now()));
    if (used >= WORKOUT_DRAFT_LIMITS.textsPerDay) return apiError(c, 429, 'ai_cap_reached');
    try {
      const { draft, usage } = await draftWorkout(userId, request);
      await deps.store.recordAiUsage(userId, usage, deps.now());
      return c.json(draft, 200);
    } catch (failure) {
      if (!(failure instanceof AiUnavailableError)) throw failure;
      await deps.store.recordAiUsage(userId, failure.usage, deps.now());
      return apiError(c, 503, 'ai_unavailable');
    }
  });
}
