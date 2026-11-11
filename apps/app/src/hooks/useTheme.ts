import { tokens, type ColorScheme, type Palette } from '@pt/ui';
import { useColorScheme } from 'react-native';

export function useTheme(): { scheme: ColorScheme; colors: Palette } {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: tokens.palette[scheme] };
}
