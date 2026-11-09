import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { HealthResponseSchema } from '@pt/contracts';
import type { AppConfig } from '../app';

const route = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  responses: {
    200: {
      description: 'Service is up',
      content: { 'application/json': { schema: HealthResponseSchema } },
    },
  },
});

export function healthRoutes(config: AppConfig) {
  return new OpenAPIHono().openapi(route, (c) =>
    c.json(
      {
        status: 'ok' as const,
        service: 'api',
        version: config.version,
        time: new Date().toISOString(),
      },
      200,
    ),
  );
}
