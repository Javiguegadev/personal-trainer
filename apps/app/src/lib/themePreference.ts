import { useSyncExternalStore } from 'react';
import { parseThemePreference, type ThemePreference } from './colorScheme';
import { applyColorSchemeOverride } from './colorSchemeOverride';
import { storage } from './storage';

/** Per device, not per account: it is a display setting and it must apply before signing in. */
const THEME_PREFERENCE_KEY = 'pt.themePreference.v1';

let current = parseThemePreference(storage.getItem(THEME_PREFERENCE_KEY));
applyColorSchemeOverride(current);

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ThemePreference {
  return current;
}

export function setThemePreference(preference: ThemePreference): void {
  if (preference === current) return;
  current = preference;
  storage.setItem(THEME_PREFERENCE_KEY, preference);
  applyColorSchemeOverride(preference);
  listeners.forEach((listener) => listener());
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
