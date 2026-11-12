import type { JobActivity, PlannedActivity, SafetyEvaluation, Sex } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../context/snapshot';
import { computeAge } from '../dates';
import { evaluateProfileSafety } from '../safety/profile';
import { computeTargets } from './targets';

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

interface Person {
  sex: Sex;
  birthDate: string;
  heightCm: number;
  weightKg: number;
  job: JobActivity;
  training?: PlannedActivity[];
}

/** Targets through the same path as production: sources → context snapshot → computeTargets. */
function targetsFor(person: Person, s: SafetyEvaluation) {
  const snapshot = buildContextSnapshot(
    {
      profile: {
        sex: person.sex,
        birthDate: person.birthDate,
        heightCm: person.heightCm,
        weightKg: person.weightKg,
        targetWeightKg: null,
        goal: s.requestedGoal,
      },
      safetyFlags: s.flags,
      jobActivity: person.job,
      plannedActivities: person.training ?? [],
    },
    TODAY,
  );
  return computeTargets(snapshot, s);
}

const activity = (
  kind: PlannedActivity['kind'],
  sessionsPerWeek: number,
  minutesPerSession: number,
  intensity: PlannedActivity['intensity'] = 'moderate',
): PlannedActivity => ({ kind, label: null, sessionsPerWeek, minutesPerSession, intensity });

/** The man of the comparison table in spec 002: 30 y, 175 cm, 80 kg. BMR 800+1093.75−150+5 = 1748.75. */
const man: Omit<Person, 'job'> = {
  sex: 'male',
  birthDate: '1996-11-11',
  heightCm: 175,
  weightKg: 80,
};

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
 * Spec 002 AC6 — hand-calculated fixtures (targets-v2). Each comment shows the calculation.
 * BMR Mifflin-St Jeor: 10·kg + 6.25·cm − 5·age + 5 (male) / − 161 (female) / mean (other).
 * Activity factor = job (seated 1.4 · on your feet 1.6 · physical 1.8) + Σ hours × (MET − 1) / 168.
 * MET (light / moderate / hard): strength 3.0 / 3.5 / 5.0 · cardio 4.0 / 6.0 / 8.5 · sport 4.0 / 6.0 /
 * 8.0 · other 2.5 / 4.0 / 6.0.
 */
