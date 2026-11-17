/**
 * Small synchronous key-value store for the session and dev data.
 * Native: `expo-sqlite`'s localStorage polyfill (the storage the Expo Supabase guide recommends for the
 * auth session). Web: the browser's localStorage (the polyfill is a no-op there).
 */
import 'expo-sqlite/localStorage/install';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const storage: KeyValueStorage = {
  getItem(key) {
    try {
      return globalThis.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      globalThis.localStorage.setItem(key, value);
    } catch {
      // Storage full or blocked (private browsing): the app keeps working for this session.
    }
  },
  removeItem(key) {
    try {
      globalThis.localStorage.removeItem(key);
    } catch {
      // Same as above.
    }
  },
};
