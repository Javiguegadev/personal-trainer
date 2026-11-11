import type { SafetyEvaluation } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { computeAge } from '../dates';
import { evaluateProfileSafety } from '../safety/profile';
import { computeTargets, type TargetsInput } from './targets';

const TODAY = '2026-11-11';

function safety(
  goal: SafetyEvaluation['appliedGoal'],
  extra: Partial<SafetyEvaluation> = {},
): SafetyEvaluation {
  return {
    status: 'ok',
    requestedGoal: goal,
    appliedGoal: goal,
    flags: [],
    maxSurplusRatio: null,
    targetsAllowed: true,
    ...extra,
  };
}

describe('computeAge', () => {
  it('counts the birthday itself', () => {
    expect(computeAge('1996-11-11', TODAY)).toBe(30);
  });
  it('is one less the day before the birthday', () => {
    expect(computeAge('1996-11-12', TODAY)).toBe(29);
  });
  it('handles 29 February birthdays in non-leap years', () => {
    expect(computeAge('2008-02-29', '2026-02-28')).toBe(17);
    expect(computeAge('2008-02-29', '2026-03-01')).toBe(18);
  });
});

/**
 * AC13 — hand-calculated fixtures (targets-v1). Each comment shows the calculation.
 * BMR Mifflin-St Jeor: 10·kg + 6.25·cm − 5·age + 5 (male) / − 161 (female) / mean (other).
 */
