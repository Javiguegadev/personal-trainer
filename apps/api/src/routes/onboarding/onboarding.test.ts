import { ApiErrorSchema, CONSENT_VERSION, TargetsPreviewResponseSchema } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { USER_ID, createTestApp, profileInput } from '../../test/fakes';

async function setup() {
  const t = await createTestApp();
  await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });
  return t;
}

async function codeOf(res: Response) {
  return ApiErrorSchema.parse(await res.json()).code;
}

describe('POST /onboarding/chat (spec 002 AC15)', () => {
  it('no longer exists', async () => {
    const t = await setup();
    expect((await t.call('POST', '/onboarding/chat', {})).status).toBe(404);
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
    expect(body.targets?.formulaVersion).toBe('targets-v2');
    expect(body.breakdown?.ageYears).toBe(35);
    expect(body.safety).toMatchObject({ status: 'ok', appliedGoal: 'lose' });
    expect(t.store.rows(USER_ID).profile).toBeNull();
  });

  it('returns the job and training factors in the breakdown (spec 002 AC7, AC8)', async () => {
    const t = await setup();
    const preview = async (overrides: Parameters<typeof profileInput>[0]) => {
      const res = await t.call('POST', '/onboarding/targets-preview', profileInput(overrides));
      return TargetsPreviewResponseSchema.parse(await res.json());
    };
    const seated = await preview({});
    const physical = await preview({
      jobActivity: 'physical',
      plannedActivities: [
        {
          kind: 'strength',
          label: null,
          sessionsPerWeek: 4,
          minutesPerSession: 60,
          intensity: 'moderate',
        },
      ],
    });
    expect(seated.breakdown).toMatchObject({
      jobFactor: 1.4,
      trainingFactor: 0,
      activityFactor: 1.4,
    });
    expect(physical.breakdown).toMatchObject({
      jobFactor: 1.8,
      trainingFactor: 0.06,
      activityFactor: 1.86,
    });
    expect(physical.targets?.kcal).toBeGreaterThan(seated.targets?.kcal ?? Infinity);
  });

  it('400 for a training list above the weekly limit (spec 002 AC4)', async () => {
    const t = await setup();
    const res = await t.call(
      'POST',
      '/onboarding/targets-preview',
      profileInput({
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
    );
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(await res.json()).fields).toEqual({ plannedActivities: 'too_big' });
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
