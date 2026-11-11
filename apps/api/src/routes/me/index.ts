import { createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  ConsentRequestSchema,
  ExportResponseSchema,
  MeResponseSchema,
  ProfileInputSchema,
} from '@pt/contracts';
import type { Deps } from '../../deps';
import { apiError, createRouter } from '../../http';
import { requireAuth, requireConsent } from '../../middleware/auth';
import { evaluateProfileInput, saveProfile, toMeResponse } from '../../services/profile';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});

export function meRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);

  const getMe = createRoute({
    method: 'get',
    path: '/me',
    tags: ['me'],
    middleware: [auth] as const,
    responses: {
      200: {
        description: 'Profile, preferences, current targets, consent and onboarding status',
        content: { 'application/json': { schema: MeResponseSchema } },
      },
      401: error('Unauthenticated'),
    },
  });

  const postConsent = createRoute({
    method: 'post',
    path: '/me/consent',
    tags: ['me'],
    middleware: [auth] as const,
    request: { body: { content: { 'application/json': { schema: ConsentRequestSchema } } } },
    responses: {
      204: { description: 'Consent recorded' },
      400: error('Invalid body'),
      401: error('Unauthenticated'),
    },
  });

  const putProfile = createRoute({
    method: 'put',
    path: '/me/profile',
    tags: ['me'],
    middleware: [auth, consent] as const,
    request: { body: { content: { 'application/json': { schema: ProfileInputSchema } } } },
    responses: {
      200: {
        description: 'Profile, preferences and new targets stored',
        content: { 'application/json': { schema: MeResponseSchema } },
      },
      400: error('Invalid body'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      422: error('Under 16 (`age_blocked`): nothing is stored'),
    },
  });

  const getExport = createRoute({
    method: 'get',
    path: '/me/export',
    tags: ['me'],
    middleware: [auth] as const,
    responses: {
      200: {
        description: 'Every row linked to the account (GDPR art. 15/20)',
        content: { 'application/json': { schema: ExportResponseSchema } },
      },
      401: error('Unauthenticated'),
    },
  });

  const deleteMe = createRoute({
    method: 'delete',
    path: '/me',
    tags: ['me'],
    middleware: [auth] as const,
    responses: {
      204: { description: 'Account and every user row deleted' },
      401: error('Unauthenticated'),
    },
  });

  return createRouter()
    .openapi(getMe, async (c) => {
      const { userId } = c.var.user;
      return c.json(toMeResponse(userId, await deps.store.getMe(userId)), 200);
    })
    .openapi(postConsent, async (c) => {
      const body = c.req.valid('json');
      await deps.store.grantConsent(c.var.user.userId, body.kind, body.version, deps.now());
      return c.body(null, 204);
    })
    .openapi(putProfile, async (c) => {
      const input = c.req.valid('json');
      const { userId } = c.var.user;
      const evaluation = evaluateProfileInput(
        input,
        await deps.store.getSafetyFlags(userId),
        deps.now(),
      );
      if (evaluation.kind === 'invalid') {
        return apiError(c, 400, 'validation_error', evaluation.fields);
      }
      if (evaluation.kind === 'blocked') return apiError(c, 422, 'age_blocked');
      return c.json(await saveProfile(deps, userId, input, evaluation), 200);
    })
    .openapi(getExport, async (c) => {
      const { userId, email } = c.var.user;
      const record = await deps.store.exportUser(userId);
      const exportedAt = deps.now().toISOString();
      c.header(
        'content-disposition',
        `attachment; filename="personal-trainer-export-${exportedAt.slice(0, 10)}.json"`,
      );
      return c.json({ exportedAt, userId, email, ...record }, 200);
    })
    .openapi(deleteMe, async (c) => {
      await deps.authAdmin.deleteUser(c.var.user.userId);
      return c.body(null, 204);
    });
}
