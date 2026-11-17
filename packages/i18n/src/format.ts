import type { Locale } from './index';

/**
 * Replaces `{name}` placeholders with values. Unknown placeholders are left as they are, so a missing
 * value is visible in the UI instead of silently disappearing.
 */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * Picks the first supported language from the device's preferred languages (e.g. `['ca', 'es']` → es).
 * Falls back to Spanish, the reference locale.
 */
export function resolveLocale(
  languageCodes: readonly (string | null | undefined)[],
  supported: readonly Locale[] = ['es', 'en'],
  fallback: Locale = 'es',
): Locale {
  for (const code of languageCodes) {
    const base = code?.toLowerCase().split(/[-_]/)[0];
    const match = supported.find((locale) => locale === base);
    if (match) return match;
  }
  return fallback;
}
