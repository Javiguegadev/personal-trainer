import { Appearance } from 'react-native';
import type { ThemePreference } from './colorScheme';

/**
 * Native: overrides the app's interface style, so native pieces (alerts, keyboard, date pickers, the
 * status bar on `auto`) follow the user's choice too. `auto` removes the override.
 */
export function applyColorSchemeOverride(preference: ThemePreference): void {
  Appearance.setColorScheme(preference === 'system' ? 'auto' : preference);
}
