import { createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  OnboardingChatRequestSchema,
  OnboardingChatResponseSchema,
  ProfileInputSchema,
  TargetsPreviewResponseSchema,
} from '@pt/contracts';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';
import { onboardingChat } from '../../services/onboarding';
import { checkClientDates, evaluateProfileInput } from '../../services/profile';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});

export function onboardingRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);

  const chat = createRoute({
    method: 'post',
    path: '/onboarding/chat',
    tags: ['onboarding'],
    middleware: [auth, consent] as const,
    request: {
      body: { content: { 'application/json': { schema: OnboardingChatRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Assistant reply and the updated draft (nothing is stored)',
        content: { 'application/json': { schema: OnboardingChatResponseSchema } },
      },
      400: error('Invalid body'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      429: error('More than 40 onboarding messages in 24 h: use the form'),
      503: error('AI unavailable: use the form'),
    },
  });

  const targetsPreview = createRoute({
    method: 'post',
    path: '/onboarding/targets-preview',
    tags: ['onboarding'],
    middleware: [auth, consent] as const,
    request: { body: { content: { 'application/json': { schema: ProfileInputSchema } } } },
    responses: {
      200: {
        description: 'Targets and applied safety rules (nothing is stored)',
        content: { 'application/json': { schema: TargetsPreviewResponseSchema } },
      },
      400: error('Invalid body'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      422: error('Under 16 (`age_blocked`)'),
    },
  });

  return createRouter()
    .openapi(chat, async (c) => {
      const request = c.req.valid('json');
      const invalid = checkClientDates({ today: request.today }, deps.now());
      if (invalid) return apiError(c, 400, 'validation_error', invalid);

      const outcome = await onboardingChat(deps, c.var.user.userId, request);
      if (outcome.kind === 'rate_limited') return apiError(c, 429, 'rate_limited');
      if (outcome.kind === 'ai_unavailable') return apiError(c, 503, 'ai_unavailable');
      return c.json(outcome.response, 200);
    })
    .openapi(targetsPreview, async (c) => {
      const input = c.req.valid('json');
      const evaluation = evaluateProfileInput(
        input,
        await deps.store.getSafetyFlags(c.var.user.userId),
        deps.now(),
      );
      if (evaluation.kind === 'invalid') {
        return apiError(c, 400, 'validation_error', evaluation.fields);
      }
      if (evaluation.kind === 'blocked') return apiError(c, 422, 'age_blocked');
      return c.json(
        {
          targets: evaluation.targets,
          breakdown: evaluation.breakdown,
          safety: evaluation.safety,
        },
        200,
      );
    });
}
