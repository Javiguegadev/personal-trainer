import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import type { Deps } from './deps';
import { errorBody } from './http';
import { healthRoutes } from './routes/health';
import { foodRoutes } from './routes/foods';
import { draftRoutes } from './routes/foods/drafts';
import { feedbackRoutes } from './routes/me/feedback';
import { productRoutes } from './routes/foods/products';
import { meRoutes } from './routes/me';
import { onboardingRoutes } from './routes/onboarding';
import { planRoutes } from './routes/plan';
import { trainingRoutes } from './routes/training';

export interface AppConfig {
  /** Browser origins allowed by CORS (Expo web, landing). Native apps send no Origin header. */
  webOrigins: string[];
  version: string;
  /** DB and auth. Without them (missing env in dev) only `/health` is served. */
  deps?: Deps;
}

export function createApp(config: AppConfig) {
  const app = new OpenAPIHono();

  app.use('*', logger());
  app.use('*', cors({ origin: config.webOrigins, credentials: true }));

  app.route('/', healthRoutes(config));
  if (config.deps) {
    app.route('/', meRoutes(config.deps));
    app.route('/', onboardingRoutes(config.deps));
    app.route('/', productRoutes(config.deps));
    app.route('/', draftRoutes(config.deps));
    app.route('/', feedbackRoutes(config.deps));
    app.route('/', foodRoutes(config.deps));
    app.route('/', trainingRoutes(config.deps));
    app.route('/', planRoutes(config.deps));
  }

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Personal Trainer API', version: config.version },
  });

  app.notFound((c) => c.json(errorBody('not_found'), 404));

  app.onError((err, c) => {
    // Malformed JSON and similar client errors raised by Hono's validators.
    if (err instanceof HTTPException && err.status < 500) {
      return c.json(errorBody('validation_error'), 400);
    }
    console.error(err);
    return c.json(errorBody('internal_error'), 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
