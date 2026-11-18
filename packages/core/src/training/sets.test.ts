import { describe, expect, it } from 'vitest';
import { kgToLb } from '../units';
import {
  EMPTY_SET,
  displayWeight,
  formatDuration,
  isWeightJump,
  parseDurationField,
  parseSetWeightField,
  setForTracking,
  setMatchesTracking,
  stepWeight,
  withPlaceholder,
} from './sets';

const set = (values: Partial<typeof EMPTY_SET>) => ({ ...EMPTY_SET, ...values });

describe('setMatchesTracking (AC8)', () => {
  it.each([
    ['weight_reps', set({ reps: 8, weightKg: 60 }), true],
    ['weight_reps', set({ reps: 8, weightKg: 0 }), true],
    ['weight_reps', set({ reps: 8 }), false],
    ['reps', set({ reps: 10 }), true],
    ['reps', set({ weightKg: 10 }), false],
    ['duration', set({ durationS: 45 }), true],
    ['duration', set({ reps: 1 }), false],
    ['distance_duration', set({ distanceM: 5000 }), true],
    ['distance_duration', set({ durationS: 1500 }), false],
  ] as const)('%s %j → %s', (tracking, values, expected) => {
    expect(setMatchesTracking(values, tracking)).toBe(expected);
  });
});

describe('setForTracking', () => {
  it('drops the fields the tracking does not use, and a zero extra weight', () => {
    const all = { reps: 8, weightKg: 0, durationS: 30, distanceM: 100 };
    expect(setForTracking(all, 'weight_reps')).toEqual(set({ reps: 8, weightKg: 0 }));
    expect(setForTracking(all, 'reps')).toEqual(set({ reps: 8 }));
    expect(setForTracking({ ...all, weightKg: 10 }, 'reps')).toEqual(
      set({ reps: 8, weightKg: 10 }),
    );
    expect(setForTracking(all, 'duration')).toEqual(set({ durationS: 30 }));
    expect(setForTracking(all, 'distance_duration')).toEqual(
      set({ distanceM: 100, durationS: 30 }),
    );
  });
});

describe('withPlaceholder (AC8)', () => {
  it('fills only the empty fields', () => {
    expect(withPlaceholder(set({ reps: 6 }), set({ reps: 8, weightKg: 60 }))).toEqual(
      set({ reps: 6, weightKg: 60 }),
    );
    expect(withPlaceholder(set({ reps: 6 }), null)).toEqual(set({ reps: 6 }));
  });
});

describe('stepWeight (AC8)', () => {
  it('steps 2.5 kg and snaps an odd weight to the step', () => {
    expect(stepWeight(60, 1, 'metric')).toBe(62.5);
    expect(stepWeight(60, -1, 'metric')).toBe(57.5);
    expect(stepWeight(61, 1, 'metric')).toBe(62.5);
    expect(stepWeight(61, -1, 'metric')).toBe(60);
    expect(stepWeight(null, 1, 'metric')).toBe(2.5);
    expect(stepWeight(0, -1, 'metric')).toBe(0);
    expect(stepWeight(500, 1, 'metric')).toBe(500);
  });

  it('steps 5 lb and keeps the number shown in lb after the round trip', () => {
    let kg = stepWeight(null, 1, 'imperial');
    for (let i = 0; i < 40; i++) kg = stepWeight(kg, 1, 'imperial');
    expect(displayWeight(kg, 'imperial')).toBe(205);
    expect(displayWeight(stepWeight(kg, -1, 'imperial'), 'imperial')).toBe(200);
    expect(Math.abs(kgToLb(kg) - 205)).toBeLessThan(0.05);
  });
});

describe('parseSetWeightField', () => {
  it('reads commas, converts lb and rejects bad input', () => {
    expect(parseSetWeightField('62,5', 'metric')).toBe(62.5);
    expect(parseSetWeightField('135', 'imperial')).toBe(61.23);
    expect(parseSetWeightField('', 'metric')).toBeNull();
    expect(parseSetWeightField('-1', 'metric')).toBeNull();
    expect(parseSetWeightField('abc', 'metric')).toBeNull();
    expect(parseSetWeightField('501', 'metric')).toBeNull();
  });
});

describe('durations', () => {
  it('parses mm:ss, h:mm:ss and seconds', () => {
    expect(parseDurationField('1:30')).toBe(90);
    expect(parseDurationField('45')).toBe(45);
    expect(parseDurationField('1:02:03')).toBe(3723);
    expect(parseDurationField('1:75')).toBeNull();
    expect(parseDurationField('0')).toBeNull();
    expect(parseDurationField('4:00:00')).toBeNull();
    expect(parseDurationField('a:10')).toBeNull();
  });

  it('formats seconds', () => {
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(3723)).toBe('1:02:03');
  });
});

describe('isWeightJump (Safety)', () => {
  it('asks above 150 % of the heaviest weight, never without history', () => {
    expect(isWeightJump(90, 60)).toBe(false);
    expect(isWeightJump(90.5, 60)).toBe(true);
    expect(isWeightJump(250, null)).toBe(false);
    expect(isWeightJump(null, 60)).toBe(false);
  });
});
