import type { StressLevel } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import {
  dayReadiness,
  readinessHeadline,
  readinessLine,
  readinessPlanSession,
  sessionCut,
  sleepStressNotice,
} from './readiness';

const TODAY = '2026-11-23';
const answers = (sleepMinutes: number | null, stress: StressLevel | null = null) => ({
  sleepMinutes,
  stress,
});

describe('dayReadiness (spec 011 AC6)', () => {
  it('is unknown without a check-in or without sleep and stress', () => {
    expect(dayReadiness(null, 450)).toEqual({ level: 'unknown', reasons: [] });
    expect(dayReadiness(answers(null, null), 450)).toEqual({ level: 'unknown', reasons: [] });
  });

  it('is low under 5 h of sleep', () => {
    expect(dayReadiness(answers(270), null)).toEqual({
      level: 'low',
      reasons: ['very_short_sleep'],
    });
  });

  it('is low with 5–6 h and high stress', () => {
    expect(dayReadiness(answers(330, 'high'), null)).toEqual({
      level: 'low',
      reasons: ['short_sleep', 'high_stress'],
    });
  });

  it('is reduced with 5–6 h, with high stress, or 90 min under the usual sleep', () => {
    expect(dayReadiness(answers(330, 'normal'), null)).toEqual({
      level: 'reduced',
      reasons: ['short_sleep'],
    });
    expect(dayReadiness(answers(450, 'high'), null)).toEqual({
      level: 'reduced',
      reasons: ['high_stress'],
    });
    expect(dayReadiness(answers(null, 'high'), null)).toEqual({
      level: 'reduced',
      reasons: ['high_stress'],
    });
    expect(dayReadiness(answers(390, 'low'), 480)).toEqual({
      level: 'reduced',
      reasons: ['below_usual_sleep'],
    });
  });

  it('is normal otherwise', () => {
    expect(dayReadiness(answers(390, 'normal'), null)).toEqual({ level: 'normal', reasons: [] });
    expect(dayReadiness(answers(null, 'low'), 450)).toEqual({ level: 'normal', reasons: [] });
    expect(dayReadiness(answers(400, null), 480)).toEqual({ level: 'normal', reasons: [] });
  });

  it('treats 0 minutes of sleep as a very short night', () => {
    expect(dayReadiness(answers(0), 450)).toEqual({
      level: 'low',
      reasons: ['very_short_sleep', 'below_usual_sleep'],
    });
  });

  it('puts sleep exactly on a threshold on the better side', () => {
    expect(dayReadiness(answers(300), null).level).toBe('reduced'); // 5 h is "5–6 h"
    expect(dayReadiness(answers(299), null).level).toBe('low');
    expect(dayReadiness(answers(360), null).level).toBe('normal'); // 6 h is "6–7 h"
    expect(dayReadiness(answers(359), null).level).toBe('reduced');
    expect(dayReadiness(answers(390), 480).level).toBe('reduced'); // exactly 90 min under
    expect(dayReadiness(answers(391), 480).level).toBe('normal');
  });

  it('lists every reason that fired, in a fixed order', () => {
    expect(dayReadiness(answers(270, 'high'), 480)).toEqual({
      level: 'low',
      reasons: ['very_short_sleep', 'below_usual_sleep', 'high_stress'],
    });
  });

  it('gives the same output for the same input', () => {
    expect(dayReadiness(answers(330, 'high'), 450)).toEqual(
      dayReadiness(answers(330, 'high'), 450),
    );
  });
});

describe('readinessHeadline (decision c of spec 011)', () => {
  it('picks one reason: under 5 h, then 5–6 h with stress, 5–6 h, under the usual, stress', () => {
    const headline = (sleep: number | null, stress: StressLevel | null, usual: number | null) =>
      readinessHeadline(dayReadiness(answers(sleep, stress), usual));
    expect(headline(270, 'high', 480)).toBe('very_short_sleep');
    expect(headline(330, 'high', 480)).toBe('short_sleep_high_stress');
    expect(headline(330, 'normal', 480)).toBe('short_sleep');
    expect(headline(380, 'high', 480)).toBe('below_usual_sleep');
    expect(headline(450, 'high', 480)).toBe('high_stress');
    expect(headline(450, 'normal', 480)).toBeNull();
    expect(headline(null, null, null)).toBeNull();
  });
});

