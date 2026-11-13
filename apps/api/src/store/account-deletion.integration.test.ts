/**
 * AC24 against the real dev database: deleting the auth user leaves no row that references it, and
 * `ai_usage` rows survive without a user id. Opt-in (it creates and deletes a real auth user):
 *
 *   pnpm --filter @pt/api test:integration
 *
 * Skipped unless DATABASE_URL, SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY
 * are set. Never point it at production.
 */
import { CONSENT_VERSION } from '@pt/contracts';
import { createDb, eq, schema, sql } from '@pt/db';
import { afterAll, describe, expect, it } from 'vitest';
import { profileInput } from '../test/fakes';
import { createDrizzleStore } from './drizzle-store';
import { createSupabaseAuthAdmin } from './supabase-admin';

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const { DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const enabled = Boolean(supabaseUrl && DATABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

/** Every table that holds user rows. Add a table here only together with its rows in the test below. */
const COVERED_USER_TABLES = [
  'profiles',
  'body_measurements',
  'lifestyle_profiles',
  'planned_activities',
  'dietary_prefs',
  'nutrition_targets',
  'consents',
  'ai_usage',
] as const;

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
    const TODAY = now.toISOString().slice(0, 10);
    const input = profileInput();
    await store.grantConsent(id, 'health_data', CONSENT_VERSION, now);
    await store.saveProfile(
      id,
      {
        profile: {
          sex: input.sex,
          birthDate: input.birthDate,
          heightCm: input.heightCm,
          weightKg: input.weightKg,
          targetWeightKg: input.targetWeightKg,
          jobActivity: 'standing',
          plannedActivities: [
            {
              kind: 'sport',
              label: 'fútbol',
              sessionsPerWeek: 2,
              minutesPerSession: 90,
              intensity: 'moderate',
            },
          ],
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
          formulaVersion: 'targets-v2',
          clampedReason: null,
        },
        today: TODAY,
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
    const me = await store.getMe(id);
    expect(me.targets?.kcal).toBe(1800);
    expect(me.profile).toMatchObject({
      jobActivity: 'standing',
      plannedActivities: [{ kind: 'sport', label: 'fútbol', sessionsPerWeek: 2 }],
    });
    expect((await store.exportUser(id)).profile?.plannedActivities).toHaveLength(1);

    // Spec 003: the profile save stored today's entry (AC13); a write recorded earlier loses (AC20);
    // the latest weight reaches the profile and the targets in one transaction (AC10).
    expect(await store.listWeights(id, TODAY, TODAY)).toEqual([
      { localDate: TODAY, weightKg: input.weightKg, recordedAt: now.toISOString() },
    ]);
    const stale = await store.writeWeight(
      id,
      {
        localDate: TODAY,
        recentFrom: TODAY,
        entry: { weightKg: 90, recordedAt: new Date(now.getTime() - 60_000).toISOString() },
      },
      () => null,
      now,
    );
    expect(stale?.entry?.weightKg).toBe(input.weightKg);
    const later = new Date(now.getTime() + 1000);
    const written = await store.writeWeight(
      id,
      {
        localDate: TODAY,
        recentFrom: TODAY,
        entry: { weightKg: 69.4, recordedAt: later.toISOString() },
      },
      ({ profile, latest }) => ({
        weightKg: latest?.weightKg ?? profile.weightKg,
        goal: 'maintain',
        safetyFlags: ['low_bmi'],
        newTargets: {
          kcal: 2000,
          proteinG: 120,
          carbsG: 240,
          fatG: 60,
          fiberG: 28,
          formulaVersion: 'targets-v2',
          clampedReason: null,
        },
      }),
      later,
    );
    expect(written).toMatchObject({ entry: { weightKg: 69.4 }, previousTargets: { kcal: 1800 } });
    expect(await store.getSafetyContext(id, TODAY)).toMatchObject({
      flags: ['low_bmi'],
      weightKg: 69.4,
      weights: [{ localDate: TODAY, weightKg: 69.4 }],
    });
    const after = await store.getMe(id);
    expect(after.profile).toMatchObject({
      weightKg: 69.4,
      goal: 'maintain',
      safetyFlags: ['low_bmi'],
    });
    expect(after.targets?.kcal).toBe(2000);
    const exported = await store.exportUser(id);
    expect(exported.weights).toHaveLength(1);
    expect(exported.targets).toHaveLength(2);
    const removed = await store.writeWeight(
      id,
      { localDate: TODAY, recentFrom: TODAY, entry: null },
      () => null,
      later,
    );
    expect(removed).toMatchObject({ entry: null });
    // Deleting again succeeds (AC9); put one back so the cascade below has a row to remove.
    await store.writeWeight(
      id,
      { localDate: TODAY, recentFrom: TODAY, entry: null },
      () => null,
      later,
    );
    await store.writeWeight(
      id,
      {
        localDate: TODAY,
        recentFrom: TODAY,
        entry: { weightKg: 70, recordedAt: later.toISOString() },
      },
      () => null,
      later,
    );

    // Spec 002 AC16: the list of user tables comes from the database, so a new table with a user
    // column that is not covered below fails this test.
    const userTables = await db.execute<{ table_name: string; column_name: string }>(sql`
      select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and (c.column_name = 'user_id' or (c.table_name = 'profiles' and c.column_name = 'id'))
      order by c.table_name`);
    expect(userTables.map((t) => t.table_name)).toEqual([...COVERED_USER_TABLES].sort());

    await createSupabaseAuthAdmin({ supabaseUrl: base, serviceRoleKey: key }).deleteUser(id);
    userId = null;

    const [authUser] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from auth.users where id = ${id}`,
    );
    expect(authUser?.n).toBe(0);
    for (const { table_name, column_name } of userTables) {
      const [left] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table_name)} where ${sql.identifier(column_name)} = ${id}`,
      );
      expect(left?.n, `rows left in ${table_name}`).toBe(0);
    }

    const [kept] = await db
      .select({ userId: schema.aiUsage.userId })
      .from(schema.aiUsage)
      .where(eq(schema.aiUsage.id, (usageRow as { id: string }).id));
    expect(kept).toEqual({ userId: null });
    await db.delete(schema.aiUsage).where(eq(schema.aiUsage.id, (usageRow as { id: string }).id));
  }, 30_000);
});
