import type { PlannedActivity } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_MET,
  isHighTrainingLoad,
  jobFactor,
  trainingFactor,
  trainingMinutesPerWeek,
  trainingSessionsPerWeek,
} from './activity';

const activity = (overrides: Partial<PlannedActivity> = {}): PlannedActivity => ({
  kind: 'strength',
  label: null,
  sessionsPerWeek: 4,
  minutesPerSession: 60,
  intensity: 'moderate',
  ...overrides,
});

describe('jobFactor (spec 002 AC6)', () => {
  it('is 1.4 seated, 1.6 on your feet and 1.8 for physical work', () => {
    expect(jobFactor('sedentary')).toBe(1.4);
    expect(jobFactor('standing')).toBe(1.6);
    expect(jobFactor('physical')).toBe(1.8);
  });
});

describe('trainingFactor (spec 002 AC6)', () => {
  it('is 0 without training (AC3)', () => {
    expect(trainingFactor([])).toBe(0);
  });

  it('is hours per week × (MET − 1) / 168 for one activity', () => {
    // 4 h × (3.5 − 1) / 168
    expect(trainingFactor([activity()])).toBeCloseTo(10 / 168, 10);
  });

  it('adds up every activity: gym + football + a match', () => {
    const week = [
      activity({ sessionsPerWeek: 3 }), // 3 h × 2.5 = 7.5
      activity({ kind: 'sport', sessionsPerWeek: 2, minutesPerSession: 90 }), // 3 h × 5 = 15
      activity({ kind: 'sport', sessionsPerWeek: 1, minutesPerSession: 90, intensity: 'hard' }), // 1.5 h × 7 = 10.5
    ];
    expect(trainingFactor(week)).toBeCloseTo(33 / 168, 10);
  });

  it('uses the provisional MET table', () => {
    expect(ACTIVITY_MET).toEqual({
      strength: { light: 3.0, moderate: 3.5, hard: 5.0 },
      cardio: { light: 4.0, moderate: 6.0, hard: 8.5 },
      sport: { light: 4.0, moderate: 6.0, hard: 8.0 },
      other: { light: 2.5, moderate: 4.0, hard: 6.0 },
    });
  });

  it('grows with intensity, duration and frequency for every kind', () => {
    for (const kind of ['strength', 'cardio', 'sport', 'other'] as const) {
      const base = trainingFactor([activity({ kind, intensity: 'light' })]);
      expect(base).toBeGreaterThan(0);
      expect(trainingFactor([activity({ kind, intensity: 'moderate' })])).toBeGreaterThan(base);
      expect(trainingFactor([activity({ kind, intensity: 'hard' })])).toBeGreaterThan(
        trainingFactor([activity({ kind, intensity: 'moderate' })]),
      );
      expect(
        trainingFactor([activity({ kind, intensity: 'light', minutesPerSession: 90 })]),
      ).toBeGreaterThan(base);
      expect(
        trainingFactor([activity({ kind, intensity: 'light', sessionsPerWeek: 5 })]),
      ).toBeGreaterThan(base);
    }
  });
});

describe('weekly totals', () => {
  const week = [
    activity(),
    activity({ kind: 'cardio', sessionsPerWeek: 2, minutesPerSession: 45 }),
  ];

  it('adds up minutes and sessions', () => {
    expect(trainingMinutesPerWeek(week)).toBe(330);
    expect(trainingSessionsPerWeek(week)).toBe(6);
    expect(trainingMinutesPerWeek([])).toBe(0);
  });

  it('flags a high training load from 600 minutes per week (AC11)', () => {
    expect(isHighTrainingLoad(599)).toBe(false);
    expect(isHighTrainingLoad(600)).toBe(true);
  });
});
