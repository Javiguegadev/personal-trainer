import { MOCK_BACKEND } from '../backend';
import { storage } from '../storage';
import { createMockAuth } from './mock';
import type { AuthAdapter } from './types';
import { createUnconfiguredAuth } from './unconfigured';

export { AuthError, type AuthAdapter, type AuthSession, type AuthState } from './types';

/** The app's single auth instance (mock in demo mode; Supabase once its prerequisites exist). */
export const auth: AuthAdapter = MOCK_BACKEND
  ? createMockAuth({ storage, latencyMs: 400 })
  : createUnconfiguredAuth();

void auth.init();
