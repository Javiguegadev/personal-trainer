import { ContextSnapshotSchema, type PlannedActivity } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { buildContextSnapshot, type ContextSources } from './snapshot';

const TODAY = '2026-11-11';

const gym: PlannedActivity = {
  kind: 'strength',
  label: null,
  sessionsPerWeek: 3,
  minutesPerSession: 60,
  intensity: 'moderate',
};
const football: PlannedActivity = {
  kind: 'sport',
  label: 'fútbol',
  sessionsPerWeek: 2,
  minutesPerSession: 90,
  intensity: 'moderate',
};

const sources: ContextSources = {
  profile: {
    sex: 'male',
    birthDate: '1996-11-11',
    heightCm: 175,
    weightKg: 80,
    targetWeightKg: 76,
    goal: 'lose',
  },
  safetyFlags: ['injury'],
  jobActivity: 'sedentary',
  plannedActivities: [gym, football],
  trainingFocus: 'strength',
};

describe('buildContextSnapshot — context-v3 (spec 002 AC12, spec 003 AC25, spec 004 AC11)', () => {
  it('returns the profile, the job and the planned training for the given day', () => {
    const snapshot = buildContextSnapshot(sources, TODAY);
    expect(snapshot).toEqual({
      version: 'context-v3',
      date: TODAY,
      profile: {
        sex: 'male',
        ageYears: 30,
        heightCm: 175,
        weightKg: 80,
        targetWeightKg: 76,
        goal: 'lose',
      },
      safetyFlags: ['injury'],
      job: { activity: 'sedentary', factor: 1.4 },
      training: {
        activities: [gym, football],
        sessionsPerWeek: 5,
        minutesPerWeek: 360,
        // (3 h × 2.5 + 3 h × 5) / 168
        factor: 22.5 / 168,
        focus: 'strength',
      },
      weight: {
        lastKg: null,
        lastDate: null,
        averageKg: null,
        changePerWeekKg: null,
        fastLoss: false,
        trendHidden: false,
      },
    });
    expect(ContextSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('describes a user who does not train', () => {
    const snapshot = buildContextSnapshot({ ...sources, plannedActivities: [] }, TODAY);
    expect(snapshot.training).toEqual({
      activities: [],
      sessionsPerWeek: 0,
      minutesPerWeek: 0,
      factor: 0,
      focus: 'strength',
    });
  });

  const weights = [
    { localDate: '2026-11-01', weightKg: 80 },
    { localDate: '2026-11-03', weightKg: 80 },
    { localDate: '2026-11-05', weightKg: 80 },
    { localDate: '2026-11-06', weightKg: 79.8 },
    { localDate: '2026-11-08', weightKg: 79.6 },
    { localDate: '2026-11-10', weightKg: 79.4 },
  ];

  it('adds the weight log: last entry, 7-day average and change per week (spec 003 AC25)', () => {
    // Recent window (5–11 Nov): 80, 79.8, 79.6, 79.4 → 79.7 on mean day 3.75 before today.
    // Earlier window (29 Oct–4 Nov): 80, 80 → only 2 entries, so no change per week.
    const { weight } = buildContextSnapshot({ ...sources, weights }, TODAY);
    expect(weight).toEqual({
      lastKg: 79.4,
      lastDate: '2026-11-10',
      averageKg: expect.closeTo(79.7, 10) as number,
      changePerWeekKg: null,
      fastLoss: false,
      trendHidden: false,
    });
  });

  it.each(['ed_soft_stop', 'pregnancy'] as const)(
    'hides the trend with %s, keeping the last weight',
    (flag) => {
      // A fast loss (2 % per week) is not passed on either.
      const fast = [
        { localDate: '2026-11-01', weightKg: 80 },
        { localDate: '2026-11-02', weightKg: 80 },
        { localDate: '2026-11-03', weightKg: 80 },
        { localDate: '2026-11-08', weightKg: 78.4 },
        { localDate: '2026-11-09', weightKg: 78.4 },
        { localDate: '2026-11-10', weightKg: 78.4 },
      ];
      expect(buildContextSnapshot({ ...sources, weights: fast }, TODAY).weight.fastLoss).toBe(true);
      expect(
        buildContextSnapshot({ ...sources, safetyFlags: [flag], weights: fast }, TODAY).weight,
      ).toMatchObject({ fastLoss: false, trendHidden: true });

      const { weight } = buildContextSnapshot({ ...sources, safetyFlags: [flag], weights }, TODAY);
      expect(weight).toMatchObject({
        lastKg: 79.4,
        averageKg: null,
        changePerWeekKg: null,
        trendHidden: true,
      });
    },
  );

  it('uses the age on the given day', () => {
    expect(buildContextSnapshot(sources, '2026-11-10').profile.ageYears).toBe(29);
  });

  it('is pure: same input, same output, and the sources are not modified or shared', () => {
    const frozen = JSON.parse(JSON.stringify(sources)) as ContextSources;
    const a = buildContextSnapshot(sources, TODAY);
    const b = buildContextSnapshot(sources, TODAY);
    expect(a).toEqual(b);
    expect(sources).toEqual(frozen);
    a.training.activities[0]!.sessionsPerWeek = 7;
    a.safetyFlags.push('low_bmi');
    expect(sources).toEqual(frozen);
  });
});
