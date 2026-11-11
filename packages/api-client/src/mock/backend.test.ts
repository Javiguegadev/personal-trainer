import type { OnboardingChatRequest, OnboardingDraft, ProfileInput } from '@pt/contracts';
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

const chatRequest = (messages: string[], draft: OnboardingDraft = {}): OnboardingChatRequest => ({
  messages: messages.map((content) => ({ role: 'user' as const, content })),
  draft,
  locale: 'es',
  today: '2026-11-11',
});

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
    for (const call of [
      () => api.onboardingChat(chatRequest(['hola'])),
      () => api.targetsPreview(input()),
      () => api.updateProfile(input()),
    ]) {
      const error = await call().catch((e: unknown) => e);
      expect(isApiError(error, 'consent_required')).toBe(true);
    }
  });

  it('records consent and reports it in /me (AC6)', async () => {
    const { api } = setup();
    await api.grantConsent({ kind: 'health_data', version: '2026-11' });
    await expect(api.me()).resolves.toMatchObject({
      consent: { healthData: true, version: '2026-11' },
    });
  });
});

describe('mock backend: profile and targets', () => {
  async function consented(opts: Parameters<typeof setup>[0] = {}) {
    const s = setup(opts);
    await s.api.grantConsent({ kind: 'health_data', version: '2026-11' });
    return s;
  }

  it('previews targets without storing anything (AC10)', async () => {
    const { api } = await consented();
    const preview = await api.targetsPreview(input());
    expect(preview.targets?.formulaVersion).toBe('targets-v1');
    expect((await api.me()).onboardingCompleted).toBe(false);
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

describe('mock backend: onboarding chat', () => {
  async function chatApi(now: () => Date = () => NOW) {
    const s = setup({ now });
    await s.api.grantConsent({ kind: 'health_data', version: '2026-11' });
    return s.api;
  }

  it('reaches a complete draft from a natural conversation (AC8, AC9)', async () => {
    const api = await chatApi();
    const messages = [
      'Hola',
      'Soy mujer y tengo 34 años',
      'Mido 1,68 m y peso 64,5 kilos',
      'Moderadamente activa',
      'Quiero perder peso',
      'Como de todo, soy alérgica a los cacahuetes',
    ];
    let draft: OnboardingDraft = {};
    let response = await api.onboardingChat(chatRequest(messages.slice(0, 1), draft));
    for (let i = 2; i <= messages.length; i++) {
      draft = response.draft;
      response = await api.onboardingChat(chatRequest(messages.slice(0, i), draft));
    }
    expect(response.missing).toEqual([]);
    expect(response.draft).toMatchObject({
      sex: 'female',
      birthDate: '1992-11-11',
      heightCm: 168,
      weightKg: 64.5,
      activityLevel: 'moderate',
      goal: 'lose',
      dietType: 'omnivore',
      allergies: ['cacahuetes'],
    });
  });

  it('converts imperial units with @pt/core (AC9)', async () => {
    const api = await chatApi();
    const response = await api.onboardingChat(chatRequest(['hello', "I'm 5 ft 10 and 180 lb"]));
    expect(response.draft.heightCm).toBe(177.8);
    expect(response.draft.weightKg).toBe(81.6);
  });

  it('raises the eating-disorder soft stop (AC20)', async () => {
    const api = await chatApi();
    const response = await api.onboardingChat(
      chatRequest(['hola', 'a veces me provoco el vómito']),
    );
    expect(response.softStop).toBe(true);
    expect(response.draft.healthFlags).toContain('ed_soft_stop');
  });

  it('simulates an AI outage with #503 (AC11)', async () => {
    const api = await chatApi();
    const error = await api.onboardingChat(chatRequest(['#503'])).catch((e: unknown) => e);
    expect(isApiError(error, 'ai_unavailable')).toBe(true);
  });

  it('caps onboarding messages at 40 per 24 h (AC12)', async () => {
    let now = NOW;
    const api = await chatApi(() => now);
    for (let i = 0; i < 40; i++) await api.onboardingChat(chatRequest(['hola']));
    const error = await api.onboardingChat(chatRequest(['hola'])).catch((e: unknown) => e);
    expect(isApiError(error, 'rate_limited')).toBe(true);

    now = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1000);
    await expect(
      api.onboardingChat({ ...chatRequest(['hola']), today: '2026-11-12' }),
    ).resolves.toBeDefined();
  });
});
