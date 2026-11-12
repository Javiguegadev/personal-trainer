import type { ProfileInput } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { checkClientDates, evaluateProfileInput } from './evaluate';

const NOW = new Date('2026-11-11T10:00:00.000Z');

const input = (overrides: Partial<ProfileInput> = {}): ProfileInput => ({
  sex: 'female',
  birthDate: '1990-05-01',
  heightCm: 165,
  weightKg: 62,
  targetWeightKg: null,
  jobActivity: 'sedentary',
  plannedActivities: [],
  goal: 'maintain',
  injuries: null,
  healthFlags: [],
  units: 'metric',
  locale: 'es',
  dietaryPrefs: { dietType: 'omnivore', allergies: [], dislikes: [], restrictions: [] },
  today: '2026-11-11',
  ...overrides,
});

describe('checkClientDates', () => {
  it('accepts the client date within ±1 day of the server UTC date', () => {
    expect(checkClientDates({ today: '2026-11-10' }, NOW)).toBeNull();
    expect(checkClientDates({ today: '2026-11-12' }, NOW)).toBeNull();
  });

  it('rejects an implausible client date', () => {
    expect(checkClientDates({ today: '2026-11-14' }, NOW)).toEqual({ today: 'implausible' });
  });

  it('rejects a birth date in the future (AC22)', () => {
    expect(checkClientDates({ today: '2026-11-11', birthDate: '2026-11-12' }, NOW)).toEqual({
      birthDate: 'in_future',
    });
  });
});

describe('evaluateProfileInput', () => {
  it('returns targets and the safety evaluation for an adult', () => {
    const result = evaluateProfileInput(input(), [], NOW);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.targets?.formulaVersion).toBe('targets-v2');
    expect(result.breakdown).not.toBeNull();
    expect(result.flags).toEqual([]);
  });

  it('blocks under 16 (AC17)', () => {
    expect(evaluateProfileInput(input({ birthDate: '2012-01-01' }), [], NOW)).toEqual({
      kind: 'blocked',
    });
  });

  it('returns no numbers for pregnancy (AC19)', () => {
    const result = evaluateProfileInput(input({ healthFlags: ['pregnancy'] }), [], NOW);
    expect(result).toMatchObject({ kind: 'ok', targets: null, breakdown: null });
  });

  it('adds calorie_floor to the stored flags when targets were clamped (AC14)', () => {
    const result = evaluateProfileInput(
      input({
        sex: 'female',
        heightCm: 150,
        weightKg: 47,
        goal: 'lose',
      }),
      [],
      NOW,
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.targets?.clampedReason).toBe('calorie_floor');
    expect(result.flags).toContain('calorie_floor');
  });

  it('counts the job and the weekly training (spec 002 AC6)', () => {
    const kcal = (overrides: Partial<ProfileInput>) => {
      const result = evaluateProfileInput(input(overrides), [], NOW);
      return result.kind === 'ok' ? (result.targets?.kcal ?? 0) : 0;
    };
    const seated = kcal({});
    const gym = {
      kind: 'strength' as const,
      label: null,
      sessionsPerWeek: 4,
      minutesPerSession: 60,
      intensity: 'moderate' as const,
    };
    expect(kcal({ jobActivity: 'physical' })).toBeGreaterThan(seated);
    expect(kcal({ plannedActivities: [gym] })).toBeGreaterThan(seated);
  });

  it('flags a high training load and stores it (spec 002 AC11)', () => {
    const result = evaluateProfileInput(
      input({
        plannedActivities: [
          {
            kind: 'cardio',
            label: null,
            sessionsPerWeek: 5,
            minutesPerSession: 120,
            intensity: 'moderate',
          },
        ],
      }),
      [],
      NOW,
    );
    expect(result).toMatchObject({ kind: 'ok', flags: ['high_training_load'] });
    if (result.kind !== 'ok') return;
    expect(result.safety.flags).toContain('high_training_load');
  });

  it('keeps ed_soft_stop from earlier evaluations (AC20)', () => {
    const result = evaluateProfileInput(input({ goal: 'lose' }), ['ed_soft_stop'], NOW);
    expect(result).toMatchObject({ kind: 'ok', safety: { appliedGoal: 'maintain' } });
  });
});
