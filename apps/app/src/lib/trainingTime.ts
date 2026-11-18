import { toLocalTime } from '@pt/core';

/**
 * A day and a typed time (`18:30`, `7:05`) in the device's time zone, as an ISO instant; null when the
 * time is not valid (spec 009 AC17).
 */
export function localDateTime(day: string, time: string): string | null {
  const match = /^(\d{1,2})[:.h](\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d, hours, minutes);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The same time of day on another day (AC19: a workout moved to another day keeps its hour). */
export function moveToDay(startedAt: string, day: string): string {
  return localDateTime(day, toLocalTime(new Date(startedAt))) ?? startedAt;
}
