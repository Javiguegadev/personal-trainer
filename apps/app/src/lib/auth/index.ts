import { MOCK_BACKEND } from '../backend';
import { storage } from '../storage';
import { createMockAuth } from './mock';
import { createSupabaseAuth } from './supabase';
import { createSupabaseClient } from './supabaseClient';
import type { AuthAdapter } from './types';
import { createUnconfiguredAuth } from './unconfigured';

export { AuthError, type AuthAdapter, type AuthSession, type AuthState } from './types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

function createAuth(): AuthAdapter {
  if (MOCK_BACKEND) return createMockAuth({ storage, latencyMs: 400 });
  if (!supabaseUrl || !supabaseKey) return createUnconfiguredAuth();
  return createSupabaseAuth(createSupabaseClient(supabaseUrl, supabaseKey));
}

/** The app's single auth instance: mock in demo mode, Supabase when its URL and key are set. */
export const auth: AuthAdapter = createAuth();

void auth.init();
