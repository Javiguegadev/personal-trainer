import type { AiUsage } from '@pt/ai';
import type { ConsentKind, ProfileInput } from '@pt/contracts';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createApp } from '../app';
import type { AuthAdmin, Deps, ExportRecord, MeRecord, OnboardingAi, Store } from '../deps';
import { createJwtVerifier } from '../middleware/auth';

export const NOW = new Date('2026-11-11T10:00:00Z');
export const TODAY = '2026-11-11';
export const USER_ID = '6f1c1b1e-8f3a-4d2b-9a43-1e2f3a4b5c6d';
export const OTHER_USER_ID = '0b7a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ISSUER = 'https://test.supabase.co/auth/v1';

interface UserRows {
  consents: ExportRecord['consents'];
  profile: MeRecord['profile'];
  dietaryPrefs: MeRecord['dietaryPrefs'];
  targets: ExportRecord['targets'];
  aiUsage: (AiUsage & { createdAt: string })[];
}

/** In-memory Store with the same semantics as the Drizzle one (targets history, sticky completion). */
export class FakeStore implements Store {
  readonly users = new Map<string, UserRows>();

  rows(userId: string): UserRows {
    let rows = this.users.get(userId);
    if (!rows) {
      rows = { consents: [], profile: null, dietaryPrefs: null, targets: [], aiUsage: [] };
      this.users.set(userId, rows);
    }
    return rows;
  }

  async getMe(userId: string): Promise<MeRecord> {
    const rows = this.rows(userId);
    const consent = rows.consents.findLast((c) => c.kind === 'health_data' && !c.revokedAt);
    const current = rows.targets.find((t) => t.validTo === null);
    return {
      consentVersion: consent?.version ?? null,
      profile: rows.profile,
      dietaryPrefs: rows.dietaryPrefs,
      targets: current ? (({ validTo: _, ...t }) => t)(current) : null,
    };
  }

  async hasConsent(userId: string, kind: ConsentKind) {
    return this.rows(userId).consents.some((c) => c.kind === kind && !c.revokedAt);
  }

  async grantConsent(userId: string, kind: ConsentKind, version: string, at: Date) {
    this.rows(userId).consents.push({
      kind,
      version,
      grantedAt: at.toISOString(),
      revokedAt: null,
    });
  }

  async getSafetyFlags(userId: string) {
    return this.rows(userId).profile?.safetyFlags ?? [];
  }

  async saveProfile(userId: string, data: Parameters<Store['saveProfile']>[1], at: Date) {
    const rows = this.rows(userId);
    const iso = at.toISOString();
    rows.profile = {
      ...data.profile,
      onboardingCompletedAt: rows.profile?.onboardingCompletedAt ?? iso,
    };
    rows.dietaryPrefs = data.dietaryPrefs;
    for (const t of rows.targets) if (t.validTo === null) t.validTo = iso;
    if (data.targets) rows.targets.push({ ...data.targets, validFrom: iso, validTo: null });
  }

  async countAiCalls(userId: string, feature: string, since: Date) {
    return this.rows(userId).aiUsage.filter(
      (u) => u.feature === feature && u.createdAt >= since.toISOString(),
    ).length;
  }

  async recordAiUsage(userId: string, usage: AiUsage, at: Date) {
    this.rows(userId).aiUsage.push({ ...usage, createdAt: at.toISOString() });
  }

  async exportUser(userId: string): Promise<ExportRecord> {
    const rows = this.rows(userId);
    return {
      profile: rows.profile,
      dietaryPrefs: rows.dietaryPrefs,
      targets: rows.targets,
      consents: rows.consents,
      aiUsage: rows.aiUsage.map((u) => ({
        feature: u.feature,
        model: u.model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        createdAt: u.createdAt,
      })),
    };
  }
}

export async function createTestTokens() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' };
  const verifyToken = createJwtVerifier({
    jwks: createLocalJWKSet({ keys: [jwk] }),
    issuer: ISSUER,
  });

  async function sign(
    claims: { sub?: string; email?: string; aud?: string; iss?: string } = {},
    expiresAt: Date = new Date(Date.now() + 3600_000),
  ) {
    return new SignJWT({ email: claims.email ?? 'ana@example.com', role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setSubject(claims.sub ?? USER_ID)
      .setIssuer(claims.iss ?? ISSUER)
      .setAudience(claims.aud ?? 'authenticated')
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(privateKey);
  }

  return { verifyToken, sign };
}

export async function createTestApp(overrides: { onboardingAi?: OnboardingAi } = {}) {
  const store = new FakeStore();
  const deleted: string[] = [];
  const authAdmin: AuthAdmin = {
    async deleteUser(userId) {
      // Mirrors the DB: cascade on everything except ai_usage, which only loses its user id.
      deleted.push(userId);
      store.users.delete(userId);
    },
  };
  const tokens = await createTestTokens();
  const deps: Deps = {
    verifyToken: tokens.verifyToken,
    store,
    authAdmin,
    onboardingAi: overrides.onboardingAi ?? null,
    now: () => NOW,
  };
  const app = createApp({ webOrigins: ['http://localhost:8081'], version: 'test', deps });
  const token = await tokens.sign();

  async function call(method: string, path: string, body?: unknown, bearer: string | null = token) {
    const headers: Record<string, string> = {};
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  return { app, store, deleted, tokens, token, call };
}

/** A valid adult profile (35-year-old woman, 165 cm, 70 kg, moderate, lose). */
export function profileInput(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    sex: 'female',
    birthDate: '1991-05-20',
    heightCm: 165,
    weightKg: 70,
    targetWeightKg: 62,
    activityLevel: 'moderate',
    goal: 'lose',
    injuries: null,
    healthFlags: [],
    units: 'metric',
    locale: 'es',
    dietaryPrefs: { dietType: 'omnivore', allergies: [], dislikes: [], restrictions: [] },
    today: TODAY,
    ...overrides,
  };
}
