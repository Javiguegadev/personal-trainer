import { CONSENT_VERSION, type ProfileInput } from '@pt/contracts';
import { describe, expect, it, vi } from 'vitest';
import { isApiError } from '../client';
import { profileInput } from '../test/fixtures';
import { createMockApiClient, MOCK_DB_KEY, type KeyValueStorage } from './backend';
import { mockAccessToken, mockUserFromEmail } from './identity';

const NOW = new Date('2026-11-11T10:00:00.000Z');
const user = mockUserFromEmail('ana@example.com');

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function setup(opts: { token?: string | null; storage?: KeyValueStorage; now?: () => Date } = {}) {
  const onUnauthorized = vi.fn();
  const token = opts.token === undefined ? mockAccessToken(user) : opts.token;
  const api = createMockApiClient({
    getAccessToken: async () => token,
    onUnauthorized,
    now: opts.now ?? (() => NOW),
    ...(opts.storage ? { storage: opts.storage } : {}),
  });
  return { api, onUnauthorized };
}

const input = (overrides: Partial<ProfileInput> = {}): ProfileInput => ({
  ...profileInput,
  ...overrides,
});

describe('mock backend: auth and consent', () => {
  it('returns 401 and calls onUnauthorized without a mock token (AC5)', async () => {
    const { api, onUnauthorized } = setup({ token: null });
    const error = await api.me().catch((e: unknown) => e);
    expect(isApiError(error, 'unauthorized')).toBe(true);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('starts a new user without consent or onboarding', async () => {
    const { api } = setup();
    await expect(api.me()).resolves.toMatchObject({
      userId: user.userId,
      consent: { healthData: false, version: null },
      onboardingCompleted: false,
      profile: null,
      targets: null,
    });
  });

  it('requires consent for health-data routes (AC7)', async () => {
    const { api } = setup();
    for (const call of [() => api.targetsPreview(input()), () => api.updateProfile(input())]) {
      const error = await call().catch((e: unknown) => e);
      expect(isApiError(error, 'consent_required')).toBe(true);
    }
  });

  it('records consent and reports it in /me (AC6)', async () => {
    const { api } = setup();
    await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    await expect(api.me()).resolves.toMatchObject({
      consent: { healthData: true, version: CONSENT_VERSION },
    });
  });
});

describe('mock backend: consent version (spec 002 AC14)', () => {
  it('rejects a consent for an older version of the text', async () => {
    const { api } = setup();
    const error = await api
      .grantConsent({ kind: 'health_data', version: '2026-11' } as never)
      .catch((e: unknown) => e);
    expect(isApiError(error, 'validation_error')).toBe(true);
    await expect(api.me()).resolves.toMatchObject({ consent: { healthData: false } });
  });

  it('asks again when the stored consent is for an older version, keeping the data', async () => {
    const storage = memoryStorage();
    const { api } = setup({ storage });
    await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    await api.updateProfile(input());
    // Rewrite the stored consent as if it had been given to the previous text.
    storage.setItem(
      MOCK_DB_KEY,
      (storage.getItem(MOCK_DB_KEY) ?? '').replaceAll(CONSENT_VERSION, '2026-11'),
    );

    const reloaded = setup({ storage }).api;
    await expect(reloaded.me()).resolves.toMatchObject({
      consent: { healthData: false, version: '2026-11' },
      onboardingCompleted: true,
    });
    const error = await reloaded.updateProfile(input()).catch((e: unknown) => e);
    expect(isApiError(error, 'consent_required')).toBe(true);

    await reloaded.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    await expect(reloaded.me()).resolves.toMatchObject({ consent: { healthData: true } });
  });
});

describe('mock backend: profile and targets', () => {
  async function consented(opts: Parameters<typeof setup>[0] = {}) {
    const s = setup(opts);
    await s.api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    return s;
  }

  it('previews targets without storing anything (AC10)', async () => {
    const { api } = await consented();
    const preview = await api.targetsPreview(input());
    expect(preview.targets?.formulaVersion).toBe('targets-v2');
    expect((await api.me()).onboardingCompleted).toBe(false);
  });

  it('counts the job and the weekly training in the preview (spec 002 AC6, AC7)', async () => {
    const { api } = await consented();
    const seated = await api.targetsPreview(input());
    const active = await api.targetsPreview(
      input({
        jobActivity: 'physical',
        plannedActivities: [
          {
            kind: 'sport',
            label: 'fútbol',
            sessionsPerWeek: 2,
            minutesPerSession: 90,
            intensity: 'moderate',
          },
        ],
      }),
    );
    expect(seated.breakdown).toMatchObject({ jobFactor: 1.4, trainingFactor: 0 });
    expect(active.breakdown?.jobFactor).toBe(1.8);
    expect(active.targets?.kcal).toBeGreaterThan(seated.targets?.kcal ?? Infinity);
  });

  it('stores the job and the training list and returns them in /me and the export (spec 002 AC5, AC16)', async () => {
    const { api } = await consented();
    const plannedActivities = [
      {
        kind: 'strength' as const,
        label: null,
        sessionsPerWeek: 3,
        minutesPerSession: 60,
        intensity: 'moderate' as const,
      },
    ];
    const me = await api.updateProfile(input({ jobActivity: 'standing', plannedActivities }));
    expect(me.profile).toMatchObject({ jobActivity: 'standing', plannedActivities });
    expect((await api.exportData()).profile).toMatchObject({
      jobActivity: 'standing',
      plannedActivities,
    });
  });

  it('returns 400 for a training list above the weekly limit (spec 002 AC4)', async () => {
    const { api } = await consented();
    const error = await api
      .targetsPreview(
        input({
          plannedActivities: [
            {
              kind: 'cardio',
              label: null,
              sessionsPerWeek: 6,
              minutesPerSession: 240,
              intensity: 'light',
            },
          ],
        }),
      )
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 400, fields: { plannedActivities: 'too_big' } });
  });

  it('returns 400 with field errors for implausible values (AC22)', async () => {
    const { api } = await consented();
    const error = await api.targetsPreview(input({ heightCm: 250 })).catch((e: unknown) => e);
    expect(isApiError(error, 'validation_error')).toBe(true);
    expect(error).toMatchObject({ status: 400, fields: { heightCm: 'too_big' } });
  });

  it('returns 422 age_blocked under 16 and stores nothing (AC17)', async () => {
    const { api } = await consented();
    const error = await api
      .updateProfile(input({ birthDate: '2012-01-01' }))
      .catch((e: unknown) => e);
    expect(isApiError(error, 'age_blocked')).toBe(true);
    expect((await api.me()).profile).toBeNull();
  });

  it('saves the profile, completes onboarding and keeps the targets history (AC16)', async () => {
    let now = NOW;
    const { api } = await consented({ now: () => now });
    const first = await api.updateProfile(input());
    expect(first.onboardingCompleted).toBe(true);
    expect(first.targets?.validFrom).toBe(NOW.toISOString());

    now = new Date('2026-11-12T10:00:00.000Z');
    const second = await api.updateProfile(input({ weightKg: 70, today: '2026-11-12' }));
    expect(second.targets?.kcal).not.toBe(first.targets?.kcal);
    expect(second.profile?.onboardingCompletedAt).toBe(NOW.toISOString());

    const exported = await api.exportData();
    expect(exported.targets).toHaveLength(2);
    expect(exported.targets[0]?.validTo).toBe(now.toISOString());
    expect(exported.targets[1]?.validTo).toBeNull();
  });

  it('stores no numeric targets for pregnancy (AC19)', async () => {
    const { api } = await consented();
    const me = await api.updateProfile(input({ healthFlags: ['pregnancy'] }));
    expect(me.targets).toBeNull();
    expect(me.profile?.safetyFlags).toContain('pregnancy');
  });

  it('exports every row and deletes the account (AC23, AC24)', async () => {
    const storage = memoryStorage();
    const { api } = await consented({ storage });
    await api.updateProfile(input());
    const exported = await api.exportData();
    expect(exported).toMatchObject({ userId: user.userId, email: user.email });
    expect(exported.consents).toHaveLength(1);

    await api.deleteAccount();
    expect(storage.data.get(MOCK_DB_KEY)).not.toContain(user.userId);
    await expect(api.me()).resolves.toMatchObject({
      consent: { healthData: false },
      profile: null,
    });
  });

  it('persists the database in the given storage', async () => {
    const storage = memoryStorage();
    const { api } = await consented({ storage });
    await api.updateProfile(input());
    const reloaded = setup({ storage }).api;
    await expect(reloaded.me()).resolves.toMatchObject({ onboardingCompleted: true });
  });
});
