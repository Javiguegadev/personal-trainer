import { serve } from '@hono/node-server';
import { createMessageFn, runOnboardingTurn } from '@pt/ai';
import { createDb } from '@pt/db';
import { createApp } from './app';
import type { Deps } from './deps';
import { supabaseJwtVerifier } from './middleware/auth';
import { createDrizzleStore } from './store/drizzle-store';
import { createSupabaseAuthAdmin } from './store/supabase-admin';

function createDeps(env: NodeJS.ProcessEnv): Deps | undefined {
  const supabaseUrl = env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
  const { DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY } = env;
  if (!supabaseUrl || !DATABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      'Supabase env missing (SUPABASE_URL, DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY): serving /health only',
    );
    return undefined;
  }
  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY missing: /onboarding/chat answers 503 (use the form)');
  }
  const createMessage = ANTHROPIC_API_KEY ? createMessageFn(ANTHROPIC_API_KEY) : null;

  return {
    verifyToken: supabaseJwtVerifier(supabaseUrl),
    store: createDrizzleStore(createDb(DATABASE_URL)),
    authAdmin: createSupabaseAuthAdmin({
      supabaseUrl,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    }),
    onboardingAi: createMessage ? (request) => runOnboardingTurn(createMessage, request) : null,
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
