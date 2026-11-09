import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { healthRoutes } from './routes/health';

export interface AppConfig {
  webOrigin: string;
  version: string;
}

export function createApp(config: AppConfig) {
  const app = new OpenAPIHono();

  app.use('*', logger());
  app.use('*', cors({ origin: config.webOrigin, credentials: true }));

  app.route('/', healthRoutes(config));

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Personal Trainer API', version: config.version },
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
