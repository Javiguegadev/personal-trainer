import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { loggingStreak } from './streak';

/**
 * The logging streak (spec 014 AC9, AC10): weeks in a row, Monday to Sunday, with at least 4 days with
 * something logged. Today is Wednesday 25 November 2026 (its week starts on Monday 23).
 */
const TODAY = '2026-11-25';

/** `count` days of the week starting on `monday`. */
const week = (monday: string, count: number) =>
  Array.from({ length: count }, (_, i) => addDays(monday, i));

describe('loggingStreak (spec 014)', () => {
  it('counts the complete weeks in a row with 4 days, ending with the last one (AC9)', () => {
    const days = [
      ...week('2026-11-02', 4),
      ...week('2026-11-09', 5),
      ...week('2026-11-16', 4),
      ...week('2026-11-23', 2),
    ];
    expect(loggingStreak({ loggedDays: days, today: TODAY, flags: [] })).toEqual({
      weeks: 3,
      currentWeekDays: 2,
      hidden: false,
    });
  });

  it('adds the current week as soon as it reaches 4 days (AC9)', () => {
    const days = [...week('2026-11-16', 4), ...week('2026-11-23', 3), '2026-11-29'];
    // Sunday 29 is after today: it does not count yet.
    expect(loggingStreak({ loggedDays: days, today: TODAY, flags: [] }).weeks).toBe(1);
    const four = [...week('2026-11-16', 4), ...week('2026-11-23', 3), '2026-11-25'];
    expect(loggingStreak({ loggedDays: four, today: TODAY, flags: [] })).toMatchObject({
      weeks: 1,
      currentWeekDays: 3,
    });
    const reached = [...week('2026-11-16', 4), ...week('2026-11-23', 4)];
    expect(loggingStreak({ loggedDays: reached, today: '2026-11-26', flags: [] }).weeks).toBe(2);
  });

  it('restarts after a week with fewer than 4 days (AC10)', () => {
    const days = [...week('2026-11-02', 6), ...week('2026-11-09', 3), ...week('2026-11-16', 4)];
    expect(loggingStreak({ loggedDays: days, today: TODAY, flags: [] }).weeks).toBe(1);
    expect(
      loggingStreak({ loggedDays: week('2026-11-09', 7), today: TODAY, flags: [] }).weeks,
    ).toBe(0);
  });

  it('counts a day once, whatever was logged on it', () => {
    const days = [
      '2026-11-16',
      '2026-11-16',
      '2026-11-17',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
    ];
    expect(loggingStreak({ loggedDays: days, today: TODAY, flags: [] }).weeks).toBe(1);
    expect(loggingStreak({ loggedDays: days.slice(0, 5), today: TODAY, flags: [] }).weeks).toBe(0);
  });

  it('is hidden with an eating-disorder signal (AC10)', () => {
    expect(
      loggingStreak({ loggedDays: week('2026-11-16', 7), today: TODAY, flags: ['ed_soft_stop'] }),
    ).toEqual({ weeks: 0, currentWeekDays: 0, hidden: true });
  });
});
