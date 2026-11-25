import {
  EMPTY_WEEK,
  REVIEW_RULES,
  type JobActivity,
  type PlannedActivity,
  type Profile,
  type SafetyFlag,
} from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { evaluateStoredProfile } from '../profile/evaluate';
import { applyCalibration, reviewWeekToShow, weeklyReview, type WeeklyReviewInput } from './review';

/**
 * The weekly review (spec 014 AC1–AC7). The reviewed week is Monday 16 to Sunday 22 November 2026,
 * read on Monday 23. Four weeks of history start on Monday 26 October (day 0): W−3 is days 0–6, W−2
 * days 7–13, W−1 days 14–20 and the reviewed week W days 21–27.
 */
const WEEK = '2026-11-16';
const TODAY = '2026-11-23';
const START = '2026-10-26';

const gym: PlannedActivity = {
  kind: 'strength',
  label: null,
  sessionsPerWeek: 3,
  minutesPerSession: 60,
  intensity: 'moderate',
  days: [],
};

type StoredProfile = Profile & { jobActivity: JobActivity };

function profile(over: Partial<StoredProfile> = {}): StoredProfile {
  return {
    sex: 'male',
    birthDate: '1996-01-01',
    heightCm: 178,
    weightKg: 80,
    targetWeightKg: null,
    jobActivity: 'sedentary',
    plannedActivities: [gym],
    requestedGoal: 'lose',
    goal: 'lose',
    trainingFocus: 'general_fitness',
    safetyFlags: [],
    injuries: null,
    units: 'metric',
    locale: 'es',
    onboardingCompletedAt: '2026-10-20T10:00:00.000Z',
    week: EMPTY_WEEK,
    trainingExperience: null,
    equipmentAccess: null,
    energyCalibrationKcal: 0,
    ...over,
  };
}

/** The kcal target the stored profile gets today. */
function targetOf(p: StoredProfile): number {
  const evaluation = evaluateStoredProfile(p, p.weightKg, TODAY);
  if (evaluation.kind !== 'ok' || !evaluation.targets) {
    throw new Error('fixture must have numeric targets');
  }
  return evaluation.targets.kcal;
}

interface HistoryOptions {
  /** Weight change per week from day 0 (kg), or a weight per day (null: no weigh-in). */
  slopeKgPerWeek?: number;
  weightAt?: (day: number) => number | null;
  /** Logged kcal per day (null: nothing logged). The target every day when omitted. */
  kcalAt?: (day: number, target: number) => number | null;
  sleepAt?: (day: number) => number | null;
  stressAt?: (day: number) => 'low' | 'normal' | 'high' | null;
  workoutDays?: number[];
  /** The local date of the last calibration change. */
  calibratedOn?: string | null;
}

/** Four weeks of logs for `p`, as the API reads them for the review of `WEEK`. */
function history(p: StoredProfile, o: HistoryOptions = {}): WeeklyReviewInput {
  const target = targetOf(p);
  const days = Array.from({ length: 28 }, (_, day) => ({ day, date: addDays(START, day) }));
  const weightAt =
    o.weightAt ?? ((day: number) => p.weightKg + ((o.slopeKgPerWeek ?? 0) * (day - 27)) / 7);
  const kcalAt = o.kcalAt ?? ((_day: number, t: number) => t);
  return {
    weekStart: WEEK,
    today: TODAY,
    profile: p,
    weights: days.flatMap(({ day, date }) => {
      const kg = weightAt(day);
      return kg === null ? [] : [{ localDate: date, weightKg: Math.round(kg * 100) / 100 }];
    }),
    mealItems: days.flatMap(({ day, date }) => {
      const kcal = kcalAt(day, target);
      return kcal === null
        ? []
        : [{ localDate: date, nutrients: { kcal, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null } }];
    }),
    workouts: (o.workoutDays ?? []).map((day) => ({ localDate: addDays(START, day), minutes: 60 })),
    checkins: days.flatMap(({ day, date }) => {
      const sleepMinutes = o.sleepAt?.(day) ?? null;
      const stress = o.stressAt?.(day) ?? null;
      return sleepMinutes === null && stress === null
        ? []
        : [
            {
              localDate: date,
              sleepMinutes,
              stress,
              workShift: null,
              shiftStartMinute: null,
              shiftEndMinute: null,
            },
          ];
    }),
    targetsHistory: [{ fromDate: '2026-10-20', kcal: target }],
    calibratedOn: o.calibratedOn ?? null,
  };
}

const inWeek = (day: number) => day >= 21;

