import type { SetValues } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { mentionName, trackingFromSets } from './mention';
import { EMPTY_SET } from './sets';

describe('mentionName: the words of an exercise without its sets (spec 012 AC7)', () => {
  it.each([
    ['press Larsen 4x8 con 60', 'Press Larsen'],
    ['press de banca 4 series de 8 a 60 kilos', 'Press de banca'],
    ['4 series de press banca con 60', 'Press banca'],
    ['dominadas 3x6 con 10 kg de lastre', 'Dominadas'],
    ['plancha lateral 3 x 45 segundos', 'Plancha lateral'],
    ['remo 2000 m en 8:30', 'Remo'],
    ['Zercher squat 5x5 at 135 lbs', 'Zercher squat'],
    ['  sentadilla búlgara, ', 'Sentadilla búlgara'],
  ])('%s → %s', (mention, name) => {
    expect(mentionName(mention)).toBe(name);
  });

  it('gives an empty name when only sets were said', () => {
    expect(mentionName('8, 8, 7 y 6 con 60')).toBe('');
    expect(mentionName('   ')).toBe('');
  });
});

const set = (values: Partial<SetValues>): SetValues => ({ ...EMPTY_SET, ...values });

describe('trackingFromSets: how a new exercise is tracked, from the sets said (AC7)', () => {
  it('reads weight and reps, reps only, time, and distance', () => {
    expect(trackingFromSets([set({ reps: 8, weightKg: 60 })])).toBe('weight_reps');
    expect(trackingFromSets([set({ reps: 12 })])).toBe('reps');
    expect(trackingFromSets([set({ durationS: 45 })])).toBe('duration');
    expect(trackingFromSets([set({ distanceM: 2000, durationS: 510 })])).toBe('distance_duration');
  });

  it('uses every set: a weight said for one set makes it a weight exercise', () => {
    expect(trackingFromSets([set({ reps: 8 }), set({ reps: 6, weightKg: 65 })])).toBe(
      'weight_reps',
    );
  });

  it('gives null when no value was said', () => {
    expect(trackingFromSets([])).toBeNull();
    expect(trackingFromSets([EMPTY_SET])).toBeNull();
  });
});
