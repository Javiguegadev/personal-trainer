import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set (see .env.example)');
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  // Supabase owns its roles (anon, authenticated, service_role) and the auth schema: never create them.
  entities: { roles: { provider: 'supabase' } },
  schemaFilter: ['public'],
  strict: true,
  verbose: true,
});
