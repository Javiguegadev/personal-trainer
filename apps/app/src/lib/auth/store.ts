import type { AuthState } from './types';

/** Minimal observable state shared by the auth adapters. */
export function createAuthStore(initial: AuthState = { status: 'loading', session: null }) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: AuthState) {
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