const fixtures: {
  name: string;
  person: Person;
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
    // TDEE 1748.75 × 1.4 = 2448.25 → 2450
    // P 1.6×80 = 128 · F 2450×0.25/9 = 68.06 → 68 · C (2450−512−612)/4 = 331.5 → 332 · Fibre 34.3 → 34
    name: 'man, seated, no training, maintain',
    person: { ...man, job: 'sedentary' },
    safety: safety('maintain'),
    expected: { kcal: 2450, proteinG: 128, carbsG: 332, fatG: 68, fiberG: 34, clampedReason: null },
  },
  {
    // Training 4 h × (3.5−1) / 168 = 0.0595 · factor 1.4595 · TDEE 2552.34 → 2550
    // P 128 · F 2550×0.25/9 = 70.83 → 71 · C (2550−512−639)/4 = 349.75 → 350 · Fibre 35.7 → 36
    name: 'man, seated + 4 strength sessions of 60 min, maintain',
    person: { ...man, job: 'sedentary', training: [activity('strength', 4, 60)] },
    safety: safety('maintain'),
    expected: { kcal: 2550, proteinG: 128, carbsG: 350, fatG: 71, fiberG: 36, clampedReason: null },
  },
  {
    // Training (3 h × 2.5 + 3 h × 5 + 1.5 h × 7) / 168 = 33/168 = 0.1964 · factor 1.5964
    // TDEE 2791.75 → 2790 · P 128 · F 2790×0.25/9 = 77.5 → 78 · C (2790−512−702)/4 = 394 · Fibre 39.06 → 39
    name: 'man, seated + gym 3×60 + football 2×90 + a 90 min match (hard), maintain',
    person: {
      ...man,
      job: 'sedentary',
      training: [
        activity('strength', 3, 60),
        activity('sport', 2, 90),
        activity('sport', 1, 90, 'hard'),
      ],
    },
    safety: safety('maintain'),
    expected: { kcal: 2790, proteinG: 128, carbsG: 394, fatG: 78, fiberG: 39, clampedReason: null },
  },
  {
    // TDEE 1748.75 × 1.8 = 3147.75 · −min(629.55, 500) = 2647.75 → 2650
    // P 1.8×80 = 144 · F 2650×0.25/9 = 73.61 → 74 · C (2650−576−666)/4 = 352 · Fibre 37.1 → 37
    name: 'man, physical job, no training, lose (500 kcal cap)',
    person: { ...man, job: 'physical' },
    safety: safety('lose'),
    expected: { kcal: 2650, proteinG: 144, carbsG: 352, fatG: 74, fiberG: 37, clampedReason: null },
  },
  {
    // BMR 620+1031.25−150−161 = 1340.25 · training 1.5 h × (4−1) / 168 = 0.0268 · factor 1.6268
    // TDEE 2180.30 · −20 % = −436.06 → 1744.24 → 1740
    // P 1.8×62 = 111.6 → 112 · F max(1740×0.25/9 = 48.3, 37.2) → 48 · C (1740−448−432)/4 = 215
    // Fibre max(25, 24.4) → 25
    name: 'woman, 30 y, 165 cm, 62 kg, on her feet + 2 light cardio sessions of 45 min, lose',
    person: {
      sex: 'female',
      birthDate: '1996-11-11',
      heightCm: 165,
      weightKg: 62,
      job: 'standing',
      training: [activity('cardio', 2, 45, 'light')],
    },
    safety: safety('lose'),
    expected: { kcal: 1740, proteinG: 112, carbsG: 215, fatG: 48, fiberG: 25, clampedReason: null },
  },
  {
    // Calorie floor. BMR 550+968.75−300−161 = 1057.75 · TDEE ×1.4 = 1480.85 · −296.17 = 1184.68
    // Floor max(1057.75, 1200) = 1200 → kcal 1200 (clamped)
    // P 1.8×55 = 99 · F max(1200×0.25/9 = 33.3, 33) → 33 · C (1200−396−297)/4 = 126.75 → 127 · Fibre 25
    name: 'woman, 60 y, 155 cm, 55 kg, seated, lose → calorie floor',
    person: {
      sex: 'female',
      birthDate: '1966-11-11',
      heightCm: 155,
      weightKg: 55,
      job: 'sedentary',
    },
    safety: safety('lose'),
    expected: {
      kcal: 1200,
      proteinG: 99,
      carbsG: 127,
      fatG: 33,
      fiberG: 25,
      clampedReason: 'calorie_floor',
    },
  },
  {
    // AC10 ceiling. BMR 800+1125−125+5 = 1805 · training 14 h × (8.5−1) / 168 = 0.625
    // factor 1.8 + 0.625 = 2.425 → 2.4 · TDEE 4332 · +min(433.2, 300) = 4632 → 4630
    // P 1.6×80 = 128 · F 4630×0.25/9 = 128.6 → 129 · C (4630−512−1161)/4 = 739.25 → 739 · Fibre 64.8 → 65
    name: 'man, 25 y, 180 cm, 80 kg, physical job + 7 hard cardio sessions of 120 min, gain → ceiling',
    person: {
      sex: 'male',
      birthDate: '2001-05-20',
      heightCm: 180,
      weightKg: 80,
      job: 'physical',
      training: [activity('cardio', 7, 120, 'hard')],
    },
    safety: safety('gain', { flags: ['high_training_load'] }),
    expected: {
      kcal: 4630,
      proteinG: 128,
      carbsG: 739,
      fatG: 129,
      fiberG: 65,
      clampedReason: 'activity_ceiling',
    },
  },
  {
    // AC11 high training load (600 min). BMR 1100+1156.25−175+5 = 2086.25
    // Training (5 h × 2.5 + 5 h × 5) / 168 = 37.5/168 = 0.2232 · factor 1.6232 · TDEE 3386.43
    // Deficit min(10 % = 338.64, 300) = 300 → 3086.43 → 3090
    // BMI 32.1 ≥ 30 → reference weight 25×1.85² = 85.56 kg. P 1.8×85.56 = 154.0 → 154
    // F max(3090×0.25/9 = 85.8, 51.3) → 86 · C (3090−616−774)/4 = 425 · Fibre 43.3 → 43
    name: 'man, 35 y, 185 cm, 110 kg, seated + 5×60 strength + 4×75 cardio, lose → smaller deficit',
    person: {
      sex: 'male',
      birthDate: '1991-08-30',
      heightCm: 185,
      weightKg: 110,
      job: 'sedentary',
      training: [activity('strength', 5, 60), activity('cardio', 4, 75)],
    },
    safety: safety('lose', { flags: ['high_training_load'] }),
    expected: { kcal: 3090, proteinG: 154, carbsG: 425, fatG: 86, fiberG: 43, clampedReason: null },
  },
  {
    // BMR male 1567.5, female 1401.5 → mean 1484.5 · TDEE ×1.4 = 2078.3 → 2080
    // P 1.6×70 = 112 · F 2080×0.25/9 = 57.8 → 58 · C (2080−448−522)/4 = 277.5 → 278 · Fibre 29.1 → 29
    name: 'other, 40 y, 170 cm, 70 kg, seated, maintain',
    person: {
      sex: 'other',
      birthDate: '1986-01-15',
      heightCm: 170,
      weightKg: 70,
      job: 'sedentary',
    },
    safety: safety('maintain'),
    expected: { kcal: 2080, proteinG: 112, carbsG: 278, fatG: 58, fiberG: 29, clampedReason: null },
  },
  {
    // Teen asked to lose → safety applies maintain. Age 17. BMR 650+1093.75−85+5 = 1663.75
    // Training 4.5 h × (6−1) / 168 = 0.1339 · factor 1.7339 · TDEE 2884.82 → 2880
    // P 1.6×65 = 104 · F 2880×0.25/9 = 80 · C (2880−416−720)/4 = 436 · Fibre 40.3 → 40
    name: 'boy, 17 y, 175 cm, 65 kg, on his feet + 3 sport sessions of 90 min, lose → maintain',
    person: {
      sex: 'male',
      birthDate: '2009-06-01',
      heightCm: 175,
      weightKg: 65,
      job: 'standing',
      training: [activity('sport', 3, 90)],
    },
    safety: safety('maintain', {
      status: 'teen_limited',
      requestedGoal: 'lose',
      flags: ['teen_limited'],
      maxSurplusRatio: 0.1,
    }),
    expected: { kcal: 2880, proteinG: 104, carbsG: 436, fatG: 80, fiberG: 40, clampedReason: null },
  },
];

