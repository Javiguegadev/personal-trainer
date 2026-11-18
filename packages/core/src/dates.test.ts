import { describe, expect, it } from 'vitest';
import { addDays, isPlausibleClientDate, lastDays, toLocalIsoDate, toLocalTime } from './dates';

describe('toLocalTime', () => {
  it('is the local HH:mm, zero-padded', () => {
    expect(toLocalTime(new Date(2026, 0, 5, 7, 5))).toBe('07:05');
    expect(toLocalTime(new Date(2026, 10, 11, 23, 59))).toBe('23:59');
  });
});

describe('toLocalIsoDate', () => {
  it('uses the local calendar date, zero-padded', () => {
    expect(toLocalIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(toLocalIsoDate(new Date(2026, 10, 11, 0, 1))).toBe('2026-11-11');
  });
});

describe('isPlausibleClientDate', () => {
  const now = '2026-11-11T23:30:00.000Z';
  it('accepts the server date and one day either side', () => {
    expect(isPlausibleClientDate('2026-11-11', now)).toBe(true);
    expect(isPlausibleClientDate('2026-11-12', now)).toBe(true);
    expect(isPlausibleClientDate('2026-11-10', now)).toBe(true);
  });
  it('rejects anything further away', () => {
    expect(isPlausibleClientDate('2026-11-13', now)).toBe(false);
    expect(isPlausibleClientDate('2025-11-11', now)).toBe(false);
  });
});

describe('addDays', () => {
  it('crosses months, years and leap days', () => {
    expect(addDays('2026-11-13', -13)).toBe('2026-10-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-13', 0)).toBe('2026-11-13');
  });
});

describe('lastDays', () => {
  it('lists today and the days before, newest first, across a month', () => {
    expect(lastDays('2026-03-02', 4)).toEqual([
      '2026-03-02',
      '2026-03-01',
      '2026-02-28',
      '2026-02-27',
    ]);
  });
});
