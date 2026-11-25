import type { PlannedActivity, SafetyEvaluation, SafetyFlag } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../context/snapshot';
import { CALORIE_FLOOR, computeTargets, TARGETS_FORMULA_VERSION } from './targets';

/**
 * `targets-v4` (spec 014 AC5, AC8): the weekly reviews' accepted calibration is added to the TDEE
 * before the goal's deficit or surplus, so the deficit limits and the calorie floor still apply.
 */

const TODAY = '2026-11-25';

const safety = (
  goal: SafetyEvaluation['appliedGoal'],
  flags: SafetyFlag[] = [],
): SafetyEvaluation => ({
  status: 'ok',
  requestedGoal: goal,
  appliedGoal: goal,
  flags,
  maxSurplusRatio: null,
  targetsAllowed: true,
});

const gym: PlannedActivity = {
  kind: 'strength',
  label: null,
  sessionsPerWeek: 3,
  minutesPerSession: 60,
  intensity: 'moderate',
  days: [],
};

function targetsWith(
  calibrationKcal: number,
  goal: SafetyEvaluation['appliedGoal'],
  person: { sex: 'male' | 'female'; heightCm: number; weightKg: number } = {
    sex: 'male',
    heightCm: 178,
    weightKg: 80,
  },
  flags: SafetyFlag[] = [],
) {
  const snapshot = buildContextSnapshot(
    {
      profile: {
        ...person,
        birthDate: '1996-01-01',
        targetWeightKg: null,
        goal,
      },
      safetyFlags: [],
      jobActivity: 'sedentary',
      plannedActivities: [gym],
      trainingFocus: 'general_fitness',
      energyCalibrationKcal: calibrationKcal,
    },
    TODAY,
  );
  return computeTargets(snapshot, safety(goal, flags));
}

describe('targets-v4: the energy calibration (spec 014)', () => {
  it('stamps the new formula version', () => {
    expect(TARGETS_FORMULA_VERSION).toBe('targets-v4');
    expect(targetsWith(0, 'maintain').targets.formulaVersion).toBe('targets-v4');
  });

  it('without a calibration gives the targets-v3 numbers', () => {
    const { breakdown } = targetsWith(0, 'maintain');
    expect(breakdown.calibrationKcal).toBe(0);
    // The breakdown shows the BMR and the factor rounded: the TDEE is their product within 2 kcal.
    expect(
      Math.abs(breakdown.tdeeKcal - breakdown.bmrKcal * breakdown.activityFactor),
    ).toBeLessThan(2);
  });

  it('adds the calibration to the TDEE and shows it in the breakdown (AC8)', () => {
    const base = targetsWith(0, 'maintain');
    const lower = targetsWith(-100, 'maintain');
    expect(lower.breakdown.calibrationKcal).toBe(-100);
    expect(lower.breakdown.tdeeKcal).toBe(base.breakdown.tdeeKcal - 100);
    // Maintain: the target is the TDEE, rounded to 10 kcal.
    expect(lower.targets.kcal).toBe(base.targets.kcal - 100);
    expect(targetsWith(100, 'maintain').targets.kcal).toBe(base.targets.kcal + 100);
  });

  it('computes the deficit on the calibrated TDEE, within its limits (AC5)', () => {
    const lower = targetsWith(-200, 'lose');
    const { tdeeKcal, goalAdjustmentKcal } = lower.breakdown;
    // 20 % of the calibrated TDEE, at most 500 kcal (spec 001).
    expect(goalAdjustmentKcal).toBe(-Math.round(Math.min(tdeeKcal * 0.2, 500)));
    expect(lower.targets.kcal).toBe(Math.round((tdeeKcal + goalAdjustmentKcal) / 10) * 10);
  });

  it('never lowers the calories of a profile that gets no deficit (domain review)', () => {
    for (const flag of ['low_bmi', 'low_target_bmi', 'teen_limited', 'ed_soft_stop'] as const) {
      const base = targetsWith(0, 'maintain', undefined, [flag]);
      const lowered = targetsWith(-200, 'maintain', undefined, [flag]);
      expect(lowered.breakdown.calibrationKcal, flag).toBe(0);
      expect(lowered.targets.kcal, flag).toBe(base.targets.kcal);
      // A positive calibration still applies.
      expect(targetsWith(100, 'maintain', undefined, [flag]).targets.kcal, flag).toBe(
        base.targets.kcal + 100,
      );
    }
  });

  it('never goes below the calorie floor (AC5)', () => {
    const small = { sex: 'female' as const, heightCm: 152, weightKg: 48 };
    const floored = targetsWith(-300, 'lose', small);
    expect(floored.targets.kcal).toBeGreaterThanOrEqual(CALORIE_FLOOR.female);
    expect(floored.targets.kcal).toBeGreaterThanOrEqual(floored.breakdown.bmrKcal);
  });
});
