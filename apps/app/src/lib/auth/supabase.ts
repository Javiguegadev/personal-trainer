/**
 * Supabase auth adapter (spec 001): email one-time code (AC1, AC2), Google (AC3) and the stored session
 * (AC4). It depends only on the small slice of `supabase.auth` below, so tests drive it with a fake; the
 * real client and the platform's Google flow come from `supabaseClient.ts` / `supabaseClient.web.ts`.
 */
import { createAuthStore } from './store';
import { AuthError, type AuthAdapter, type AuthErrorCode, type AuthState } from './types';

export interface SupabaseSessionLike {
  access_token: string;
  user: { id: string; email?: string | null };
}

interface Result {
  error: unknown;
}

/** The part of `SupabaseClient['auth']` the adapter uses. */
export interface SupabaseAuthLike {
  getSession(): Promise<{ data: { session: SupabaseSessionLike | null }; error: unknown }>;
  onAuthStateChange(callback: (event: string, session: SupabaseSessionLike | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
  signInWithOtp(credentials: {
    email: string;
    options?: { shouldCreateUser?: boolean };
  }): Promise<Result>;
  verifyOtp(params: { email: string; token: string; type: 'email' }): Promise<Result>;
  signOut(options: { scope: 'local' }): Promise<Result>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CODES: Record<string, AuthErrorCode> = {
  // Supabase answers a wrong code and an expired one alike; the invalid-code copy covers both.
  otp_expired: 'invalid_code',
  over_email_send_rate_limit: 'rate_limited',
  over_request_rate_limit: 'rate_limited',
  email_address_invalid: 'invalid_email',
  validation_failed: 'invalid_email',
};

/** Maps a Supabase (or fetch) error to the app's error codes, which have translated messages. */
export function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  if (typeof error === 'object' && error !== null) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : null;
    if (code && CODES[code]) return new AuthError(CODES[code]);
    const name = 'name' in error ? error.name : null;
    const status = 'status' in error ? error.status : null;
    if (name === 'AuthRetryableFetchError' || status === 0) return new AuthError('network');
    if (status === 429) return new AuthError('rate_limited');
  }
  if (error instanceof TypeError) return new AuthError('network');
  return new AuthError('unknown');
}

function toState(session: SupabaseSessionLike | null): AuthState {
  return session
    ? {
        status: 'signedIn',
        session: {
          userId: session.user.id,
          email: session.user.email ?? null,
          accessToken: session.access_token,
        },
      }
    : { status: 'signedOut', session: null };
}

export function createSupabaseAuth({
  auth,
  signInWithGoogle,
  onError,
}: {
  auth: SupabaseAuthLike;
  /** The platform's Google flow; it resolves once the session is stored (or the page leaves on web). */
  signInWithGoogle: () => Promise<void>;
  /** Sees the original error behind every mapped one (the app logs it in development). */
  onError?: (error: unknown) => void;
}): AuthAdapter {
  const store = createAuthStore();
  let initializing: Promise<void> | null = null;

  function fail(error: unknown): AuthError {
    if (!(error instanceof AuthError && error.code === 'cancelled')) onError?.(error);
    return toAuthError(error);
  }

  async function run(call: Promise<Result>): Promise<void> {
    let result: Result;
    try {
      result = await call;
    } catch (e) {
      throw fail(e);
    }
    if (result.error) throw fail(result.error);
  }

  async function readSession(): Promise<SupabaseSessionLike | null> {
    try {
      const { data } = await auth.getSession();
      return data.session;
    } catch {
      return null;
    }
  }

  return {
    getState: store.get,
    subscribe: store.subscribe,

    init() {
      initializing ??= (async () => {
        // Sign-in, sign-out and token refreshes all arrive here, whichever call caused them.
        auth.onAuthStateChange((event, session) => {
          store.set(event === 'SIGNED_OUT' ? toState(null) : toState(session));
        });
        const session = await readSession();
        // An event may have settled the state while the stored session was being read.
        if (store.get().status === 'loading') store.set(toState(session));
      })();
      return initializing;
    },

    async sendEmailCode(email) {
      const trimmed = email.trim();
      if (!EMAIL_PATTERN.test(trimmed)) throw new AuthError('invalid_email');
      await run(auth.signInWithOtp({ email: trimmed, options: { shouldCreateUser: true } }));
    },

    async verifyEmailCode(email, code) {
      const trimmed = email.trim();
      if (!EMAIL_PATTERN.test(trimmed)) throw new AuthError('invalid_email');
      const token = code.trim();
      if (!/^\d{6}$/.test(token)) throw new AuthError('invalid_code');
      await run(auth.verifyOtp({ email: trimmed, token, type: 'email' }));
      // The state change event normally lands first; read the session in case it has not.
      if (store.get().status !== 'signedIn') store.set(toState(await readSession()));
    },

    async signInWithGoogle() {
      try {
        await signInWithGoogle();
      } catch (e) {
        throw fail(e);
      }
      if (store.get().status !== 'signedIn') {
        const session = await readSession();
        if (session) store.set(toState(session));
      }
    },

    async signOut() {
      try {
        // Only this device (AC4); the user's other devices keep their sessions.
        await auth.signOut({ scope: 'local' });
      } catch {
        // Offline: Supabase still forgets the stored session; the state is reset below either way.
      }
      store.set(toState(null));
    },

    async getAccessToken() {
      // getSession refreshes an expired access token with the stored refresh token.
      return (await readSession())?.access_token ?? null;
    },
  };
}
