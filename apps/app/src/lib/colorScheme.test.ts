import { describe, expect, it } from 'vitest';
import { parseThemePreference, resolveColorScheme } from './colorScheme';

describe('parseThemePreference', () => {
  it('keeps a known value', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
  });

  it('falls back to system when nothing or something unknown is stored', () => {
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('sepia')).toBe('system');
  });
});

describe('resolveColorScheme', () => {
  it('follows the device when the preference is system', () => {
    expect(resolveColorScheme('system', 'dark')).toBe('dark');
    expect(resolveColorScheme('system', 'light')).toBe('light');
    expect(resolveColorScheme('system', null)).toBe('light');
  });

  it('ignores the device when the user picked a scheme', () => {
    expect(resolveColorScheme('light', 'dark')).toBe('light');
    expect(resolveColorScheme('dark', 'light')).toBe('dark');
  });
});
