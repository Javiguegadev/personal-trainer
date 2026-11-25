import { EMPTY_WEEK, type Profile, type ProfileInput, type SafetyFlag } from '@pt/contracts';
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
  trainingFocus: 'general_fitness',
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
    trainingFocus: input.trainingFocus,
    safetyFlags: evaluation.flags,
    injuries: input.injuries,
    units: input.units,
    locale: input.locale,
    onboardingCompletedAt: NOW.toISOString(),
    week: EMPTY_WEEK,
    trainingExperience: null,
    equipmentAccess: null,
    energyCalibrationKcal: 0,
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
        // The weight behind `current`, for the carbohydrate notice of spec 004 (AC8).
        weightKg: 66,
      },
    });
    expect(viaForm.targets?.kcal).toBeLessThan(before.targets?.kcal ?? 0);
  });

  it('keeps what the user trains for (spec 004 AC10)', () => {
    const hypertrophy = { trainingFocus: 'hypertrophy' as const };
    const before = stored(70, hypertrophy);
    const viaForm = stored(66, hypertrophy);
    const change = applyLatestWeight(before.profile, before.targets, entry(66), TODAY);
    expect(change?.targetsChange?.current).toEqual(viaForm.targets);
    expect(viaForm.targets).toMatchObject({ proteinG: 132, formulaVersion: 'targets-v4' }); // 2.0 × 66

    // A profile without a focus (never after migration 0004) counts as health and general fitness.
    const untagged = { ...before.profile, trainingFocus: null };
    expect(
      applyLatestWeight(untagged, before.targets, entry(66), TODAY)?.targetsChange?.current,
    ).toEqual(stored(66).targets);
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

  it('removes the deficit on one reading below BMI 20, restores it only on the 7-day average (AC12)', () => {
    // 165 cm: BMI 20 is 54.45 kg; BMI 20.5 is 55.81 kg.
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
    const lowTargets = low.targetsChange?.current ?? null;

    // One reading above the threshold, even well above: still no deficit.
    const one = applyLatestWeight(lowProfile, lowTargets, entry(57), TODAY, [entry(57)]);
    expect(one?.goal).toBe('maintain');
    expect(one?.safetyFlags).toContain('low_bmi');

    // A 7-day average of 55.7 kg (BMI 20.46): still no deficit.
    const close = [entry(55.6, '2026-11-07'), entry(55.7, '2026-11-09'), entry(55.8)];
    expect(applyLatestWeight(lowProfile, lowTargets, entry(55.8), TODAY, close)?.goal).toBe(
      'maintain',
    );

    // A 7-day average of 55.9 kg (BMI 20.53): the deficit comes back.
    const above = [entry(55.8, '2026-11-07'), entry(55.9, '2026-11-09'), entry(56)];
    const back = applyLatestWeight(lowProfile, lowTargets, entry(56), TODAY, above);
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
