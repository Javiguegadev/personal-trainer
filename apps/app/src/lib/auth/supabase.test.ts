import { describe, expect, it, vi } from 'vitest';
import {
  createSupabaseAuth,
  toAuthError,
  type SupabaseAuthLike,
  type SupabaseSessionLike,
} from './supabase';
import { AuthError } from './types';

const SESSION: SupabaseSessionLike = {
  access_token: 'token-1',
  user: { id: 'user-1', email: 'ana@example.com' },
};

/** In-memory stand-in for `supabase.auth`: a stored session plus the state change listeners. */
function fakeSupabase(stored: SupabaseSessionLike | null = null) {
  let session = stored;
  const listeners = new Set<(event: string, s: SupabaseSessionLike | null) => void>();
  const emit = (event: string) => {
    for (const listener of listeners) listener(event, session);
  };
  const auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((callback: (event: string, s: SupabaseSessionLike | null) => void) => {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => void listeners.delete(callback) } } };
    }),
    signInWithOtp: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
    verifyOtp: vi.fn(async (): Promise<{ error: unknown }> => {
      session = SESSION;
      emit('SIGNED_IN');
      return { error: null };
    }),
    signOut: vi.fn(async (): Promise<{ error: unknown }> => {
      session = null;
      emit('SIGNED_OUT');
      return { error: null };
    }),
  } satisfies SupabaseAuthLike;
  return {
    auth,
    emit,
    setSession: (next: SupabaseSessionLike | null) => {
      session = next;
    },
  };
}

const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);
  return error instanceof AuthError ? error.code : error;
};

describe('supabase auth', () => {
  it('starts loading and resolves to signed out without a stored session', async () => {
    const { auth } = fakeSupabase();
    const adapter = createSupabaseAuth({ auth, signInWithGoogle: vi.fn() });
    expect(adapter.getState().status).toBe('loading');
    await adapter.init();
    await adapter.init();
    expect(adapter.getState()).toEqual({ status: 'signedOut', session: null });
    expect(auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(await adapter.getAccessToken()).toBeNull();
  });

  it('restores a stored session on start (AC4)', async () => {
    const adapter = createSupabaseAuth({
      auth: fakeSupabase(SESSION).auth,
      signInWithGoogle: vi.fn(),
    });
    await adapter.init();
    expect(adapter.getState()).toEqual({
      status: 'signedIn',
      session: { userId: 'user-1', email: 'ana@example.com', accessToken: 'token-1' },
    });
    expect(await adapter.getAccessToken()).toBe('token-1');
  });

  it('sends the code and signs in with it (AC1)', async () => {
    const { auth } = fakeSupabase();
    const adapter = createSupabaseAuth({ auth, signInWithGoogle: vi.fn() });
    await adapter.init();
    await adapter.sendEmailCode('  ana@example.com ');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'ana@example.com',
      options: { shouldCreateUser: true },
    });
    await adapter.verifyEmailCode('ana@example.com', ' 123456 ');
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'ana@example.com',
      token: '123456',
      type: 'email',
    });
    expect(adapter.getState().status).toBe('signedIn');
  });

  it('rejects a malformed email or code before calling Supabase (AC1, AC2)', async () => {
    const { auth } = fakeSupabase();
    const adapter = createSupabaseAuth({ auth, signInWithGoogle: vi.fn() });
    expect(await codeOf(adapter.sendEmailCode('ana@'))).toBe('invalid_email');
    expect(await codeOf(adapter.verifyEmailCode('ana@example.com', '12345'))).toBe('invalid_code');
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('turns a wrong or expired code into invalid_code and stays signed out (AC2)', async () => {
    const { auth } = fakeSupabase();
    auth.verifyOtp.mockResolvedValueOnce({
      error: { name: 'AuthApiError', status: 403, code: 'otp_expired' },
    });
    const adapter = createSupabaseAuth({ auth, signInWithGoogle: vi.fn() });
    await adapter.init();
    expect(await codeOf(adapter.verifyEmailCode('ana@example.com', '000000'))).toBe('invalid_code');
    expect(adapter.getState().status).toBe('signedOut');
  });

  it.each([
    [{ status: 429, code: 'over_email_send_rate_limit' }, 'rate_limited'],
    [{ status: 429, code: 'over_request_rate_limit' }, 'rate_limited'],
    [{ status: 429 }, 'rate_limited'],
    [{ status: 400, code: 'email_address_invalid' }, 'invalid_email'],
    [{ name: 'AuthRetryableFetchError', status: 0 }, 'network'],
    [new TypeError('Network request failed'), 'network'],
    [{ status: 500, code: 'unexpected_failure' }, 'unknown'],
    ['boom', 'unknown'],
  ])('maps %o to %s (AC2)', (error, code) => {
    expect(toAuthError(error).code).toBe(code);
  });

  it('maps a thrown fetch failure while sending the code to network', async () => {
    const { auth } = fakeSupabase();
    auth.signInWithOtp.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const adapter = createSupabaseAuth({ auth, signInWithGoogle: vi.fn() });
    expect(await codeOf(adapter.sendEmailCode('ana@example.com'))).toBe('network');
  });

  it('signs in with Google and reads the stored session (AC3)', async () => {
    const fake = fakeSupabase();
    const signInWithGoogle = vi.fn(async () => {
      // The platform flow stores the session; no event reaches the adapter in this test.
      fake.setSession(SESSION);
    });
    const adapter = createSupabaseAuth({ auth: fake.auth, signInWithGoogle });
    await adapter.init();
    await adapter.signInWithGoogle();
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(adapter.getState().status).toBe('signedIn');
  });

  it('keeps a cancelled Google sign-in as cancelled and signed out (AC3)', async () => {
    const adapter = createSupabaseAuth({
      auth: fakeSupabase().auth,
      signInWithGoogle: vi.fn(async () => {
        throw new AuthError('cancelled');
      }),
    });
    await adapter.init();
    expect(await codeOf(adapter.signInWithGoogle())).toBe('cancelled');
    expect(adapter.getState().status).toBe('signedOut');
  });

  it('maps a failed Google sign-in to a translated error (AC3)', async () => {
    const adapter = createSupabaseAuth({
      auth: fakeSupabase().auth,
      signInWithGoogle: vi.fn(async () => {
        throw { name: 'AuthRetryableFetchError', status: 0 };
      }),
    });
    expect(await codeOf(adapter.signInWithGoogle())).toBe('network');
  });

  it('follows token refreshes and sign-outs from Supabase events', async () => {
    const fake = fakeSupabase(SESSION);
    const adapter = createSupabaseAuth({ auth: fake.auth, signInWithGoogle: vi.fn() });
    await adapter.init();
    fake.setSession({ ...SESSION, access_token: 'token-2' });
    fake.emit('TOKEN_REFRESHED');
    expect(adapter.getState().session?.accessToken).toBe('token-2');
    fake.emit('SIGNED_OUT');
    expect(adapter.getState()).toEqual({ status: 'signedOut', session: null });
  });

  it('signs out of this device only, also when offline (AC4)', async () => {
    const fake = fakeSupabase(SESSION);
    const adapter = createSupabaseAuth({ auth: fake.auth, signInWithGoogle: vi.fn() });
    await adapter.init();
    await adapter.signOut();
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(adapter.getState()).toEqual({ status: 'signedOut', session: null });

    const offline = fakeSupabase(SESSION);
    offline.auth.signOut.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const other = createSupabaseAuth({ auth: offline.auth, signInWithGoogle: vi.fn() });
    await other.init();
    await other.signOut();
    expect(other.getState().status).toBe('signedOut');
  });
});
