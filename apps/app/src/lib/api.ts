import { createApiClient, createApiHooks } from '@pt/api-client';
import { QueryClient } from '@tanstack/react-query';

/**
 * Single API client for the whole app (web, iOS, Android).
 * EXPO_PUBLIC_* variables are inlined at build time, so never put secrets in them.
 * On a physical device, `localhost` is the phone itself: use your computer's LAN IP.
 * The Supabase access token (`getAccessToken`) and sign-out on 401 are wired in the auth UI step.
 */
export const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787',
});

export const {
  useMe,
  useTargetsPreview,
  useGrantConsent,
  useUpdateProfile,
  useOnboardingChat,
  useExportData,
  useDeleteAccount,
} = createApiHooks(api);

export const queryClient = new QueryClient();
