import { mockUserFromEmail, parseMockToken } from '@pt/api-client/mock';
import { describe, expect, it, vi } from 'vitest';
import type { KeyValueStorage } from '../storage';
import { createMockAuth, MOCK_CODE, MOCK_EXPIRED_CODE, MOCK_SESSION_KEY } from './mock';
import { AuthError } from './types';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);
  return error instanceof AuthError ? error.code : error;
};

describe('mock auth', () => {
  it('starts loading and resolves to signed out without a stored session', async () => {
    const auth = createMockAuth({ storage: memoryStorage() });
    expect(auth.getState().status).toBe('loading');
    await auth.init();
    expect(auth.getState()).toEqual({ status: 'signedOut', session: null });
  });

  it('signs in with the email code and issues a token the mock API understands (AC1)', async () => {
    const auth = createMockAuth({ storage: memoryStorage() });
    await auth.init();
    const listener = vi.fn();
    auth.subscribe(listener);

    await auth.sendEmailCode('Ana@Example.com');
    await auth.verifyEmailCode('Ana@Example.com', MOCK_CODE);

    const state = auth.getState();
    expect(state.status).toBe('signedIn');
    expect(state.session?.userId).toBe(mockUserFromEmail('ana@example.com').userId);
    expect(parseMockToken(await auth.getAccessToken())?.email).toBe('ana@example.com');
    expect(listener).toHaveBeenCalled();
  });

  it('rejects an invalid email, a wrong code and an expired code (AC2)', async () => {
    const auth = createMockAuth({ storage: memoryStorage() });
    await auth.init();
    expect(await codeOf(auth.sendEmailCode('not-an-email'))).toBe('invalid_email');
    expect(await codeOf(auth.verifyEmailCode('ana@example.com', '111111'))).toBe('invalid_code');
    expect(await codeOf(auth.verifyEmailCode('ana@example.com', MOCK_EXPIRED_CODE))).toBe(
      'expired_code',
    );
    expect(auth.getState().status).toBe('signedOut');
  });

  it('signs in with Google (AC3)', async () => {
    const auth = createMockAuth({ storage: memoryStorage() });
    await auth.init();
    await auth.signInWithGoogle();
    expect(auth.getState().status).toBe('signedIn');
  });

  it('restores the session after a restart and removes it on sign out (AC4)', async () => {
    const storage = memoryStorage();
    const first = createMockAuth({ storage });
    await first.init();
    await first.verifyEmailCode('ana@example.com', MOCK_CODE);

    const reopened = createMockAuth({ storage });
    await reopened.init();
    expect(reopened.getState()).toEqual(first.getState());

    await reopened.signOut();
    expect(storage.data.has(MOCK_SESSION_KEY)).toBe(false);
    expect(reopened.getState().status).toBe('signedOut');
    expect(await reopened.getAccessToken()).toBeNull();
  });

  it('treats a corrupt stored session as signed out', async () => {
    const storage = memoryStorage();
    storage.setItem(MOCK_SESSION_KEY, '{nope');
    const auth = createMockAuth({ storage });
    await auth.init();
    expect(auth.getState().status).toBe('signedOut');
  });
});
