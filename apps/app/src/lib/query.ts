import { QueryClient } from '@tanstack/react-query';

/** How long the saved offline cache stays valid (`lib/offline.ts`). */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    // A query removed from memory is not saved: keep them at least as long as the saved cache.
    queries: { gcTime: CACHE_MAX_AGE_MS },
  },
});
