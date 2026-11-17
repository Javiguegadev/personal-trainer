/**
 * Placeholder used outside demo mode when `EXPO_PUBLIC_SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_ANON_KEY`
 * is missing. Signing in fails with `not_configured`, which tells the developer to use `web:mock`.
 */
import { createAuthStore } from './store';
import { AuthError, type AuthAdapter } from './types';

export function createUnconfiguredAuth(): AuthAdapter {
  const store = createAuthStore({ status: 'signedOut', session: null });
  const fail = async (): Promise<never> => {
    throw new AuthError('not_configured');
  };
  return {
    getState: store.get,
    subscribe: store.subscribe,
    init: async () => {},
    sendEmailCode: fail,
    verifyEmailCode: fail,
    signInWithGoogle: fail,
    signOut: async () => {},
    getAccessToken: async () => null,
  };
}