describe('sessionCut (spec 011 AC7, Safety "Minimum session")', () => {
  it('removes a set only from exercises with 3 or more sets', () => {
    expect(sessionCut([3, 2, 4, 1], 'reduced')).toEqual({ sets: true, exercise: false });
    expect(sessionCut([2, 2, 1, 2], 'reduced')).toEqual({ sets: false, exercise: false });
  });

  it('also removes the last exercise on a low day when there are more than 4', () => {
    expect(sessionCut([3, 3, 3, 3, 3], 'low')).toEqual({ sets: true, exercise: true });
    expect(sessionCut([3, 3, 3, 3], 'low')).toEqual({ sets: true, exercise: false });
    expect(sessionCut([2, 2, 2, 2, 2], 'low')).toEqual({ sets: false, exercise: true });
  });

  it('removes nothing on a normal or unknown day', () => {
    expect(sessionCut([4, 4, 4, 4, 4], 'normal')).toEqual({ sets: false, exercise: false });
    expect(sessionCut([4, 4, 4, 4, 4], 'unknown')).toEqual({ sets: false, exercise: false });
  });
});

describe('readinessLine (spec 011 AC4, AC9, decision b)', () => {
  const routine = {
    session: { exercises: [{ sets: 3 }, { sets: 3 }, { sets: 3 }] },
    activities: [],
  };
  const football = { session: null, activities: [{ isMatch: false }] };
  const match = { session: null, activities: [{ isMatch: false }, { isMatch: true }] };
  const rest = { session: null, activities: [] };
  const low = dayReadiness(answers(270), null);
  const reduced = dayReadiness(answers(330), null);
  const normal = dayReadiness(answers(450, 'normal'), null);
  const unknown = dayReadiness(null, null);

  it('shows only "Check-in de hoy" with an unknown readiness', () => {
    expect(readinessLine(unknown, routine, false)).toEqual({ type: 'checkin' });
  });

  it('says all is fine on a normal training day, and nothing more on a rest day', () => {
    expect(readinessLine(normal, routine, true)).toEqual({ type: 'ready' });
    expect(readinessLine(normal, football, true)).toEqual({ type: 'ready' });
    expect(readinessLine(normal, rest, true)).toEqual({ type: 'checkin' });
  });

  it('says what the routine session loses on a reduced or low day', () => {
    expect(readinessLine(reduced, routine, true)).toEqual({
      type: 'routine',
      headline: 'short_sleep',
      cut: { sets: true, exercise: false },
    });
    const five = {
      session: { exercises: [3, 3, 3, 3, 3].map((sets) => ({ sets })) },
      activities: [],
    };
    expect(readinessLine(low, five, true)).toEqual({
      type: 'routine',
      headline: 'very_short_sleep',
      cut: { sets: true, exercise: true },
    });
  });

  it('shows only the reason when the routine has nothing to remove', () => {
    const light = { session: { exercises: [{ sets: 2 }, { sets: 2 }] }, activities: [] };
    expect(readinessLine(reduced, light, true)).toEqual({
      type: 'reason',
      headline: 'short_sleep',
    });
  });

  it('suggests an easy pace for an activity and a good warm-up for a match (AC9)', () => {
    expect(readinessLine(reduced, football, true)).toEqual({
      type: 'activity',
      headline: 'short_sleep',
      match: false,
    });
    expect(readinessLine(low, match, true)).toEqual({
      type: 'activity',
      headline: 'very_short_sleep',
      match: true,
    });
  });

  it('prefers the routine session over an activity of the same day', () => {
    const both = { ...routine, activities: [{ isMatch: true }] };
    expect(readinessLine(reduced, both, true).type).toBe('routine');
  });

  it('shows only the reason on a day without training', () => {
    expect(readinessLine(low, rest, true)).toEqual({
      type: 'reason',
      headline: 'very_short_sleep',
    });
  });
});

