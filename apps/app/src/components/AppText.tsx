import { tokens, type Palette } from '@pt/ui';
import { StyleSheet, Text, type TextProps } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

type Variant = keyof typeof tokens.fontSize;
type Tone = 'default' | 'muted' | 'primary' | 'danger' | 'warning' | 'info' | 'success';

const TONE: Record<Tone, keyof Palette> = {
  default: 'text',
  muted: 'textMuted',
  primary: 'primary',
  danger: 'danger',
  warning: 'warning',
  info: 'info',
  success: 'success',
};

export interface AppTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  weight?: 'regular' | 'semibold' | 'bold';
}

/** Text with the design-system sizes and theme colors. Titles are exposed as headers. */
export function AppText({
  variant = 'body',
  tone = 'default',
  weight,
  style,
  ...rest
}: AppTextProps) {
  const { colors } = useTheme();
  const isHeading = variant === 'title' || variant === 'display';
  const fontWeight =
    weight === 'bold' || (weight === undefined && isHeading)
      ? '800'
      : weight === 'semibold' || (weight === undefined && variant === 'label')
        ? '600'
        : '400';
  return (
    <Text
      accessibilityRole={isHeading ? 'header' : undefined}
      style={[
        styles.base,
        {
          color: colors[TONE[tone]],
          fontSize: tokens.fontSize[variant],
          lineHeight: Math.round(tokens.fontSize[variant] * (isHeading ? 1.2 : 1.45)),
          fontWeight,
        },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: { letterSpacing: 0 },
});