/** The review of a history that must have one. */
function reviewOf(input: WeeklyReviewInput) {
  const review = weeklyReview(input);
  if (!review) throw new Error('expected a review');
  return review;
}

describe('weeklyReview: six four-week histories (spec 014 AC7)', () => {
  it('losing on track: no change', () => {
    const review = reviewOf(history(profile(), { slopeKgPerWeek: -0.32 }));
    expect(review.status).toBe('no_change');
    expect(review.proposal).toBeNull();
    expect(review.reasons).toEqual(['on_track']);
  });

  it('losing slowly while eating at the target: −100 kcal of calibration', () => {
    const p = profile();
    const review = reviewOf(history(p, { slopeKgPerWeek: 0 }));
    expect(review.status).toBe('proposed');
    expect(review.reasons).toEqual(['slow_loss']);
    expect(review.proposal).toMatchObject({
      kcalDelta: -REVIEW_RULES.stepKcal,
      fromKcal: targetOf(p),
    });
    // The deficit is computed again on the calibrated TDEE, so the target drops a little less.
    const to = review.proposal!.toKcal;
    expect(to).toBe(targetOf(profile({ energyCalibrationKcal: -100 })));
    expect(to).toBeLessThan(targetOf(p));
    expect(to).toBeGreaterThanOrEqual(targetOf(p) - 100);
  });

  it('losing fast with little logging: +100 kcal anyway', () => {
    const review = reviewOf(
      history(profile(), {
        slopeKgPerWeek: -1.0,
        kcalAt: (day, t) => (day === 22 || day === 24 ? t : null),
      }),
    );
    expect(review.reasons).toEqual(['fast_loss']);
    expect(review.proposal?.kcalDelta).toBe(100);
  });

  it('maintaining while drifting up: −100 kcal', () => {
    const p = profile({ requestedGoal: 'maintain', goal: 'maintain' });
    const review = reviewOf(history(p, { slopeKgPerWeek: 0.4 }));
    expect(review.reasons).toEqual(['drift_up']);
    expect(review.proposal?.kcalDelta).toBe(-100);
    expect(review.proposal?.toKcal).toBe(review.proposal!.fromKcal - 100);
  });

  it('gaining slowly: +100 kcal', () => {
    const p = profile({ requestedGoal: 'gain', goal: 'gain' });
    const review = reviewOf(history(p, { slopeKgPerWeek: 0 }));
    expect(review.reasons).toEqual(['slow_gain']);
    expect(review.proposal?.kcalDelta).toBe(100);
  });

  it('losing slowly in a week of little sleep: no decrease, and it says why', () => {
    const review = reviewOf(
      history(profile(), {
        slopeKgPerWeek: 0,
        sleepAt: (day) => (day === 21 || day === 23 || day === 25 ? 300 : 450),
      }),
    );
    expect(review.status).toBe('no_change');
    expect(review.proposal).toBeNull();
    expect(review.reasons).toEqual(['slow_loss', 'decrease_blocked_sleep_stress']);
  });
});

