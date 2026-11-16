import { serve } from '@hono/node-server';
import {
  AiUnavailableError,
  FEATURES,
  createLabelReader,
  createMessageFn,
  type ReadLabel,
} from '@pt/ai';
import { createDb } from '@pt/db';
import { createApp } from './app';
import type { Deps } from './deps';
import { supabaseJwtVerifier } from './middleware/auth';
import { createOffClient } from './off/client';
import { createDrizzleStore } from './store/drizzle-store';
import { createSupabaseAuthAdmin } from './store/supabase-admin';

/** Without an API key every label read fails as "AI unavailable", and the form is filled by hand. */
function createReadLabel(apiKey: string | undefined): ReadLabel {
  if (apiKey) return createLabelReader(createMessageFn(apiKey));
  console.warn('ANTHROPIC_API_KEY missing: label photos answer 503 (ai_unavailable)');
  return async () => {
    throw new AiUnavailableError(
      'error',
      {
        feature: 'label_scan',
        model: FEATURES.label_scan.model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        status: 'error',
      },
      'ANTHROPIC_API_KEY is not set',
    );
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
