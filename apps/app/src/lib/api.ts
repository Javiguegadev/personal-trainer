import { createApiClient } from '@pt/api-client';

/**
 * Single API client for the whole app (web, iOS, Android).
 * EXPO_PUBLIC_* variables are inlined at build time, so never put secrets in them.
 * On a physical device, `localhost` is the phone itself: use your computer's LAN IP.
 */
export const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787',
});