const fixtures: {
  name: string;
  input: TargetsInput;
  safety: SafetyEvaluation;
  expected: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    clampedReason: string | null;
  };
}[] = [
  {
    // BMR 620+1031.25−150−161 = 1340.25 · TDEE ×1.55 = 2077.39 · −min(415.48, 500) = 1661.91 → 1660
    // P 1.8×62 = 111.6 → 112 · F max(1660×0.25/9 = 46.1, 37.2) → 46 · C (1660−448−414)/4 = 199.5 → 200
    // Fibre max(25, 14×1.66 = 23.2) → 25
    name: 'female, 30 y, 165 cm, 62 kg, moderate, lose',
    input: {
      sex: 'female',
      birthDate: '1996-11-11',
      heightCm: 165,
      weightKg: 62,
      activityLevel: 'moderate',
    },
    safety: safety('lose'),
    expected: { kcal: 1660, proteinG: 112, carbsG: 200, fatG: 46, fiberG: 25, clampedReason: null },
  },
  {
    // BMR 800+1125−125+5 = 1805 · TDEE ×1.725 = 3113.63 · +min(311.36, 300) = 3413.63 → 3410
    // P 1.6×80 = 128 · F 3410×0.25/9 = 94.7 → 95 · C (3410−512−855)/4 = 510.75 → 511 · Fibre 47.7 → 48
    name: 'male, 25 y, 180 cm, 80 kg, active, gain',
    input: {
      sex: 'male',
      birthDate: '2001-05-20',
      heightCm: 180,
      weightKg: 80,
      activityLevel: 'active',
    },
    safety: safety('gain'),
    expected: { kcal: 3410, proteinG: 128, carbsG: 511, fatG: 95, fiberG: 48, clampedReason: null },
  },
  {
    // BMR male 1567.5, female 1401.5 → mean 1484.5 · TDEE ×1.2 = 1781.4 → 1780
    // P 1.6×70 = 112 · F 1780×0.25/9 = 49.4 → 49 · C (1780−448−441)/4 = 222.75 → 223 · Fibre 24.9 → 25
    name: 'other, 40 y, 170 cm, 70 kg, sedentary, maintain',
    input: {
      sex: 'other',
      birthDate: '1986-01-15',
      heightCm: 170,
      weightKg: 70,
      activityLevel: 'sedentary',
    },
    safety: safety('maintain'),
    expected: { kcal: 1780, proteinG: 112, carbsG: 223, fatG: 49, fiberG: 25, clampedReason: null },
  },
  {
    // AC14 floor. BMR 500+968.75−275−161 = 1032.75 · TDEE ×1.2 = 1239.3 · −247.86 = 991.4
    // Floor max(1032.75, 1200) = 1200 → kcal 1200 (clamped)
    // P 1.8×50 = 90 · F max(1200×0.25/9 = 33.3, 30) → 33 · C (1200−360−297)/4 = 135.75 → 136 · Fibre max(25, 16.8) → 25
    name: 'female, 55 y, 155 cm, 50 kg, sedentary, lose → calorie floor',
    input: {
      sex: 'female',
      birthDate: '1971-03-02',
      heightCm: 155,
      weightKg: 50,
      activityLevel: 'sedentary',
    },
    safety: safety('lose'),
    expected: {
      kcal: 1200,
      proteinG: 90,
      carbsG: 136,
      fatG: 33,
      fiberG: 25,
      clampedReason: 'calorie_floor',
    },
  },
  {
    // AC18 teen asked to lose → safety applies maintain. Age 17.
    // BMR 650+1093.75−85+5 = 1663.75 · TDEE ×1.375 = 2287.66 → 2290
    // P 1.6×65 = 104 · F 2290×0.25/9 = 63.6 → 64 · C (2290−416−576)/4 = 324.5 → 325 · Fibre 32.1 → 32
    name: 'male, 17 y, 175 cm, 65 kg, light, lose → maintain (teen)',
    input: {
      sex: 'male',
      birthDate: '2009-06-01',
      heightCm: 175,
      weightKg: 65,
      activityLevel: 'light',
    },
    safety: safety('maintain', {
      status: 'teen_limited',
      requestedGoal: 'lose',
      flags: ['teen_limited'],
      maxSurplusRatio: 0.1,
    }),
    expected: { kcal: 2290, proteinG: 104, carbsG: 325, fatG: 64, fiberG: 32, clampedReason: null },
  },
  {
    // Deficit capped at 500. BMR 1100+1156.25−175+5 = 2086.25 · TDEE ×1.9 = 3963.88 · −min(792.78, 500) → 3463.88 → 3460
    // BMI 32.1 ≥ 30 → reference weight 25×1.85² = 85.56 kg. P 1.8×85.56 = 154.0 → 154 (cap 35 % = 302)
    // F max(3460×0.25/9 = 96.1, 0.6×85.56) → 96 · C (3460−616−864)/4 = 495 · Fibre 48.4 → 48
    name: 'male, 35 y, 185 cm, 110 kg, very active, lose (500 kcal cap)',
    input: {
      sex: 'male',
      birthDate: '1991-08-30',
      heightCm: 185,
      weightKg: 110,
      activityLevel: 'very_active',
    },
    safety: safety('lose'),
    expected: { kcal: 3460, proteinG: 154,
      carbsG: 495, fatG: 96, fiberG: 48, clampedReason: null },
  },
];

