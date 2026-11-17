import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys on the web build of the app, against the in-memory mock backend (no Supabase, no
 * API, no AI). Run with `pnpm e2e` from the repo root. The mock only exists in development builds, so
 * the tests use the Expo dev server (`web:mock`), started here unless one is already running.
 */
const baseURL = 'http://localhost:8081';

export default defineConfig({
  testDir: './tests',
  // The dev server builds the bundle on the first request, so the first test waits for it.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'pnpm --filter @pt/app web:mock',
    url: `${baseURL}/status`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { BROWSER: 'none' },
  },
});