describe('sleepStressNotice (spec 011 AC13)', () => {
  const day = (
    daysAgo: number,
    sleepMinutes: number | null,
    stress: StressLevel | null = null,
  ) => ({
    localDate: addDays(TODAY, -daysAgo),
    sleepMinutes,
    stress,
  });

  it('fires with sleep under 6 h on at least 4 of the last 7 days', () => {
    const nights = [0, 1, 3, 6].map((d) => day(d, 330));
    expect(sleepStressNotice(nights, TODAY)).toBe('short_sleep');
    expect(sleepStressNotice(nights.slice(1), TODAY)).toBeNull();
  });

  it('counts only the 7 days up to today', () => {
    const nights = [1, 3, 6, 7].map((d) => day(d, 270));
    expect(sleepStressNotice(nights, TODAY)).toBeNull();
  });

  it('does not count 6 h as short', () => {
    expect(
      sleepStressNotice(
        [0, 1, 2, 3].map((d) => day(d, 360)),
        TODAY,
      ),
    ).toBeNull();
  });

  it('fires with high stress on at least 5 of the last 7 days', () => {
    const days = [0, 1, 2, 4, 5].map((d) => day(d, null, 'high'));
    expect(sleepStressNotice(days, TODAY)).toBe('high_stress');
    expect(sleepStressNotice(days.slice(1), TODAY)).toBeNull();
  });

  it('shows the sleep notice when both fire', () => {
    const days = [0, 1, 2, 3, 4].map((d) => day(d, 300, 'high'));
    expect(sleepStressNotice(days, TODAY)).toBe('short_sleep');
  });
});

describe('readinessLine without a sleep answer (domain review of spec 011)', () => {
  it('does not say all is fine from the stress answer alone', () => {
    const stressOnly = dayReadiness(answers(null, 'normal'), null);
    expect(stressOnly.level).toBe('normal');
    const plan = { session: null, activities: [{ isMatch: false }] };
    expect(readinessLine(stressOnly, plan, false)).toEqual({ type: 'checkin' });
  });

  it('still gives the reason of a high stress without sleep', () => {
    const stressHigh = dayReadiness(answers(null, 'high'), null);
    const plan = { session: null, activities: [{ isMatch: false }] };
    expect(readinessLine(stressHigh, plan, false)).toEqual({
      type: 'activity',
      headline: 'high_stress',
      match: false,
    });
  });
});

describe('readinessPlanSession', () => {
  it('counts only the exercises the live session will have', () => {
    const exercise = (exerciseId: string | null, sets: number) => ({ exerciseId, sets });
    expect(
      readinessPlanSession({
        exercises: [exercise('a', 3), exercise(null, 4), exercise('b', 2)] as never,
      }),
    ).toEqual({ exercises: [{ sets: 3 }, { sets: 2 }] });
  });
});

describe('sleepStressNotice with two rows of one day (AC15)', () => {
  it('counts each day once, the later write winning', () => {
    const row = (daysAgo: number, sleepMinutes: number, recordedAt: string) => ({
      localDate: addDays(TODAY, -daysAgo),
      sleepMinutes,
      stress: null,
      recordedAt,
    });
    const rows = [
      row(0, 330, '2026-11-23T07:00:00Z'),
      row(0, 450, '2026-11-23T08:00:00Z'),
      row(1, 330, '2026-11-22T07:00:00Z'),
      row(1, 330, '2026-11-22T06:00:00Z'),
      row(2, 330, '2026-11-21T07:00:00Z'),
      row(3, 330, '2026-11-20T07:00:00Z'),
    ];
    // Three short nights, not five rows.
    expect(sleepStressNotice(rows, TODAY)).toBeNull();
  });
});
