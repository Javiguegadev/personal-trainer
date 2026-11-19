import { afterConsent, isApiError } from '@pt/api-client';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

/** How long the saved offline cache stays valid (`lib/offline.ts`). */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A 403 `consent_required` means the consent we have cached is stale (e.g. `CONSENT_VERSION` changed
 * while the app was open). Refetching `/me` lets the root guard show the consent screen (spec 002 AC14).
 */
function onError(error: unknown): void {
  if (isApiError(error, 'consent_required')) void afterConsent(queryClient);
}

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    // A query removed from memory is not saved: keep them at least as long as the saved cache.
    queries: { gcTime: CACHE_MAX_AGE_MS },
  },
});
