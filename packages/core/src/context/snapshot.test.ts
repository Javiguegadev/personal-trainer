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
};

describe('buildContextSnapshot — context-v1 (spec 002 AC12)', () => {
  it('returns the profile, the job and the planned training for the given day', () => {
    const snapshot = buildContextSnapshot(sources, TODAY);
    expect(snapshot).toEqual({
      version: 'context-v1',
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
    });
  });

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