describe('weeklyReview: rules (spec 014 AC3–AC5)', () => {
  it('needs 3 weights in the reviewed week and two weeks before (AC4)', () => {
    const review = reviewOf(
      history(profile(), {
        weightAt: (day) => (inWeek(day) && day > 22 ? null : 80),
      }),
    );
    expect(review.reasons).toEqual(['not_enough_weights']);
    expect(review.proposal).toBeNull();
    expect(review.summary.weightAverageKg).toBeNull();
  });

  it('needs 5 days with food in the reviewed week and the week before (AC4)', () => {
    const review = reviewOf(
      history(profile(), {
        slopeKgPerWeek: 0,
        kcalAt: (day, t) => (inWeek(day) && day > 24 ? null : t),
      }),
    );
    expect(review.reasons).toEqual(['slow_loss', 'not_enough_logging']);
    expect(review.proposal).toBeNull();
  });

  it('needs the logged intake within 10 % of the target (AC4)', () => {
    const review = reviewOf(
      history(profile(), { slopeKgPerWeek: 0, kcalAt: (_day, t) => Math.round(t * 1.2) }),
    );
    expect(review.reasons).toEqual(['slow_loss', 'off_target_intake']);
    expect(review.proposal).toBeNull();
  });

  it('keeps the accumulated calibration within ±300 kcal (AC5)', () => {
    const p = profile({ energyCalibrationKcal: -300 });
    const review = reviewOf(history(p, { slopeKgPerWeek: 0 }));
    expect(review.reasons).toEqual(['slow_loss', 'calibration_limit']);
    expect(review.proposal).toBeNull();
  });

  it('never proposes a decrease at the calorie floor (AC5)', () => {
    // 60 years, 150 cm, 46 kg, no training: the target is the floor of 1,200 kcal.
    const p = profile({
      sex: 'female',
      birthDate: '1966-01-01',
      heightCm: 150,
      weightKg: 46,
      plannedActivities: [],
    });
    expect(targetOf(p)).toBe(1200);
    const review = reviewOf(history(p, { slopeKgPerWeek: 0 }));
    expect(review.reasons).toEqual(['slow_loss', 'at_floor']);
    expect(review.proposal).toBeNull();
  });

  it('blocks a decrease with high stress too, but never an increase (AC5)', () => {
    const p = profile({ requestedGoal: 'gain', goal: 'gain' });
    const stressed = (day: number) => (inWeek(day) && day < 25 ? ('high' as const) : null);
    expect(
      reviewOf(history(profile(), { slopeKgPerWeek: 0, stressAt: stressed })).reasons,
    ).toContain('decrease_blocked_sleep_stress');
    expect(reviewOf(history(p, { slopeKgPerWeek: 0, stressAt: stressed })).proposal).toMatchObject({
      kcalDelta: 100,
    });
  });

  it('uses the applied goal: a low BMI asking to lose is reviewed as maintain (AC3)', () => {
    // 178 cm and 60 kg: BMI 18.9, under 20, so no deficit (spec 001).
    const p = profile({ weightKg: 60, safetyFlags: ['low_bmi'], goal: 'maintain' });
    const review = reviewOf(history(p, { slopeKgPerWeek: -0.3 }));
    expect(review.reasons).toEqual(['drift_down']);
    expect(review.proposal?.kcalDelta).toBe(100);
  });

  it('summarises the week without judging it (AC2)', () => {
    const review = reviewOf(
      history(profile(), {
        slopeKgPerWeek: -0.32,
        // Food on 6 days of the week; on Sunday only a weight.
        kcalAt: (day, t) => (day === 27 ? null : t),
        workoutDays: [21, 23, 25],
        sleepAt: (day) => (day === 22 ? 330 : day === 24 ? 480 : null),
        stressAt: (day) => (day === 24 ? 'high' : null),
      }),
    );
    expect(review.summary).toMatchObject({
      daysLogged: 7,
      foodDays: 6,
      workouts: 3,
      workoutMinutes: 180,
      checkinDays: 2,
      poorSleepDays: 1,
      highStressDays: 1,
    });
    expect(review.summary.averageKcal).toBe(targetOf(profile()));
    expect(review.summary.targetKcal).toBe(targetOf(profile()));
    expect(review.summary.weightRateKgPerWeek).toBeCloseTo(-0.32, 1);
    expect(review.summary.weightRatePerWeek).toBeLessThan(0);
    expect(review.rulesVersion).toBe(REVIEW_RULES.version);
  });

  it('gives the same review for the same inputs, and does not change them (AC7)', () => {
    const input = history(profile(), { slopeKgPerWeek: 0 });
    const copy = JSON.parse(JSON.stringify(input)) as WeeklyReviewInput;
    expect(reviewOf(input)).toEqual(reviewOf(input));
    expect(input).toEqual(copy);
  });
});

