// Starts Expo with the in-memory mock backend (auth + API), for development and E2E tests.
// Usage: pnpm --filter @pt/app web:mock  (web)  ·  pnpm --filter @pt/app dev:mock  (Expo Go)
// The flag only works in development builds (__DEV__); see src/lib/backend.ts.
// Expo runs in this same process (no child), so stopping this command stops the dev server too.
/* global process */
import { createRequire } from 'node:module';

process.env.EXPO_PUBLIC_MOCK_BACKEND = '1';
const require = createRequire(import.meta.url);
const cli = require.resolve('expo/bin/cli');
process.argv = [process.argv[0] ?? 'node', cli, 'start', ...process.argv.slice(2)];
require(cli);
