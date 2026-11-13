import type { Profile, ProfileInput, SafetyFlag } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { evaluateProfileInput } from '../profile/evaluate';
import { applyLatestWeight, checkWeightWrite } from './apply';

const NOW = new Date('2026-11-11T10:00:00.000Z');
const TODAY = '2026-11-11';

/** 36-year-old woman, 165 cm, seated job, no training, wants to lose weight. */
const form = (weightKg: number, overrides: Partial<ProfileInput> = {}): ProfileInput => ({
  sex: 'female',
  birthDate: '1990-05-01',
  heightCm: 165,
  weightKg,
  targetWeightKg: 60,
  jobActivity: 'sedentary',
  plannedActivities: [],
  goal: 'lose',
  injuries: null,
  healthFlags: [],
  units: 'metric',
  locale: 'es',
  dietaryPrefs: { dietType: 'omnivore', allergies: [], dislikes: [], restrictions: [] },
  today: TODAY,
  ...overrides,
});

/** The profile and targets the API stores when that form is saved. */
function stored(weightKg: number, overrides: Partial<ProfileInput> = {}) {
  const input = form(weightKg, overrides);
  const evaluation = evaluateProfileInput(input, [], NOW);
  if (evaluation.kind !== 'ok') throw new Error('fixture must be a valid profile');
  const profile: Profile = {
    sex: input.sex,
    birthDate: input.birthDate,
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    targetWeightKg: input.targetWeightKg,
    jobActivity: input.jobActivity,
    plannedActivities: input.plannedActivities,
    requestedGoal: input.goal,
    goal: evaluation.safety.appliedGoal,
    safetyFlags: evaluation.flags,
    injuries: input.injuries,
    units: input.units,
    locale: input.locale,
    onboardingCompletedAt: NOW.toISOString(),
  };
  return { profile, targets: evaluation.targets, safety: evaluation.safety };
}

const entry = (weightKg: number, localDate = TODAY) => ({ localDate, weightKg });

describe('applyLatestWeight (spec 003 AC10–AC13)', () => {
  it('gives the same profile and targets as saving the form with that weight', () => {
    const before = stored(70);
    const viaForm = stored(66);
    const change = applyLatestWeight(before.profile, before.targets, entry(66), TODAY);
    expect(change).toEqual({
      weightKg: 66,
      goal: viaForm.profile.goal,
      safetyFlags: viaForm.profile.safetyFlags,
      targetsChange: {
        previous: before.targets,
        current: viaForm.targets,
        safety: viaForm.safety,
      },
    });
    expect(viaForm.targets?.kcal).toBeLessThan(before.targets?.kcal ?? 0);
  });

  it('changes nothing without entries or with the same weight', () => {
    const { profile, targets } = stored(70);
    expect(applyLatestWeight(profile, targets, null, TODAY)).toBeNull();
    expect(applyLatestWeight(profile, targets, entry(70), TODAY)).toBeNull();
  });

  it('updates the weight without a targets change when the targets are the same numbers', () => {
    const { profile } = stored(70);
    const same = stored(69.9).targets;
    const change = applyLatestWeight(profile, same, entry(69.9), TODAY);
    expect(change).toMatchObject({ weightKg: 69.9, targetsChange: null });
  });

  it('removes the deficit below BMI 20 and restores it above (AC12)', () => {
    // 165 cm: BMI 20 is 54.45 kg.
    const before = stored(56);
    const low = applyLatestWeight(before.profile, before.targets, entry(54.4), TODAY);
    expect(low?.goal).toBe('maintain');
    expect(low?.safetyFlags).toContain('low_bmi');
    expect(low?.targetsChange?.safety.appliedGoal).toBe('maintain');

    if (!low) throw new Error('expected a change');
    const lowProfile: Profile = {
      ...before.profile,
      weightKg: low.weightKg,
      goal: low.goal,
      safetyFlags: low.safetyFlags,
    };
    const back = applyLatestWeight(
      lowProfile,
      low?.targetsChange?.current ?? null,
      entry(54.5),
      TODAY,
    );
    expect(back?.goal).toBe('lose');
    expect(back?.safetyFlags).not.toContain('low_bmi');
  });

  it.each(['ed_soft_stop', 'pregnancy', 'medical_condition'] as const)(
    'keeps the reported flag %s',
    (flag) => {
      const before = stored(70, { healthFlags: [flag] });
      const change = applyLatestWeight(before.profile, before.targets, entry(66), TODAY);
      expect(change?.safetyFlags).toContain<SafetyFlag>(flag);
      if (flag === 'pregnancy') expect(change?.targetsChange).toBeNull();
      if (flag === 'ed_soft_stop') expect(change?.goal).toBe('maintain');
    },
  );

  it('waits for the profile form on an account without a job (spec 002 AC17)', () => {
    const { profile, targets } = stored(70);
    expect(
      applyLatestWeight({ ...profile, jobActivity: null }, targets, entry(66), TODAY),
    ).toBeNull();
  });
});

describe('checkWeightWrite (AC7, AC20)', () => {
  const write = { localDate: TODAY, today: TODAY, recordedAt: NOW.toISOString() };

  it('accepts today and a device clock up to a day ahead', () => {
    expect(checkWeightWrite(write, NOW)).toBeNull();
    expect(checkWeightWrite({ ...write, recordedAt: '2026-11-12T09:59:00.000Z' }, NOW)).toBeNull();
  });

  it.each([
    [{ today: '2026-11-14' }, { today: 'implausible' }],
    [{ localDate: '2026-11-12' }, { localDate: 'in_future' }],
    [{ localDate: '2021-11-01' }, { localDate: 'too_old' }],
    [{ recordedAt: '2026-11-12T10:01:00.000Z' }, { recordedAt: 'in_future' }],
  ])('rejects %o', (overrides, fields) => {
    expect(checkWeightWrite({ ...write, ...overrides }, NOW)).toEqual(fields);
  });

  it('checks only the client date of a delete', () => {
    expect(checkWeightWrite({ localDate: '2010-01-01', today: TODAY }, NOW)).toBeNull();
    expect(checkWeightWrite({ localDate: TODAY, today: '2026-12-01' }, NOW)).toEqual({
      today: 'implausible',
    });
  });
});
