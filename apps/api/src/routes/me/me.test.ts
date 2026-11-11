import {
  ApiErrorSchema,
  CONSENT_VERSION,
  ExportResponseSchema,
  MeResponseSchema,
} from '@pt/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_ID, createTestApp, profileInput } from '../../test/fakes';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

const consent = () =>
  t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });

async function errorOf(res: Response) {
  return ApiErrorSchema.parse(await res.json());
}

describe('auth (AC5)', () => {
  it.each([
    ['GET', '/me'],
    ['POST', '/me/consent'],
    ['PUT', '/me/profile'],
    ['GET', '/me/export'],
    ['DELETE', '/me'],
  ])('%s %s without a token → 401', async (method, path) => {
    const res = await t.call(method, path, undefined, null);
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('unauthorized');
  });

  it('rejects an expired token', async () => {
    const expired = await t.tokens.sign({}, new Date(Date.now() - 60_000));
    expect((await t.call('GET', '/me', undefined, expired)).status).toBe(401);
  });

  it('rejects a token for another audience or issuer', async () => {
    const anon = await t.tokens.sign({ aud: 'anon' });
    const foreign = await t.tokens.sign({ iss: 'https://evil.example/auth/v1' });
    expect((await t.call('GET', '/me', undefined, anon)).status).toBe(401);
    expect((await t.call('GET', '/me', undefined, foreign)).status).toBe(401);
  });

  it('rejects a garbage token', async () => {
    expect((await t.call('GET', '/me', undefined, 'not-a-jwt')).status).toBe(401);
  });
});

describe('GET /me + POST /me/consent (AC6)', () => {
  it('reports no consent and no onboarding for a new user', async () => {
    const res = await t.call('GET', '/me');
    expect(res.status).toBe(200);
    const me = MeResponseSchema.parse(await res.json());
    expect(me).toMatchObject({
      userId: USER_ID,
      consent: { healthData: false, version: null },
      onboardingCompleted: false,
      profile: null,
      targets: null,
    });
  });

  it('records consent', async () => {
    expect((await consent()).status).toBe(204);
    const me = MeResponseSchema.parse(await (await t.call('GET', '/me')).json());
    expect(me.consent).toEqual({ healthData: true, version: CONSENT_VERSION });
  });

  it('rejects an invalid consent body with 400', async () => {
    const res = await t.call('POST', '/me/consent', { kind: 'marketing' });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('validation_error');
  });
});

