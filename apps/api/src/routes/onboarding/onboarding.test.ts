import { AiUnavailableError, type AiUsage, type OnboardingTurnResult } from '@pt/ai';
import {
  ApiErrorSchema,
  CONSENT_VERSION,
  OnboardingChatResponseSchema,
  TargetsPreviewResponseSchema,
  type OnboardingChatRequest,
} from '@pt/contracts';
import { describe, expect, it, vi } from 'vitest';
import { NOW, TODAY, USER_ID, createTestApp, profileInput } from '../../test/fakes';

const usage = (status: AiUsage['status'] = 'ok'): AiUsage => ({
  feature: 'onboarding',
  model: 'claude-haiku-5-5',
  inputTokens: 900,
  outputTokens: 120,
  costUsd: 0.00015,
  latencyMs: 800,
  status,
});

const chatRequest = (overrides: Partial<OnboardingChatRequest> = {}): OnboardingChatRequest => ({
  messages: [{ role: 'user', content: 'Soy mujer, 35 años, mido 1,65 y peso 70 kilos' }],
  draft: {},
  locale: 'es',
  today: TODAY,
  ...overrides,
});

async function setup(ai?: (req: OnboardingChatRequest) => Promise<OnboardingTurnResult>) {
  const onboardingAi = ai ? vi.fn(ai) : null;
  const t = await createTestApp({ onboardingAi });
  await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });
  return { ...t, onboardingAi };
}

const okTurn = async (): Promise<OnboardingTurnResult> => ({
  reply: '¡Gracias! ¿Cuánta actividad física haces?',
  draft: { sex: 'female', birthDate: '1991-01-01', heightCm: 165, weightKg: 70 },
  softStop: false,
  usage: usage(),
});

async function codeOf(res: Response) {
  return ApiErrorSchema.parse(await res.json()).code;
}

