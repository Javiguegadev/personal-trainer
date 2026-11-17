/**
 * Supabase client for iOS and Android (Expo guide "Using Supabase"): the session lives in expo-sqlite's
 * localStorage, and the token refresh loop runs only while the app is in the foreground.
 * Google (AC3) opens Google in an in-app browser session; Supabase sends the browser back to the app's
 * URL (`exp://…/--/` in Expo Go, `personaltrainer://` in a build) with a PKCE code, which becomes a
 * session here. Both URLs are in the Supabase redirect allow list.
 */
import { createClient } from '@supabase/supabase-js';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { AppState } from 'react-native';
import '../storage';
import { AuthError } from './types';

/**
 * React Native has `crypto.getRandomValues` but no `crypto.subtle`, so supabase-js would fall back to the
 * `plain` PKCE method. SHA-256 from expo-crypto lets it use `S256`, as on the web.
 */
function installSha256Digest() {
  const crypto = globalThis.crypto as { subtle?: unknown } | undefined;
  if (!crypto || crypto.subtle) return;
  crypto.subtle = {
    digest: (algorithm: string, data: BufferSource) => {
      if (algorithm !== 'SHA-256') throw new Error(`Unsupported digest: ${algorithm}`);
      return digest(CryptoDigestAlgorithm.SHA256, data);
    },
  };
}

/** Supabase may put the result in the query (PKCE) or in the fragment (errors); read both. */
function callbackParams(url: string): URLSearchParams {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);
  for (const [key, value] of new URLSearchParams(parsed.hash.replace(/^#/, ''))) {
    params.set(key, value);
  }
  return params;
}

export function createSupabaseClient(url: string, key: string) {
  installSha256Digest();
  const client = createClient(url, key, {
    auth: {
      storage: globalThis.localStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });

  AppState.addEventListener('change', (state) => {
    if (state === 'active') void client.auth.startAutoRefresh();
    else void client.auth.stopAutoRefresh();
  });

  async function signInWithGoogle(): Promise<void> {
    const redirectTo = Linking.createURL('/');
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (__DEV__) {
      console.info(`[auth] Google: redirect ${redirectTo}, browser result "${result.type}"`);
    }
    if (result.type !== 'success') throw new AuthError('cancelled');
    const params = callbackParams(result.url);
    const failure = params.get('error');
    if (failure) {
      if (failure === 'access_denied') throw new AuthError('cancelled');
      throw Object.assign(new Error(params.get('error_description') ?? failure), {
        code: params.get('error_code') ?? failure,
      });
    }
    const code = params.get('code');
    if (!code) throw new Error('Google sign-in came back without a code');
    const exchanged = await client.auth.exchangeCodeForSession(
      code,
      data.flowId ? { flowId: data.flowId } : undefined,
    );
    if (exchanged.error) throw exchanged.error;
  }

  return { auth: client.auth, signInWithGoogle };
}
