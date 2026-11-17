/**
 * Supabase client for the web: the session lives in the browser's localStorage. Google (AC3) leaves the
 * page for Google and comes back to this origin with a PKCE code, which the client turns into a session
 * when the app loads again (`detectSessionInUrl`). The origin is in the Supabase redirect allow list.
 */
import { createClient } from '@supabase/supabase-js';

export function createSupabaseClient(url: string, key: string) {
  const client = createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });

  async function signInWithGoogle(): Promise<void> {
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) throw error;
    // The browser is now leaving for Google; keep the button busy until the page unloads.
    await new Promise<never>(() => {});
  }

  return { auth: client.auth, signInWithGoogle };
}