describe('PUT /me/profile', () => {
  it('requires consent (AC7) and stores nothing', async () => {
    const res = await t.call('PUT', '/me/profile', profileInput());
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('consent_required');
    expect(t.store.rows(USER_ID).profile).toBeNull();
  });

  it('stores profile, prefs and targets, and completes onboarding (AC10, AC13)', async () => {
    await consent();
    const res = await t.call('PUT', '/me/profile', profileInput());
    expect(res.status).toBe(200);
    const me = MeResponseSchema.parse(await res.json());
    expect(me.onboardingCompleted).toBe(true);
    expect(me.profile).toMatchObject({ requestedGoal: 'lose', goal: 'lose', heightCm: 165 });
    expect(me.targets).toMatchObject({ formulaVersion: 'targets-v1', clampedReason: null });
    expect(me.targets?.kcal).toBeGreaterThan(1200);
  });

  it('returns field errors for implausible values (AC22)', async () => {
    await consent();
    const res = await t.call('PUT', '/me/profile', profileInput({ heightCm: 250, weightKg: 20 }));
    expect(res.status).toBe(400);
    const body = await errorOf(res);
    expect(body.fields).toMatchObject({ heightCm: 'too_big', weightKg: 'too_small' });
  });

  it('rejects a birth date in the future (AC22)', async () => {
    await consent();
    const res = await t.call('PUT', '/me/profile', profileInput({ birthDate: '2026-12-01' }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ birthDate: 'in_future' });
  });

  it('rejects a client date more than a day away from the server date', async () => {
    await consent();
    const res = await t.call('PUT', '/me/profile', profileInput({ today: '2026-11-14' }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ today: 'implausible' });
  });

  it('blocks under-16s with 422 and stores nothing (AC17)', async () => {
    await consent();
    const res = await t.call('PUT', '/me/profile', profileInput({ birthDate: '2011-01-01' }));
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('age_blocked');
    expect(t.store.rows(USER_ID).profile).toBeNull();
    expect(t.store.rows(USER_ID).targets).toEqual([]);
  });

  it('applies limited mode to 16–17-year-olds (AC18)', async () => {
    await consent();
    const res = await t.call('PUT', '/me/profile', profileInput({ birthDate: '2009-06-01' }));
    const me = MeResponseSchema.parse(await res.json());
    expect(me.profile).toMatchObject({ requestedGoal: 'lose', goal: 'maintain' });
    expect(me.profile?.safetyFlags).toContain('teen_limited');
  });

  it('stores no targets when pregnancy is reported (AC19)', async () => {
    await consent();
    const res = await t.call('PUT', '/me/profile', profileInput({ healthFlags: ['pregnancy'] }));
    expect(res.status).toBe(200);
    const me = MeResponseSchema.parse(await res.json());
    expect(me.targets).toBeNull();
    expect(me.profile?.safetyFlags).toContain('pregnancy');
    expect(me.onboardingCompleted).toBe(true);
  });

  it('keeps ed_soft_stop once stored, whatever later edits say (AC20)', async () => {
    await consent();
    await t.call('PUT', '/me/profile', profileInput({ healthFlags: ['ed_soft_stop'] }));
    const res = await t.call('PUT', '/me/profile', profileInput({ healthFlags: [], goal: 'lose' }));
    const me = MeResponseSchema.parse(await res.json());
    expect(me.profile?.goal).toBe('maintain');
    expect(me.profile?.safetyFlags).toContain('ed_soft_stop');
  });

  it('stores injuries as free text and flags them (AC21)', async () => {
    await consent();
    const res = await t.call(
      'PUT',
      '/me/profile',
      profileInput({ injuries: '  rodilla izquierda ' }),
    );
    const me = MeResponseSchema.parse(await res.json());
    expect(me.profile?.injuries).toBe('rodilla izquierda');
    expect(me.profile?.safetyFlags).toContain('injury');
  });

  it('records calorie_floor when the targets were clamped (AC14)', async () => {
    await consent();
    const res = await t.call(
      'PUT',
      '/me/profile',
      profileInput({
        heightCm: 150,
        weightKg: 50,
        targetWeightKg: null,
        activityLevel: 'sedentary',
        birthDate: '1960-01-01',
      }),
    );
    const me = MeResponseSchema.parse(await res.json());
    expect(me.targets?.clampedReason).toBe('calorie_floor');
    expect(me.profile?.safetyFlags).toContain('calorie_floor');
  });

  it('keeps old targets with valid_to when the profile is edited (AC16)', async () => {
    await consent();
    await t.call('PUT', '/me/profile', profileInput());
    const res = await t.call(
      'PUT',
      '/me/profile',
      profileInput({ weightKg: 66, goal: 'maintain' }),
    );
    const me = MeResponseSchema.parse(await res.json());
    const history = t.store.rows(USER_ID).targets;
    expect(history).toHaveLength(2);
    expect(history[0]?.validTo).not.toBeNull();
    expect(history[1]?.validTo).toBeNull();
    expect(me.targets?.kcal).toBe(history[1]?.kcal);
    expect(me.targets?.kcal).not.toBe(history[0]?.kcal);
  });
});

describe('GET /me/export (AC23)', () => {
  it('returns every row as a JSON attachment', async () => {
    await consent();
    await t.call('PUT', '/me/profile', profileInput());
    const res = await t.call('GET', '/me/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename=".+\.json"$/);
    const body = ExportResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ userId: USER_ID, email: 'ana@example.com' });
    expect(body.profile).not.toBeNull();
    expect(body.dietaryPrefs).not.toBeNull();
    expect(body.targets).toHaveLength(1);
    expect(body.consents).toHaveLength(1);
  });
});

describe('DELETE /me (AC24)', () => {
  it('deletes the auth user and every row', async () => {
    await consent();
    await t.call('PUT', '/me/profile', profileInput());
    const res = await t.call('DELETE', '/me');
    expect(res.status).toBe(204);
    expect(t.deleted).toEqual([USER_ID]);
    expect(t.store.users.has(USER_ID)).toBe(false);
  });
});
