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
  trainingFocus: 'general_fitness',
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
    expect(result.targets?.formulaVersion).toBe('targets-v3');
    expect(result.breakdown).not.toBeNull();
    expect(result.flags).toEqual([]);
  });

  it('uses what the user trains for (spec 004 AC6, AC10)', () => {
    const protein = (trainingFocus: ProfileInput['trainingFocus']) => {
      const result = evaluateProfileInput(input({ trainingFocus }), [], NOW);
      return result.kind === 'ok' ? result.breakdown : null;
    };
    // 62 kg, maintain: 1.6 → 99 g; strength 1.8 → 112 g.
    expect(protein('general_fitness')).toMatchObject({ proteinGPerKg: 1.6 });
    expect(protein('strength')).toMatchObject({ proteinGPerKg: 1.8, trainingFocus: 'strength' });
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

describe('evaluateProfileInput with the weight log (spec 003 AC12)', () => {
  // 165 cm: BMI 20.5 is 55.81 kg. The profile was flagged low_bmi earlier.
  const entries = [
    { localDate: '2026-11-09', weightKg: 56 },
    { localDate: '2026-11-10', weightKg: 56 },
  ];
  const form = input({ weightKg: 56, goal: 'lose' });

  it('judges the log as the save will leave it (a new weight becomes today’s entry)', () => {
    // Stored 54 kg, typed 56: today's entry is added, 3 entries averaging 56 kg (BMI 20.57).
    const result = evaluateProfileInput(form, ['low_bmi'], NOW, { storedWeightKg: 54, entries });
    expect(result).toMatchObject({ kind: 'ok', safety: { appliedGoal: 'lose' } });
  });

  it('keeps no deficit without a 7-day average', () => {
    expect(evaluateProfileInput(form, ['low_bmi'], NOW)).toMatchObject({
      safety: { appliedGoal: 'maintain' },
    });
    // The same weight as stored adds no entry: 2 entries, no average.
    expect(
      evaluateProfileInput(form, ['low_bmi'], NOW, { storedWeightKg: 56, entries }),
    ).toMatchObject({ safety: { appliedGoal: 'maintain' } });
  });
});