describe('weeklyReview: domain review (spec 014 AC3–AC5)', () => {
  const lowBmi = () => profile({ weightKg: 60, safetyFlags: ['low_bmi'], goal: 'maintain' });

  it('never reviews a profile with an eating-disorder signal or a pregnancy', () => {
    // The logs of an ordinary profile: a pregnancy has no numeric targets to build them from.
    const logs = history(profile(), { slopeKgPerWeek: 0 });
    for (const flag of ['ed_soft_stop', 'pregnancy'] as const) {
      expect(weeklyReview({ ...logs, profile: profile({ safetyFlags: [flag] }) })).toBeNull();
    }
  });

  it('never lowers the calories of a low BMI or a minor, even when the weight drifts up', () => {
    const review = reviewOf(history(lowBmi(), { slopeKgPerWeek: 0.3 }));
    expect(review.reasons).toEqual(['drift_up', 'decrease_blocked_profile']);
    expect(review.proposal).toBeNull();
    const teen = profile({
      birthDate: '2009-06-01',
      requestedGoal: 'maintain',
      goal: 'maintain',
      safetyFlags: ['teen_limited'],
    });
    expect(reviewOf(history(teen, { slopeKgPerWeek: 0.4 })).reasons).toEqual([
      'drift_up',
      'decrease_blocked_profile',
    ]);
  });

  it('asks for more energy on a fast loss whatever the goal, without the logging gate', () => {
    const review = reviewOf(
      history(lowBmi(), {
        slopeKgPerWeek: -0.75,
        kcalAt: (day, t) => (day > 24 ? t : null),
      }),
    );
    expect(review.reasons).toEqual(['fast_loss']);
    expect(review.proposal?.kcalDelta).toBe(100);
  });

  it('refers to a professional when losing fast at the calorie floor', () => {
    const floor = profile({
      sex: 'female',
      birthDate: '1966-01-01',
      heightCm: 150,
      weightKg: 46,
      plannedActivities: [],
    });
    const review = reviewOf(history(floor, { slopeKgPerWeek: -0.6 }));
    expect(review.reasons).toEqual(['fast_loss', 'see_professional']);
    expect(review.proposal).toBeNull();
  });

  it('refers to a professional when losing fast at the calibration bound', () => {
    const review = reviewOf(
      history(profile({ energyCalibrationKcal: 300 }), { slopeKgPerWeek: -1.0 }),
    );
    expect(review.reasons).toEqual(['fast_loss', 'calibration_limit', 'see_professional']);
  });

  it('waits when one reading decides the rate', () => {
    const p = profile({ requestedGoal: 'maintain', goal: 'maintain' });
    // Two weeks before: 80, 80, 80; this week: 80, 80, 81.5 (one high reading).
    const weightAt = (day: number) =>
      day >= 7 && day <= 9 ? 80 : day >= 21 && day <= 23 ? (day === 23 ? 81.5 : 80) : null;
    const review = reviewOf(history(p, { weightAt }));
    expect(review.reasons).toEqual(['drift_up', 'uneven_weights']);
    expect(review.proposal).toBeNull();
  });

  it('pauses proposals for two weeks after a calibration change', () => {
    // Accepted on Monday 9: the week of 2 November (W−2) started before it.
    const paused = reviewOf(history(profile(), { slopeKgPerWeek: 0, calibratedOn: '2026-11-09' }));
    expect(paused.reasons).toEqual(['slow_loss', 'recent_change']);
    // Changed on Sunday 1 November: both weeks compared start after it.
    const after = reviewOf(history(profile(), { slopeKgPerWeek: 0, calibratedOn: '2026-11-01' }));
    expect(after.proposal?.kcalDelta).toBe(-100);
    // A fast loss is never paused.
    expect(
      reviewOf(history(profile(), { slopeKgPerWeek: -1.0, calibratedOn: '2026-11-16' })).proposal,
    ).toMatchObject({ kcalDelta: 100 });
  });
});

describe('reviewWeekToShow (spec 014 AC1)', () => {
  const show = (today: string, flags: SafetyFlag[] = []) =>
    reviewWeekToShow({ today, onboardedOn: '2026-11-02', flags });

  it('waits 21 days from the onboarding and names the Monday of the first review', () => {
    expect(show('2026-11-12')).toEqual({ weekStart: null, firstReviewOn: '2026-11-23' });
    expect(show('2026-11-22')).toEqual({ weekStart: null, firstReviewOn: '2026-11-23' });
  });

  it('reviews the last complete week from that Monday on', () => {
    expect(show('2026-11-23')).toEqual({ weekStart: '2026-11-16', firstReviewOn: null });
    expect(show('2026-11-25')).toEqual({ weekStart: '2026-11-16', firstReviewOn: null });
    expect(show('2026-11-29')).toEqual({ weekStart: '2026-11-16', firstReviewOn: null });
  });

  it('never reviews a profile with an eating-disorder signal or a pregnancy', () => {
    expect(show('2026-11-25', ['ed_soft_stop'])).toEqual({ weekStart: null, firstReviewOn: null });
    expect(show('2026-11-25', ['pregnancy'])).toEqual({ weekStart: null, firstReviewOn: null });
  });
});

describe('applyCalibration (spec 014 AC5, AC6)', () => {
  it('adds the proposal within ±300 kcal', () => {
    expect(applyCalibration(0, -100)).toBe(-100);
    expect(applyCalibration(-200, -100)).toBe(-300);
    expect(applyCalibration(200, 100)).toBe(300);
  });

  it('refuses to go beyond the bound', () => {
    expect(applyCalibration(-300, -100)).toBeNull();
    expect(applyCalibration(300, 100)).toBeNull();
  });
});
