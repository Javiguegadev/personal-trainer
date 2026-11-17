import { describe, expect, it } from 'vitest';
import { mealTypeForTime } from './meal-type';

const at = (hours: number, minutes = 0) => hours * 60 + minutes;

describe('mealTypeForTime (AC12)', () => {
  it.each([
    [at(5), 'breakfast'],
    [at(10, 59), 'breakfast'],
    [at(11), 'mid_morning'],
    [at(12, 59), 'mid_morning'],
    [at(13), 'lunch'],
    [at(16, 29), 'lunch'],
    [at(16, 30), 'afternoon_snack'],
    [at(19, 59), 'afternoon_snack'],
    [at(20), 'dinner'],
    [at(23, 59), 'dinner'],
    [at(0), 'dinner'],
    [at(4, 59), 'dinner'],
  ] as const)('%i minutes → %s', (minutes, meal) => {
    expect(mealTypeForTime(minutes)).toBe(meal);
  });
});
