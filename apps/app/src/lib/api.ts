import { createApiClient, createApiHooks, type ApiClient } from '@pt/api-client';
import { createMockApiClient } from '@pt/api-client/mock';
import { auth } from './auth';
import { MOCK_BACKEND } from './backend';
import { signOut } from './session';
import { storage } from './storage';

const session = {
  getAccessToken: () => auth.getAccessToken(),
  /** An expired or revoked session signs the user out locally (AC4). */
  onUnauthorized: () => void signOut(),
};

/**
 * Single API client for the whole app (web, iOS, Android).
 * EXPO_PUBLIC_* variables are inlined at build time, so never put secrets in them.
 * On a physical device, `localhost` is the phone itself: use your computer's LAN IP.
 */
export const api: ApiClient = MOCK_BACKEND
  ? createMockApiClient({ ...session, storage, latencyMs: 400 })
  : createApiClient({
      baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787',
      ...session,
    });

export const {
  useMe,
  useTargetsPreview,
  useGrantConsent,
  useUpdateProfile,
  useExportData,
  useDeleteAccount,
} = createApiHooks(api);
