import {
  createApiClient,
  createApiHooks,
  registerCustomFoodMutations,
  registerFoodMutations,
  registerWeightMutations,
  type ApiClient,
} from '@pt/api-client';
import { createMockApiClient } from '@pt/api-client/mock';
import { auth } from './auth';
import { MOCK_BACKEND } from './backend';
import { setupOnlineManager } from './online';
import { queryClient } from './query';
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

// Before any saved write is restored (lib/offline.ts): a restored write finds its function by key.
registerWeightMutations(queryClient, api);
registerFoodMutations(queryClient, api);
registerCustomFoodMutations(queryClient, api);
setupOnlineManager();

export const {
  useMe,
  useTargetsPreview,
  useGrantConsent,
  useUpdateProfile,
  useWeights,
  useSaveWeight,
  useDeleteWeight,
  usePendingWeightDates,
  useWeightTargetsChange,
  useRejectedWeightWrite,
  useFoodLog,
  useFoodSearch,
  useFood,
  useFoodSources,
  useRecentFoods,
  useFavouriteFoods,
  useSaveMealItem,
  useDeleteMealItem,
  useSetFavouriteFood,
  usePendingMealItemIds,
  useRejectedFoodWrite,
  useCustomFoods,
  useSaveCustomFood,
  useDeleteCustomFood,
  useBarcodeLookup,
  useScanLabel,
  useExportData,
  useDeleteAccount,
} = createApiHooks(api);
