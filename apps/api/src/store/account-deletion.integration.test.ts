/**
 * AC24 against the real dev database: deleting the auth user leaves no row that references it, and
 * `ai_usage` rows survive without a user id. Opt-in (it creates and deletes a real auth user):
 *
 *   pnpm --filter @pt/api test:integration
 *
 * Skipped unless DATABASE_URL, SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY
 * are set. Never point it at production.
 */
import { createDb, eq, schema, sql } from '@pt/db';
import { afterAll, describe, expect, it } from 'vitest';
import { profileInput } from '../test/fakes';
import { createDrizzleStore } from './drizzle-store';
import { createSupabaseAuthAdmin } from './supabase-admin';

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const { DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const enabled = Boolean(supabaseUrl && DATABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

describe.skipIf(!enabled)('account deletion (AC24, dev DB)', () => {
  const db = enabled ? createDb(DATABASE_URL as string) : (null as never);
  let userId: string | null = null;

  afterAll(async () => {
    if (userId) {
      await createSupabaseAuthAdmin({
        supabaseUrl: supabaseUrl as string,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY as string,
      }).deleteUser(userId);
    }
    await db?.$client.end();
  });

  it('cascades every user row and unlinks ai_usage', async () => {
    const base = (supabaseUrl as string).replace(/\/+$/, '');
    const key = SUPABASE_SERVICE_ROLE_KEY as string;
    const created = await fetch(`${base}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `ac24-${crypto.randomUUID()}@example.test`,
        email_confirm: true,
      }),
    });
    expect(created.status).toBe(200);
    userId = ((await created.json()) as { id: string }).id;
    const id = userId;

    const store = createDrizzleStore(db);
    const now = new Date();
    const input = profileInput();
    await store.grantConsent(id, 'health_data', '2026-11', now);
    await store.saveProfile(
      id,
      {
        profile: {
          sex: input.sex,
          birthDate: input.birthDate,
          heightCm: input.heightCm,
          weightKg: input.weightKg,
          targetWeightKg: input.targetWeightKg,
          activityLevel: input.activityLevel,
          requestedGoal: input.goal,
          goal: input.goal,
          safetyFlags: [],
          injuries: null,
          units: input.units,
          locale: input.locale,
        },
        dietaryPrefs: input.dietaryPrefs,
        targets: {
          kcal: 1800,
          proteinG: 126,
          carbsG: 196,
          fatG: 50,
          fiberG: 25,
          formulaVersion: 'targets-v1',
          clampedReason: null,
        },
      },
      now,
    );
    await store.recordAiUsage(
      id,
      {
        feature: 'onboarding',
        model: 'claude-haiku-5-5',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        latencyMs: 1,
        status: 'ok',
      },
      now,
    );
    const [usageRow] = await db
      .select({ id: schema.aiUsage.id })
      .from(schema.aiUsage)
      .where(eq(schema.aiUsage.userId, id));
    expect(usageRow).toBeDefined();
    expect((await store.getMe(id)).targets?.kcal).toBe(1800);

    await createSupabaseAuthAdmin({ supabaseUrl: base, serviceRoleKey: key }).deleteUser(id);
    userId = null;

    const counts = await db.execute<{ n: number }>(sql`
      select (
        (select count(*) from auth.users where id = ${id}) +
        (select count(*) from profiles where id = ${id}) +
        (select count(*) from dietary_prefs where user_id = ${id}) +
        (select count(*) from nutrition_targets where user_id = ${id}) +
        (select count(*) from consents where user_id = ${id}) +
        (select count(*) from ai_usage where user_id = ${id})
      )::int as n`);
    expect(counts[0]?.n).toBe(0);

    const [kept] = await db
      .select({ userId: schema.aiUsage.userId })
      .from(schema.aiUsage)
      .where(eq(schema.aiUsage.id, (usageRow as { id: string }).id));
    expect(kept).toEqual({ userId: null });
    await db.delete(schema.aiUsage).where(eq(schema.aiUsage.id, (usageRow as { id: string }).id));
  }, 30_000);
});