describe('POST /onboarding/chat', () => {
  it('401 without a token (AC5)', async () => {
    const t = await setup(okTurn);
    expect((await t.call('POST', '/onboarding/chat', chatRequest(), null)).status).toBe(401);
  });

  it('403 consent_required without consent (AC7)', async () => {
    const t = await createTestApp({ onboardingAi: okTurn });
    const res = await t.call('POST', '/onboarding/chat', chatRequest());
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('consent_required');
  });

  it('400 for an invalid body', async () => {
    const t = await setup(okTurn);
    const tooMany = Array.from({ length: 41 }, () => ({ role: 'user', content: 'hola' }));
    const res = await t.call('POST', '/onboarding/chat', { ...chatRequest(), messages: tooMany });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation_error');
  });

  it('400 for an implausible draft value (AC22)', async () => {
    const t = await setup(okTurn);
    const res = await t.call('POST', '/onboarding/chat', chatRequest({ draft: { heightCm: 500 } }));
    expect(res.status).toBe(400);
  });

  it('returns the reply, the draft and the missing fields, and meters the call (AC8)', async () => {
    const t = await setup(okTurn);
    const res = await t.call('POST', '/onboarding/chat', chatRequest());
    expect(res.status).toBe(200);
    const body = OnboardingChatResponseSchema.parse(await res.json());
    expect(body.missing).toEqual(['activityLevel', 'goal', 'dietType']);
    expect(body.softStop).toBe(false);
    expect(t.store.rows(USER_ID).aiUsage).toEqual([{ ...usage(), createdAt: NOW.toISOString() }]);
  });

  it('never sends the email or user id to the AI and stores no transcript (AC25)', async () => {
    const t = await setup(okTurn);
    await t.call('POST', '/onboarding/chat', chatRequest());
    const sent = JSON.stringify(t.onboardingAi?.mock.calls[0]?.[0]);
    expect(sent).not.toContain('ana@example.com');
    expect(sent).not.toContain(USER_ID);
    expect(JSON.stringify(t.store.rows(USER_ID))).not.toContain('mido 1,65');
  });

  it('passes the soft stop through (AC20)', async () => {
    const t = await setup(async () => ({
      ...(await okTurn()),
      draft: { healthFlags: ['ed_soft_stop'] },
      softStop: true,
    }));
    const body = OnboardingChatResponseSchema.parse(
      await (await t.call('POST', '/onboarding/chat', chatRequest())).json(),
    );
    expect(body.softStop).toBe(true);
  });

  it('429 after 40 calls in 24 h, without calling the AI (AC12)', async () => {
    const t = await setup(okTurn);
    const rows = t.store.rows(USER_ID).aiUsage;
    const recent = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    const old = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < 39; i++) rows.push({ ...usage(), createdAt: recent });
    rows.push({ ...usage(), createdAt: old });

    expect((await t.call('POST', '/onboarding/chat', chatRequest())).status).toBe(200);
    const res = await t.call('POST', '/onboarding/chat', chatRequest());
    expect(res.status).toBe(429);
    expect(await codeOf(res)).toBe('rate_limited');
    expect(t.onboardingAi).toHaveBeenCalledTimes(1);
  });

  it('503 when the AI is not configured (AC11)', async () => {
    const t = await setup();
    const res = await t.call('POST', '/onboarding/chat', chatRequest());
    expect(res.status).toBe(503);
    expect(await codeOf(res)).toBe('ai_unavailable');
  });

  it('503 and metered usage when the model fails (AC11)', async () => {
    const t = await setup(async () => {
      throw new AiUnavailableError('refusal', usage('refusal'), 'declined');
    });
    const res = await t.call('POST', '/onboarding/chat', chatRequest());
    expect(res.status).toBe(503);
    expect(t.store.rows(USER_ID).aiUsage[0]?.status).toBe('refusal');
  });

  it('503 and an error row on network failures', async () => {
    const t = await setup(async () => {
      throw new Error('ECONNRESET');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await t.call('POST', '/onboarding/chat', chatRequest());
    expect(res.status).toBe(503);
    expect(t.store.rows(USER_ID).aiUsage[0]).toMatchObject({ status: 'error', inputTokens: 0 });
  });
});

describe('POST /onboarding/targets-preview', () => {
  it('401 without a token', async () => {
    const t = await setup();
    const res = await t.call('POST', '/onboarding/targets-preview', profileInput(), null);
    expect(res.status).toBe(401);
  });

  it('403 without consent', async () => {
    const t = await createTestApp();
    expect((await t.call('POST', '/onboarding/targets-preview', profileInput())).status).toBe(403);
  });

  it('returns targets, breakdown and safety without storing anything (AC10, AC15)', async () => {
    const t = await setup();
    const res = await t.call('POST', '/onboarding/targets-preview', profileInput());
    expect(res.status).toBe(200);
    const body = TargetsPreviewResponseSchema.parse(await res.json());
    expect(body.targets?.formulaVersion).toBe('targets-v1');
    expect(body.breakdown?.ageYears).toBe(35);
    expect(body.safety).toMatchObject({ status: 'ok', appliedGoal: 'lose' });
    expect(t.store.rows(USER_ID).profile).toBeNull();
  });

  it('returns no numbers for pregnancy (AC19)', async () => {
    const t = await setup();
    const res = await t.call(
      'POST',
      '/onboarding/targets-preview',
      profileInput({ healthFlags: ['pregnancy'] }),
    );
    const body = TargetsPreviewResponseSchema.parse(await res.json());
    expect(body.targets).toBeNull();
    expect(body.breakdown).toBeNull();
    expect(body.safety.targetsAllowed).toBe(false);
  });

  it('applies no deficit for a low BMI (AC19)', async () => {
    const t = await setup();
    const res = await t.call(
      'POST',
      '/onboarding/targets-preview',
      profileInput({ weightKg: 50, targetWeightKg: null }),
    );
    const body = TargetsPreviewResponseSchema.parse(await res.json());
    expect(body.safety.appliedGoal).toBe('maintain');
    expect(body.safety.flags).toContain('low_bmi');
  });

  it('422 age_blocked under 16 (AC17)', async () => {
    const t = await setup();
    const res = await t.call(
      'POST',
      '/onboarding/targets-preview',
      profileInput({ birthDate: '2012-03-03' }),
    );
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('age_blocked');
  });
});
