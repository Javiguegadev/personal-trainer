import { toLocalIsoDate, toLocalTime } from '@pt/core';
import { describe, expect, it } from 'vitest';
import { draftStart, localDateTime, moveToDay, pastSessionStart } from './trainingTime';

describe('localDateTime', () => {
  it('reads a typed time on a day of the device', () => {
    const iso = localDateTime('2026-11-17', '18:30')!;
    expect(toLocalIsoDate(new Date(iso))).toBe('2026-11-17');
    expect(toLocalTime(new Date(iso))).toBe('18:30');
    expect(toLocalTime(new Date(localDateTime('2026-11-17', '7.05')!))).toBe('07:05');
  });

  it('rejects what is not a time', () => {
    expect(localDateTime('2026-11-17', '25:00')).toBeNull();
    expect(localDateTime('2026-11-17', '18:7')).toBeNull();
    expect(localDateTime('2026-11-17', 'tarde')).toBeNull();
  });
});

describe('moveToDay', () => {
  it('keeps the hour', () => {
    const start = localDateTime('2026-11-17', '19:15')!;
    const moved = moveToDay(start, '2026-11-15');
    expect(toLocalIsoDate(new Date(moved))).toBe('2026-11-15');
    expect(toLocalTime(new Date(moved))).toBe('19:15');
  });
});

describe('pastSessionStart and draftStart (spec 012 AC4)', () => {
  const now = new Date(2026, 10, 24, 12, 30);
  const today = '2026-11-24';

  it('starts a past session an hour ago, at that hour on another day', () => {
    expect(pastSessionStart(today, today, now)).toBe(new Date(2026, 10, 24, 11, 30).toISOString());
    const other = new Date(pastSessionStart('2026-11-22', today, now));
    expect(toLocalIsoDate(other)).toBe('2026-11-22');
    expect(toLocalTime(other)).toBe('11:30');
  });

  it('uses the time said, unless it has not come yet', () => {
    expect(toLocalTime(new Date(draftStart('2026-11-23', '19:00', today, now)))).toBe('19:00');
    expect(toLocalTime(new Date(draftStart(today, '07:15', today, now)))).toBe('07:15');
    expect(draftStart(today, '19:00', today, now)).toBe(pastSessionStart(today, today, now));
    expect(draftStart(today, null, today, now)).toBe(pastSessionStart(today, today, now));
  });
});
