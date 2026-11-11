/**
 * Mock auth for development and E2E (no Supabase). Any valid email works with the code 123456;
 * 000000 simulates an expired code. "Continue with Google" signs in a fixed demo account.
 * Tokens are understood only by the mock backend in `@pt/api-client/mock`.
 */
import { mockAccessToken, mockUserFromEmail } from '@pt/api-client/mock';
import type { KeyValueStorage } from '../storage';
import { createAuthStore } from './store';
import { AuthError, type AuthAdapter, type AuthSession } from './types';

export const MOCK_CODE = '123456';
export const MOCK_EXPIRED_CODE = '000000';
export const MOCK_GOOGLE_EMAIL = 'google.demo@example.com';
export const MOCK_SESSION_KEY = 'pt.mock.session.v1';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readSession(storage: KeyValueStorage): AuthSession | null {
  try {
    const raw = storage.getItem(MOCK_SESSION_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (
      typeof value === 'object' &&
      value !== null &&
      'userId' in value &&
      'accessToken' in value &&
      typeof value.userId === 'string' &&
      typeof value.accessToken === 'string'
    ) {
      const email = 'email' in value && typeof value.email === 'string' ? value.email : null;
      return { userId: value.userId, email, accessToken: value.accessToken };
    }
  } catch {
    // Corrupt value: treat as signed out.
  }
  return null;
}

export function createMockAuth({
  storage,
  latencyMs = 0,
}: {
  storage: KeyValueStorage;
  latencyMs?: number;
}): AuthAdapter {
  const store = createAuthStore();
  const wait = () =>
    latencyMs > 0
      ? new Promise<void>((resolve) => setTimeout(resolve, latencyMs))
      : Promise.resolve();

  function signIn(email: string) {
    const user = mockUserFromEmail(email);
    const session: AuthSession = {
      userId: user.userId,
      email: user.email,
      accessToken: mockAccessToken(user),
    };
    storage.setItem(MOCK_SESSION_KEY, JSON.stringify(session));
    store.set({ status: 'signedIn', session });
  }

  return {
    getState: store.get,
    subscribe: store.subscribe,

    async init() {
      if (store.get().status !== 'loading') return;
      const session = readSession(storage);
      store.set(session ? { status: 'signedIn', session } : { status: 'signedOut', session: null });
    },

    async sendEmailCode(email) {
      await wait();
      if (!EMAIL_PATTERN.test(email.trim())) throw new AuthError('invalid_email');
    },

    async verifyEmailCode(email, code) {
      await wait();
      if (!EMAIL_PATTERN.test(email.trim())) throw new AuthError('invalid_email');
      const digits = code.trim();
      if (digits === MOCK_EXPIRED_CODE) throw new AuthError('expired_code');
      if (digits !== MOCK_CODE) throw new AuthError('invalid_code');
      signIn(email);
    },

    async signInWithGoogle() {
      await wait();
      signIn(MOCK_GOOGLE_EMAIL);
    },

    async signOut() {
      storage.removeItem(MOCK_SESSION_KEY);
      store.set({ status: 'signedOut', session: null });
    },

    async getAccessToken() {
      return store.get().session?.accessToken ?? null;
    },
  };
}
