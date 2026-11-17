/**
 * Supabase client for iOS and Android (Expo guide "Using Supabase"): the session lives in expo-sqlite's
 * localStorage, and the token refresh loop runs only while the app is in the foreground.
 * Google (AC3) opens Google in an in-app browser session; Supabase sends the browser back to the app's
 * URL (`exp://…/--/` in Expo Go, `personaltrainer://` in a build) with a PKCE code, which becomes a
 * session here. Both URLs are in the Supabase redirect allow list.
 */
import { createClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { AppState } from 'react-native';
import '../storage';
import { AuthError } from './types';

export function createSupabaseClient(url: string, key: string) {
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
    if (result.type !== 'success') throw new AuthError('cancelled');
    const params = new URL(result.url).searchParams;
    if (params.get('error') === 'access_denied') throw new AuthError('cancelled');
    const code = params.get('code');
    if (!code) throw new AuthError('unknown');
    const exchanged = await client.auth.exchangeCodeForSession(code);
    if (exchanged.error) throw exchanged.error;
  }

  return { auth: client.auth, signInWithGoogle };
}
