import type { ThemePreference } from './colorScheme';

/** Web: no native override; `useTheme` applies the preference to every screen on its own. */
export function applyColorSchemeOverride(_preference: ThemePreference): void {}
