import { describe, expect, it } from 'vitest';
import {
  addDays,
  isPlausibleClientDate,
  isoWeekday,
  lastDays,
  localToday,
  toLocalIsoDate,
  toLocalTime,
  weekDays,
  weekStartOf,
} from './dates';

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

describe('localToday (spec 010 AC6)', () => {
  const MADRID = 'Europe/Madrid';
  const at = (iso: string, dayStart: number) => localToday(new Date(iso), dayStart, MADRID);

  it('counts the small hours as the day before when the day starts at 04:00', () => {
    // Tuesday 17 Nov 2026, 02:30 in Madrid (UTC+1).
    expect(at('2026-11-17T01:30:00Z', 240)).toBe('2026-11-16');
    expect(at('2026-11-17T02:59:00Z', 240)).toBe('2026-11-16'); // 03:59
    expect(at('2026-11-17T03:00:00Z', 240)).toBe('2026-11-17'); // 04:00
  });

  it('changes nothing with the default 00:00', () => {
    expect(at('2026-11-16T23:00:00Z', 0)).toBe('2026-11-17'); // 00:00
    expect(at('2026-11-16T22:59:00Z', 0)).toBe('2026-11-16'); // 23:59
  });

  it('uses the wall clock across the daylight-saving nights', () => {
    // 29 Mar 2026: 02:00 CET jumps to 03:00 CEST.
    expect(at('2026-03-29T00:59:00Z', 240)).toBe('2026-03-28'); // 01:59 CET
    expect(at('2026-03-29T01:30:00Z', 240)).toBe('2026-03-28'); // 03:30 CEST
    expect(at('2026-03-29T02:00:00Z', 240)).toBe('2026-03-29'); // 04:00 CEST
    // 25 Oct 2026: 03:00 CEST goes back to 02:00 CET; 02:30 happens twice.
    expect(at('2026-10-25T00:30:00Z', 240)).toBe('2026-10-24'); // 02:30 CEST
    expect(at('2026-10-25T01:30:00Z', 240)).toBe('2026-10-24'); // 02:30 CET
    expect(at('2026-10-25T02:59:00Z', 240)).toBe('2026-10-24'); // 03:59 CET
    expect(at('2026-10-25T03:00:00Z', 240)).toBe('2026-10-25'); // 04:00 CET
  });

  it("uses the device's zone without a time zone", () => {
    expect(localToday(new Date(2026, 10, 17, 2, 30), 240)).toBe('2026-11-16');
    expect(localToday(new Date(2026, 10, 17, 4, 0), 240)).toBe('2026-11-17');
  });
});

describe('isoWeekday, weekStartOf and weekDays', () => {
  it('numbers the weekdays from Monday = 1 to Sunday = 7', () => {
    expect(isoWeekday('2026-11-16')).toBe(1);
    expect(isoWeekday('2026-11-18')).toBe(3);
    expect(isoWeekday('2026-11-22')).toBe(7);
  });

  it('returns the Monday of the week', () => {
    expect(weekStartOf('2026-11-18')).toBe('2026-11-16'); // Wednesday
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16'); // Monday
    expect(weekStartOf('2026-11-22')).toBe('2026-11-16'); // Sunday
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
  });

  it('lists the seven days from Monday, across a month', () => {
    expect(weekDays('2026-11-30')).toEqual([
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
    ]);
  });
});
