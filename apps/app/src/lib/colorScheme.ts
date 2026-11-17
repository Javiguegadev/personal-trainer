import type { ColorScheme } from '@pt/ui';

/** The appearance the user picked in Profile. `system` follows the device setting. */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** Reads a stored value; anything unknown (or nothing stored) falls back to `system`. */
export function parseThemePreference(value: string | null): ThemePreference {
  return THEME_PREFERENCES.find((preference) => preference === value) ?? 'system';
}

/** The scheme to paint with: the user's choice, or the device's when they follow the system. */
export function resolveColorScheme(
  preference: ThemePreference,
  system: string | null | undefined,
): ColorScheme {
  if (preference !== 'system') return preference;
  return system === 'dark' ? 'dark' : 'light';
}