describe('computeTargets — targets-v1 (AC13, AC14)', () => {
  it.each(fixtures)('$name', ({ input, safety: s, expected }) => {
    const { targets } = computeTargets(input, s, TODAY);
    expect(targets).toEqual({ ...expected, formulaVersion: 'targets-v1' });
    // Macros add up to the kcal target (rounding tolerance).
    const macroKcal = 4 * targets.proteinG + 4 * targets.carbsG + 9 * targets.fatG;
    expect(Math.abs(macroKcal - targets.kcal)).toBeLessThanOrEqual(10);
  });

  it('returns the breakdown shown in "How is this calculated?" (AC15)', () => {
    const { breakdown } = computeTargets(fixtures[0]!.input, fixtures[0]!.safety, TODAY);
    expect(breakdown).toEqual({
      ageYears: 30,
      bmrKcal: 1340,
      activityFactor: 1.55,
      tdeeKcal: 2077,
      goalAdjustmentKcal: -415,
      floorKcal: 1340,
      proteinGPerKg: 1.8,
      referenceWeightKg: 62,
    });
  });

  it('never goes below the floor for any sex, activity or goal (AC14)', () => {
    for (const sex of ['female', 'male', 'other'] as const) {
      const { targets, breakdown } = computeTargets(
        { sex, birthDate: '1950-01-01', heightCm: 150, weightKg: 40, activityLevel: 'sedentary' },
        safety('lose'),
        TODAY,
      );
      expect(targets.kcal).toBeGreaterThanOrEqual(breakdown.floorKcal);
      expect(targets.kcal).toBeGreaterThanOrEqual({ female: 1200, male: 1500, other: 1350 }[sex]);
    }
  });

  it('caps the surplus with maxSurplusRatio', () => {
    const { breakdown } = computeTargets(
      fixtures[1]!.input,
      safety('gain', { maxSurplusRatio: 0.05 }),
      TODAY,
    );
    expect(breakdown.goalAdjustmentKcal).toBe(Math.round(3113.625 * 0.05));
  });

  it('never returns negative carbs and keeps every macro an integer', () => {
    const { targets } = computeTargets(
      {
        sex: 'female',
        birthDate: '1950-01-01',
        heightCm: 120,
        weightKg: 300,
        activityLevel: 'sedentary',
      },
      safety('lose'),
      TODAY,
    );
    expect(targets.carbsG).toBeGreaterThanOrEqual(0);
    for (const v of [
      targets.kcal,
      targets.proteinG,
      targets.carbsG,
      targets.fatG,
      targets.fiberG,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('safety → targets, end to end', () => {
  const base = { birthDate: '1990-01-01', heightCm: 170, weightKg: 70, targetWeightKg: null, goal: 'lose' as const, healthFlags: [], injuries: null };
  const targetsInput: TargetsInput = { sex: 'female', birthDate: '1990-01-01', heightCm: 170, weightKg: 70, activityLevel: 'moderate' };

  it.each([
    ['low BMI', { weightKg: 50 }],
    ['eating-disorder signal', { healthFlags: ['ed_soft_stop' as const] }],
    ['teen', { birthDate: '2009-06-01' }],
  ])('%s with goal "lose" gets no deficit', (_name, override) => {
    const s = evaluateProfileSafety({ ...base, ...override }, TODAY);
    const { breakdown } = computeTargets({ ...targetsInput, ...override } as TargetsInput, s, TODAY);
    expect(breakdown.goalAdjustmentKcal).toBe(0);
  });

  it('pregnancy/breastfeeding → no numeric targets at all', () => {
    const s = evaluateProfileSafety({ ...base, healthFlags: ['pregnancy'] }, TODAY);
    expect(s.targetsAllowed).toBe(false);
    expect(() => computeTargets(targetsInput, s, TODAY)).toThrow();
  });

  it('refuses to compute targets for a blocked (under 16) profile', () => {
    const s = evaluateProfileSafety({ ...base, birthDate: '2012-01-01' }, TODAY);
    expect(() => computeTargets(targetsInput, s, TODAY)).toThrow();
  });
});

describe('reference weight for BMI ≥ 30', () => {
  it('keeps protein ≤ 35 % of kcal and macros consistent even at 300 kg', () => {
    const { targets } = computeTargets(
      { sex: 'male', birthDate: '1980-01-01', heightCm: 175, weightKg: 300, activityLevel: 'sedentary' },
      safety('lose'),
      TODAY,
    );
    expect(targets.proteinG * 4).toBeLessThanOrEqual(targets.kcal * 0.35);
    const macroKcal = 4 * targets.proteinG + 4 * targets.carbsG + 9 * targets.fatG;
    expect(Math.abs(macroKcal - targets.kcal)).toBeLessThanOrEqual(10);
  });
});

describe('calorie floor rounding', () => {
  it('never rounds below a non-round BMR floor', () => {
    // Search a range of profiles: kcal must always be >= the unrounded floor.
    for (let w = 40; w <= 120; w += 0.7) {
      const { targets, breakdown } = computeTargets(
        { sex: 'male', birthDate: '1960-01-01', heightCm: 175, weightKg: Math.round(w * 10) / 10, activityLevel: 'sedentary' },
        safety('lose'),
        TODAY,
      );
      expect(targets.kcal).toBeGreaterThanOrEqual(breakdown.floorKcal);
    }
  });
});
