import type { AuthAdmin } from '../deps';

/**
 * Supabase Auth admin API with the service-role key (server only, never in the app bundle).
 * Deleting the auth user cascades to every user row; `ai_usage.user_id` is set to null (AC24).
 */
export function createSupabaseAuthAdmin(options: {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): AuthAdmin {
  const base = options.supabaseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
  };

  return {
    async deleteUser(userId) {
      const res = await fetchImpl(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers,
      });
      // 404: already deleted (e.g. a retried request) — the outcome the user asked for.
      if (!res.ok && res.status !== 404) {
        throw new Error(`Supabase admin deleteUser failed with HTTP ${res.status}`);
      }
    },
  };
}
