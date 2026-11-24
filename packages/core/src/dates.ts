/** Date-only helpers on `YYYY-MM-DD` strings. Pure: callers inject "today". */

function parts(isoDate: string): [number, number, number] {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined || [y, m, d].some(Number.isNaN)) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  return [y, m, d];
}

/** Full years between `birthDate` and `today` (a 29 Feb birthday counts on 1 March in common years). */
export function computeAge(birthDate: string, today: string): number {
  const [by, bm, bd] = parts(birthDate);
  const [ty, tm, td] = parts(today);
  const hadBirthday = tm > bm || (tm === bm && td >= bd);
  return ty - by - (hadBirthday ? 0 : 1);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** The date `days` after `isoDate` (negative = before). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = parts(isoDate);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** `today` and the days before it, newest first: the chips of a day selector. */
export function lastDays(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(today, -i));
}

/**
 * Latest birth date consistent with being `ageYears` old on `today` (they turn that age today).
 * 29 February maps to 28 February in common years.
 */
export function birthDateFromAge(ageYears: number, today: string): string {
  const [y, m, d] = parts(today);
  const year = y - ageYears;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === 2 && d === 29 && !isLeap ? 28 : d;
  return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The calendar date of `date` in the device's time zone, as `YYYY-MM-DD` (the client's "today"). */
export function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The wall-clock date and minute of `date`, in `timeZone` (an IANA name) or the device's zone. */
function wallClock(date: Date, timeZone?: string): { isoDate: string; minute: number } {
  if (timeZone === undefined) {
    return { isoDate: toLocalIsoDate(date), minute: date.getHours() * 60 + date.getMinutes() };
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    isoDate: `${part('year')}-${part('month')}-${part('day')}`,
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

/**
 * The user's "today" (spec 010 AC6): the local calendar date, or the day before while the wall clock
 * is earlier than "Mi día empieza a las" (`dayStartMinute`, minutes after midnight). It compares wall
 * clock times, so a daylight-saving change moves nothing. `timeZone` is for tests and the server; the
 * app omits it and uses the device's zone.
 */
export function localToday(now: Date, dayStartMinute: number, timeZone?: string): string {
  const { isoDate, minute } = wallClock(now, timeZone);
  return minute < dayStartMinute ? addDays(isoDate, -1) : isoDate;
}

/** ISO weekday of a date: Monday = 1 … Sunday = 7. */
export function isoWeekday(isoDate: string): number {
  const [y, m, d] = parts(isoDate);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return weekday === 0 ? 7 : weekday;
}

/** The Monday of the week of a day (the week starts on Monday in every locale, spec 010). */
export function weekStartOf(isoDate: string): string {
  return addDays(isoDate, 1 - isoWeekday(isoDate));
}

/** The seven dates of the week that starts on `weekStart`, Monday to Sunday. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** The time of `date` in the device's time zone, as `HH:mm` (spec 008: the state of the day). */
export function toLocalTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * The client sends its local date; accept it only within ±1 day of the server's UTC date, which covers
 * every time zone.
 */
export function isPlausibleClientDate(clientDate: string, nowIso: string): boolean {
  return Math.abs(daysBetween(nowIso.slice(0, 10), clientDate)) <= 1;
}
