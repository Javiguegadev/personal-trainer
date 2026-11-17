/**
 * Offline cache (spec 003 AC5, AC18, AC22): the query cache and the queue of weight writes are saved in
 * the app's key-value storage, one copy per user, restored at start, and removed on sign-out.
 */
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, type Query } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { useSyncExternalStore } from 'react';
import { CACHE_MAX_AGE_MS, queryClient } from './query';
import { storage } from './storage';

const CACHE_KEY_PREFIX = 'pt.query-cache.';
/** Change it when the shape of the cached data changes: an older copy is then discarded. */
const CACHE_BUSTER = 'spec-003';

type Persister = ReturnType<typeof createAsyncStoragePersister>;

let active: { userId: string; persister: Persister; unsubscribe: () => void } | null = null;
let restoredUserId: string | null = null;
const listeners = new Set<() => void>();

function setRestored(userId: string | null) {
  restoredUserId = userId;
  for (const listener of listeners) listener();
}

/**
 * Targets previews depend only on the form being edited, and search results need a connection anyway
 * (spec 005 AC6): not worth keeping. The food log, recents and favourites are kept (AC19).
 */
const NOT_SAVED = new Set(['onboarding', 'food-search']);
const shouldDehydrateQuery = (query: Query) =>
  defaultShouldDehydrateQuery(query) && !NOT_SAVED.has(String(query.queryKey[0]));

/**
 * Restores the user's saved cache, then keeps it saved. Paused writes resume once restored (they stay
 * paused while offline). Safe to call again for the same user.
 */
export function startOfflineCache(userId: string): void {
  if (active?.userId === userId) return;
  stopOfflineCache();
  const persister = createAsyncStoragePersister({ storage, key: CACHE_KEY_PREFIX + userId });
  const [unsubscribe, restored] = persistQueryClient({
    queryClient,
    persister,
    maxAge: CACHE_MAX_AGE_MS,
    buster: CACHE_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery },
  });
  active = { userId, persister, unsubscribe };
  void restored
    .catch(() => undefined)
    .finally(() => {
      if (active?.userId !== userId) return;
      setRestored(userId);
      void queryClient.resumePausedMutations().then(() => queryClient.invalidateQueries());
    });
}

/** Stops saving the cache. Returns a function that deletes the saved copy. */
export function stopOfflineCache(): () => Promise<void> {
  const current = active;
  active = null;
  setRestored(null);
  current?.unsubscribe();
  return async () => {
    await current?.persister.removeClient();
  };
}

/** True once the saved cache of `userId` is in memory; queries wait for it (no flash of an error). */
export function useOfflineCacheRestored(userId: string | null): boolean {
  const restored = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => restoredUserId,
    () => restoredUserId,
  );
  return userId !== null && restored === userId;
}
