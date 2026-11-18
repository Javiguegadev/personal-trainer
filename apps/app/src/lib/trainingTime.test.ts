import { toLocalIsoDate, toLocalTime } from '@pt/core';
import { describe, expect, it } from 'vitest';
import { localDateTime, moveToDay } from './trainingTime';

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
