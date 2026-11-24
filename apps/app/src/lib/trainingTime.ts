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

const HOUR_MS = 60 * 60 * 1000;

/**
 * The default start of a past session (spec 009 AC17, spec 010 AC12): an hour ago, on `day` at that
 * hour when it is not today.
 */
export function pastSessionStart(day: string, today: string, now: Date): string {
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  if (day === today) return hourAgo.toISOString();
  return localDateTime(day, toLocalTime(hourAgo)) ?? hourAgo.toISOString();
}

/**
 * The start of a sentence draft (spec 012 AC4): the time said on the draft's day, unless it has not
 * come yet ("a las 7 de la tarde" said at noon); otherwise the default start of a past session.
 */
export function draftStart(
  day: string,
  startTime: string | null,
  today: string,
  now: Date,
): string {
  const said = startTime ? localDateTime(day, startTime) : null;
  if (said && Date.parse(said) <= now.getTime()) return said;
  return pastSessionStart(day, today, now);
}
