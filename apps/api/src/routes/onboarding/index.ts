import { createRoute } from '@hono/zod-openapi';
import { ApiErrorSchema, ProfileInputSchema, TargetsPreviewResponseSchema } from '@pt/contracts';
import { evaluateProfileInput } from '@pt/core';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});

export function onboardingRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);

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

  return createRouter().openapi(targetsPreview, async (c) => {
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