describe('computeTargets — targets-v2 (spec 002 AC6)', () => {
  it.each(fixtures)('$name', ({ person, safety: s, expected }) => {
    const { targets } = targetsFor(person, s);
    expect(targets).toEqual({ ...expected, formulaVersion: 'targets-v2' });
    // Macros add up to the kcal target (rounding tolerance).
    const macroKcal = 4 * targets.proteinG + 4 * targets.carbsG + 9 * targets.fatG;
    expect(Math.abs(macroKcal - targets.kcal)).toBeLessThanOrEqual(10);
  });

  it('returns the breakdown shown in "How is this calculated?" (AC8)', () => {
    const { breakdown } = targetsFor(fixtures[2]!.person, fixtures[2]!.safety);
    expect(breakdown).toEqual({
      ageYears: 30,
      bmrKcal: 1749,
      activityFactor: 1.596,
      jobFactor: 1.4,
      trainingFactor: 0.196,
      tdeeKcal: 2792,
      goalAdjustmentKcal: 0,
      floorKcal: 1749,
      proteinGPerKg: 1.6,
      referenceWeightKg: 80,
    });
  });

  it('caps the surplus with maxSurplusRatio', () => {
    const { breakdown } = targetsFor(
      { ...man, job: 'sedentary' },
      safety('gain', { maxSurplusRatio: 0.05 }),
    );
    expect(breakdown.goalAdjustmentKcal).toBe(Math.round(2448.25 * 0.05));
  });

  it('never returns negative carbs and keeps every macro an integer', () => {
    const { targets } = targetsFor(
      { sex: 'female', birthDate: '1950-01-01', heightCm: 120, weightKg: 300, job: 'sedentary' },
      safety('lose'),
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

describe('activity-factor ceiling (spec 002 AC10)', () => {
  const heavy = [activity('cardio', 7, 120, 'hard')]; // training factor 0.625

  it('limits the factor to 2.4 and says why', () => {
    const { targets, breakdown } = targetsFor(
      { ...man, job: 'physical', training: heavy },
      safety('maintain'),
    );
    expect(breakdown).toMatchObject({ activityFactor: 2.4, jobFactor: 1.8, trainingFactor: 0.625 });
    expect(breakdown.tdeeKcal).toBe(Math.round(1748.75 * 2.4));
    expect(targets.clampedReason).toBe('activity_ceiling');
  });

  it('does not report a factor of exactly 2.4 as limited', () => {
    // Physical job 1.8 + 8 hard sport sessions of 108 min: 14.4 h × 7 / 168 = 0.6 → exactly 2.4.
    const { targets, breakdown } = targetsFor(
      { ...man, job: 'physical', training: [activity('sport', 8, 108, 'hard')] },
      safety('maintain'),
    );
    expect(breakdown.activityFactor).toBe(2.4);
    expect(targets.clampedReason).toBeNull();
  });

  it('does not touch a factor of 2.4 or less', () => {
    // 1.4 + 0.625 = 2.025
    const { targets, breakdown } = targetsFor(
      { ...man, job: 'sedentary', training: heavy },
      safety('maintain'),
    );
    expect(breakdown.activityFactor).toBe(2.025);
    expect(targets.clampedReason).toBeNull();
  });
});

describe('high training load (spec 002 AC11)', () => {
  const job = 'sedentary' as const;

  it('keeps the usual deficit below 600 minutes per week', () => {
    // 599 min: TDEE × 20 % is above the 500 kcal cap.
    const { breakdown } = targetsFor(
      { ...man, job, training: [activity('strength', 1, 239), activity('cardio', 4, 90)] },
      safety('lose'),
    );
    expect(breakdown.goalAdjustmentKcal).toBe(-500);
  });

  it('limits the deficit to min(10 % of TDEE, 300 kcal) from 600 minutes per week', () => {
    // 600 min: 4 h × 2.5 + 6 h × 5 = 40 MET-hours → training factor 40/168 = 0.2381
    const training = [activity('strength', 1, 240), activity('cardio', 4, 90)];

    // Seated: factor 1.6381 · TDEE 2864.62 · 10 % = 286.46 → −286 (below the 300 kcal cap)
    const seated = targetsFor({ ...man, job, training }, safety('lose'));
    expect(seated.breakdown.goalAdjustmentKcal).toBe(-286);

    // Physical job: factor 2.0381 · TDEE 3564.12 · 10 % = 356.4 → capped at −300
    const physical = targetsFor({ ...man, job: 'physical', training }, safety('lose'));
    expect(physical.breakdown.goalAdjustmentKcal).toBe(-300);

    // A small person: 10 % of TDEE is below 300 kcal. BMR 1057.75, 10 h of light "other" activity:
    // factor 1.4 + 10 × 1.5 / 168 = 1.4893 · TDEE 1575.3 · 10 % = 157.5 → −158
    const small = targetsFor(
      {
        sex: 'female',
        birthDate: '1966-11-11',
        heightCm: 155,
        weightKg: 55,
        job,
        training: [activity('other', 5, 120, 'light')],
      },
      safety('lose'),
    );
    expect(small.breakdown.goalAdjustmentKcal).toBe(-158);
  });

  it('does not change a surplus or maintenance', () => {
    // 600 min of moderate cardio: 10 h × 5 / 168 = 0.2976 · factor 1.6976 · TDEE 2968.71
    const training = [activity('cardio', 5, 120)];
    // Surplus min(10 % = 296.87, 300) → +297, the same rule as without training.
    expect(targetsFor({ ...man, job, training }, safety('gain')).breakdown.goalAdjustmentKcal).toBe(
      297,
    );
    expect(
      targetsFor({ ...man, job, training }, safety('maintain')).breakdown.goalAdjustmentKcal,
    ).toBe(0);
  });
});

describe('safety invariants under targets-v2 (spec 002 AC9)', () => {
  const jobs = ['sedentary', 'standing', 'physical'] as const;
  const goals = ['lose', 'maintain', 'gain'] as const;

  it('never goes below the floor for any sex, job or goal', () => {
    for (const sex of ['female', 'male', 'other'] as const) {
      for (const job of jobs) {
        for (const goal of goals) {
          const { targets, breakdown } = targetsFor(
            { sex, birthDate: '1950-01-01', heightCm: 150, weightKg: 40, job },
            safety(goal),
          );
          expect(targets.kcal).toBeGreaterThanOrEqual(breakdown.floorKcal);
          expect(targets.kcal).toBeGreaterThanOrEqual(
            { female: 1200, male: 1500, other: 1350 }[sex],
          );
        }
      }
    }
  });

  it('never rounds below a non-round BMR floor', () => {
    for (let w = 40; w <= 120; w += 0.7) {
      const { targets, breakdown } = targetsFor(
        {
          sex: 'male',
          birthDate: '1960-01-01',
          heightCm: 175,
          weightKg: Math.round(w * 10) / 10,
          job: 'sedentary',
        },
        safety('lose'),
      );
      expect(targets.kcal).toBeGreaterThanOrEqual(breakdown.floorKcal);
    }
  });

  it('a more active job never lowers the calories', () => {
    for (const goal of goals) {
      const kcal = jobs.map(
        (job) =>
          targetsFor({ ...man, job, training: [activity('strength', 3, 60)] }, safety(goal)).targets
            .kcal,
      );
      expect(kcal[1]).toBeGreaterThanOrEqual(kcal[0]!);
      expect(kcal[2]).toBeGreaterThanOrEqual(kcal[1]!);
    }
  });

  it('one more activity never lowers the calories, up to the weekly limit', () => {
    for (const goal of goals) {
      for (const job of jobs) {
        let previous = 0;
        // 0 to 1200 minutes per week, in steps of one 120-minute moderate cardio session.
        for (let sessions = 0; sessions <= 10; sessions++) {
          const training = sessions === 0 ? [] : [activity('cardio', sessions, 120)];
          const { kcal } = targetsFor({ ...man, job, training }, safety(goal)).targets;
          expect(kcal).toBeGreaterThanOrEqual(previous);
          previous = kcal;
        }
      }
    }
  });
});

describe('safety → targets, end to end (spec 002 AC9)', () => {
  const base = {
    birthDate: '1990-01-01',
    heightCm: 170,
    weightKg: 70,
    targetWeightKg: null,
    goal: 'lose' as const,
    healthFlags: [],
    injuries: null,
  };
  const person: Person = {
    sex: 'female',
    birthDate: '1990-01-01',
    heightCm: 170,
    weightKg: 70,
    job: 'standing',
    training: [activity('strength', 3, 60)],
  };

  it.each([
    ['low BMI', { weightKg: 50 }],
    ['low target BMI', { targetWeightKg: 50 }],
    ['eating-disorder signal', { healthFlags: ['ed_soft_stop' as const] }],
    ['stored eating-disorder flag', { previousFlags: ['ed_soft_stop' as const] }],
    ['teen', { birthDate: '2009-06-01' }],
  ])('%s with goal "lose" gets no deficit', (_name, override) => {
    const s = evaluateProfileSafety({ ...base, ...override }, TODAY);
    const { breakdown } = targetsFor({ ...person, ...override } as Person, s);
    expect(breakdown.goalAdjustmentKcal).toBe(0);
  });

  it('a teen gets a surplus of at most 10 %', () => {
    const s = evaluateProfileSafety({ ...base, birthDate: '2009-06-01', goal: 'gain' }, TODAY);
    const { breakdown } = targetsFor({ ...person, birthDate: '2009-06-01' }, s);
    expect(breakdown.goalAdjustmentKcal).toBeGreaterThan(0);
    expect(breakdown.goalAdjustmentKcal).toBeLessThanOrEqual(Math.ceil(breakdown.tdeeKcal * 0.1));
  });

  it('flags a high training load from the planned minutes (AC11)', () => {
    expect(evaluateProfileSafety({ ...base, trainingMinutesPerWeek: 599 }, TODAY).flags).toEqual(
      [],
    );
    expect(evaluateProfileSafety({ ...base, trainingMinutesPerWeek: 600 }, TODAY).flags).toEqual([
      'high_training_load',
    ]);
  });

  it('pregnancy/breastfeeding → no numeric targets at all', () => {
    const s = evaluateProfileSafety({ ...base, healthFlags: ['pregnancy'] }, TODAY);
    expect(s.targetsAllowed).toBe(false);
    expect(() => targetsFor(person, s)).toThrow();
  });

  it('refuses to compute targets for a blocked (under 16) profile', () => {
    const s = evaluateProfileSafety({ ...base, birthDate: '2012-01-01' }, TODAY);
    expect(() => targetsFor(person, s)).toThrow();
  });
});

describe('reference weight for BMI ≥ 30', () => {
  it('keeps protein ≤ 35 % of kcal and macros consistent even at 300 kg', () => {
    const { targets } = targetsFor(
      { sex: 'male', birthDate: '1980-01-01', heightCm: 175, weightKg: 300, job: 'sedentary' },
      safety('lose'),
    );
    expect(targets.proteinG * 4).toBeLessThanOrEqual(targets.kcal * 0.35);
    const macroKcal = 4 * targets.proteinG + 4 * targets.carbsG + 9 * targets.fatG;
    expect(Math.abs(macroKcal - targets.kcal)).toBeLessThanOrEqual(10);
  });
});
