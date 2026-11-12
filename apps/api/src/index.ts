import { serve } from '@hono/node-server';
import { createDb } from '@pt/db';
import { createApp } from './app';
import type { Deps } from './deps';
import { supabaseJwtVerifier } from './middleware/auth';
import { createDrizzleStore } from './store/drizzle-store';
import { createSupabaseAuthAdmin } from './store/supabase-admin';

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
