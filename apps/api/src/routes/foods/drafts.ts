import { createRoute } from '@hono/zod-openapi';
import { AiUnavailableError, type AiFeature, type MealInput } from '@pt/ai';
import {
  ApiErrorSchema,
  MealDraftResponseSchema,
  MealPhotoDraftRequestSchema,
  MealTextDraftRequestSchema,
  type Locale,
  type MealDraftResponse,
} from '@pt/contracts';
import { bodyLimit } from 'hono/body-limit';
import type { Deps } from '../../deps';
import { apiError, createRouter, errorBody } from '../../http';
import { IMAGE_BODY_MAX, checkImage } from '../../images';
import { withinDailyCap } from '../../services/entitlements';
import { requireAuth, requireConsent } from '../../middleware/auth';
import { createCatalogCache } from '../../services/foods';
import { createMealDrafter } from '../../services/meal-draft';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});
const draftResponses = {
  200: {
    description: 'The editable draft, or why the input gives none (AC4–AC6, AC10)',
    content: { 'application/json': { schema: MealDraftResponseSchema } },
  },
  400: error('Invalid body'),
  401: error('Unauthenticated'),
  403: error('Consent required'),
  429: error('`ai_cap_reached`: the daily limit of this shortcut (AC12)'),
  503: error('`ai_unavailable`: the model gave no usable draft (AC11)'),
};

/**
 * The plate photo and sentence shortcuts (spec 007): each returns an editable draft and writes nothing
 * to the log (the app saves the draft with `PUT /me/food-log/items/{id}`). Both need the current
 * consent. The photo and the sentence go to the model and nowhere else: they are not stored or logged
 * (AC16).
 */
export function draftRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);
  const draftMeal = createMealDrafter(deps, createCatalogCache(deps.store, deps.now));

  const text = createRoute({
    method: 'post',
    path: '/me/food-log/drafts/text',
    tags: ['food-log'],
    middleware: [auth, consent] as const,
    request: {
      body: { content: { 'application/json': { schema: MealTextDraftRequestSchema } } },
    },
    responses: draftResponses,
  });

  const photo = createRoute({
    method: 'post',
    path: '/me/food-log/drafts/photo',
    tags: ['food-log'],
    middleware: [
      auth,
      consent,
      bodyLimit({
        maxSize: IMAGE_BODY_MAX,
        onError: (c) => c.json(errorBody('image_too_large'), 413),
      }),
    ] as const,
    request: {
      body: { content: { 'application/json': { schema: MealPhotoDraftRequestSchema } } },
    },
    responses: { ...draftResponses, 413: error('`image_too_large`') },
  });

  /** Cap, model, metering (AC11, AC12). Every call writes one `ai_usage` row, failed ones too. */
  async function run(
    userId: string,
    feature: Extract<AiFeature, 'meal_text' | 'meal_photo'>,
    input: MealInput,
    locale: Locale,
  ): Promise<{ status: 'ok'; draft: MealDraftResponse } | { status: 'cap' | 'unavailable' }> {
    if (!(await withinDailyCap(deps, userId, feature))) return { status: 'cap' };
    try {
      const { draft, usage } = await draftMeal(userId, input, locale);
      await deps.store.recordAiUsage(userId, usage, deps.now());
      return { status: 'ok', draft };
    } catch (failure) {
      if (!(failure instanceof AiUnavailableError)) throw failure;
      await deps.store.recordAiUsage(userId, failure.usage, deps.now());
      return { status: 'unavailable' };
    }
  }

  return createRouter()
    .openapi(text, async (c) => {
      const { text: sentence, locale } = c.req.valid('json');
      const result = await run(
        c.var.user.userId,
        'meal_text',
        { kind: 'text', text: sentence },
        locale,
      );
      if (result.status === 'ok') return c.json(result.draft, 200);
      if (result.status === 'cap') return apiError(c, 429, 'ai_cap_reached');
      return apiError(c, 503, 'ai_unavailable');
    })
    .openapi(photo, async (c) => {
      const { image, locale } = c.req.valid('json');
      const bad = checkImage(image);
      if (bad === 'invalid') {
        return apiError(c, 400, 'validation_error', { 'image.data': 'invalid' });
      }
      if (bad === 'too_large') return apiError(c, 413, 'image_too_large');
      const result = await run(c.var.user.userId, 'meal_photo', { kind: 'photo', image }, locale);
      if (result.status === 'ok') return c.json(result.draft, 200);
      if (result.status === 'cap') return apiError(c, 429, 'ai_cap_reached');
      return apiError(c, 503, 'ai_unavailable');
    });
}
