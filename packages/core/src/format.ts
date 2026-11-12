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
