import { serve } from '@hono/node-server';
import {
  AiUnavailableError,
  FEATURES,
  createFeedbackWriter,
  createLabelReader,
  createMealReader,
  createWorkoutReader,
  createMessageFn,
  type AiFeature,
  type ReadLabel,
  type ReadMeal,
  type WordFeedback,
  type ReadWorkout,
} from '@pt/ai';
import { createDb } from '@pt/db';
import { createApp } from './app';
import type { Deps } from './deps';
import { supabaseJwtVerifier } from './middleware/auth';
import { createOffClient } from './off/client';
import { createDrizzleStore } from './store/drizzle-store';
import { createSupabaseAuthAdmin } from './store/supabase-admin';

/** The failure of every AI call when there is no API key: the app falls back to its forms. */
function noApiKey(feature: AiFeature): AiUnavailableError {
  return new AiUnavailableError(
    'error',
    {
      feature,
      model: FEATURES[feature].model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      status: 'error',
    },
    'ANTHROPIC_API_KEY is not set',
  );
}

/** Without an API key every label read fails as "AI unavailable", and the form is filled by hand. */
function createReadLabel(apiKey: string | undefined): ReadLabel {
  if (apiKey) return createLabelReader(createMessageFn(apiKey));
  console.warn('ANTHROPIC_API_KEY missing: label photos answer 503 (ai_unavailable)');
  return async () => {
    throw noApiKey('label_scan');
  };
}

/** Without an API key the plate photo and the sentence answer 503; the search keeps working. */
function createReadMeal(apiKey: string | undefined): ReadMeal {
  if (apiKey) return createMealReader(createMessageFn(apiKey));
  return async (input) => {
    throw noApiKey(input.kind === 'photo' ? 'meal_photo' : 'meal_text');
  };
}

/** Without an API key the daily feedback uses the fixed wording (spec 008 AC15). */
function createWordFeedback(apiKey: string | undefined): WordFeedback {
  if (apiKey) return createFeedbackWriter(createMessageFn(apiKey));
  return async () => {
    throw noApiKey('daily_feedback');
  };
}

/** Without an API key the workout sentence answers 503; logging by taps keeps working. */
function createReadWorkout(apiKey: string | undefined): ReadWorkout {
  if (apiKey) return createWorkoutReader(createMessageFn(apiKey));
  return async () => {
    throw noApiKey('workout_text');
  };
}

/** Open Food Facts asks every app for `AppName/Version (ContactEmail)`. */
function offUserAgent(env: NodeJS.ProcessEnv): string {
  const app = `PersonalTrainer/${env.APP_VERSION ?? '0.0.0'}`;
  if (!env.OFF_CONTACT_EMAIL) {
    console.warn('OFF_CONTACT_EMAIL missing: Open Food Facts asks for a contact in the User-Agent');
    return app;
  }
  return `${app} (${env.OFF_CONTACT_EMAIL})`;
}

function createDeps(env: NodeJS.ProcessEnv): Deps | undefined {
  const supabaseUrl = env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
  const { DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  if (!supabaseUrl || !DATABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      'Supabase env missing (SUPABASE_URL, DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY): serving /health only',
    );
    return undefined;
  }

  return {
    verifyToken: supabaseJwtVerifier(supabaseUrl),
    store: createDrizzleStore(createDb(DATABASE_URL)),
    authAdmin: createSupabaseAuthAdmin({
      supabaseUrl,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    }),
    lookupProduct: createOffClient({ fetch, userAgent: offUserAgent(env) }),
    readLabel: createReadLabel(env.ANTHROPIC_API_KEY),
    readMeal: createReadMeal(env.ANTHROPIC_API_KEY),
    wordFeedback: createWordFeedback(env.ANTHROPIC_API_KEY),
    readWorkout: createReadWorkout(env.ANTHROPIC_API_KEY),
    now: () => new Date(),
  };
}

const port = Number(process.env.API_PORT ?? 8787);
const app = createApp({
  webOrigins: (process.env.WEB_ORIGINS ?? 'http://localhost:8081')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  version: process.env.APP_VERSION ?? '0.0.0',
  deps: createDeps(process.env),
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
