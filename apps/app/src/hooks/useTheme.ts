import { tokens, type ColorScheme, type Palette } from '@pt/ui';
import { useColorScheme } from 'react-native';
import { resolveColorScheme } from '@/lib/colorScheme';
import { useThemePreference } from '@/lib/themePreference';

/** The palette to paint with: the user's choice in Profile, or the device's setting by default. */
export function useTheme(): { scheme: ColorScheme; colors: Palette } {
  const preference = useThemePreference();
  const system = useColorScheme();
  const scheme = resolveColorScheme(preference, system);
  return { scheme, colors: tokens.palette[scheme] };
}
