/**
 * Auth port used by the whole app. Implementations: the mock (dev/E2E), and the Supabase one (email OTP +
 * Google) once the spec 001 prerequisites exist. Screens depend only on this interface.
 */
export interface AuthSession {
  userId: string;
  email: string | null;
  accessToken: string;
}

export type AuthState =
  | { status: 'loading'; session: null }
  | { status: 'signedOut'; session: null }
  | { status: 'signedIn'; session: AuthSession };

/** Each code maps to the i18n key `auth.errors.<code>`. */
export type AuthErrorCode =
  | 'invalid_email'
  | 'invalid_code'
  | 'expired_code'
  | 'rate_limited'
  | 'network'
  | 'cancelled'
  | 'not_configured'
  | 'unknown';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(`auth: ${code}`);
    this.name = 'AuthError';
  }
}

export interface AuthAdapter {
  /** Snapshot for `useSyncExternalStore`: the same object until the state changes. */
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  /** Restores a stored session (AC4). Safe to call more than once. */
  init(): Promise<void>;
  /** Sends a 6-digit code by email (AC1). */
  sendEmailCode(email: string): Promise<void>;
  /** Signs in with the code; throws `invalid_code` / `expired_code` (AC2). */
  verifyEmailCode(email: string, code: string): Promise<void>;
  /** AC3. */
  signInWithGoogle(): Promise<void>;
  /** Removes the session from the device (AC4). */
  signOut(): Promise<void>;
  getAccessToken(): Promise<string | null>;
}
