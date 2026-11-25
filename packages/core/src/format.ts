import type { Locale } from '@pt/contracts';

/**
 * Parses a number typed by the user: accepts a decimal comma or point ("1,75", "64.5"), surrounding
 * spaces and no thousands separators. Returns null for anything else.
 */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

/** A number for an editable field: at most `decimals` decimals, the locale's decimal separator. */
export function formatDecimal(value: number, locale: Locale, decimals = 1): string {
  const factor = 10 ** decimals;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  const text = String(rounded);
  return locale === 'es' ? text.replace('.', ',') : text;
}

/**
 * A number for display with the locale's conventions: es groups from five digits (1690 · 12.140, as
 * the RAE recommends), en from four (1,690).
 */
export function formatNumber(value: number, locale: Locale, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-GB', {
    maximumFractionDigits,
  }).format(value);
}

const dateLocale = (locale: Locale) => (locale === 'es' ? 'es-ES' : 'en-GB');

/** A day (YYYY-MM-DD) formatted in UTC, so it never moves to the day before or after. */
function formatDay(isoDate: string, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(dateLocale(locale), { ...options, timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

/** "viernes, 13 de noviembre" / "Friday 13 November". */
export function formatLongDate(isoDate: string, locale: Locale): string {
  return formatDay(isoDate, locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "13 nov" / "13 Nov", with the year when asked ("13 nov 2025"). */
export function formatShortDate(isoDate: string, locale: Locale, withYear = false): string {
  return formatDay(isoDate, locale, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** "jueves 27" / "Thursday 27": a day inside the next weeks (spec 013 AC5). */
export function formatWeekdayLongDay(isoDate: string, locale: Locale): string {
  return formatDay(isoDate, locale, { weekday: 'long', day: 'numeric' });
}

/** "vie 13" / "Fri 13": a day chip. */
export function formatWeekdayDay(isoDate: string, locale: Locale): string {
  return formatDay(isoDate, locale, { weekday: 'short', day: 'numeric' });
}

/**
 * "fútbol, pádel y tenis" / "football, padel and tennis". Spanish uses "e" before an /i/ sound
 * ("fútbol e hípica"). Written by hand: Hermes may lack `Intl.ListFormat`.
 */
export function formatList(items: readonly string[], locale: Locale): string {
  if (items.length <= 1) return items[0] ?? '';
  const last = items[items.length - 1] ?? '';
  const conjunction = locale === 'es' ? (/^h?[ií](?![aeoáéó])/i.test(last) ? 'e' : 'y') : 'and';
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${last}`;
}

/**
 * A time of day (minutes after midnight) as the locale writes it (spec 010 Units): 24 h in Spanish
 * ("08:00", "18:30"), 12 h in English ("8:00 AM", "6:30 PM"). Written by hand so Hermes and the
 * browsers agree.
 */
export function formatMinuteOfDay(minute: number, locale: Locale): string {
  const total = ((Math.round(minute) % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const minutes = String(total % 60).padStart(2, '0');
  if (locale === 'es') return `${String(hours).padStart(2, '0')}:${minutes}`;
  const hours12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hours12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}
