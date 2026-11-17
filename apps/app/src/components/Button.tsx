import { tokens, type Palette } from '@pt/ui';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  /** Shown before the label (hidden while loading, where the spinner takes its place). */
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  /** Read instead of the label when the label alone is ambiguous ("Add" → "Add to breakfast"). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

function variantColors(variant: Variant, colors: Palette) {
  switch (variant) {
    case 'primary':
      return { background: colors.primary, text: colors.onPrimary, border: colors.primary };
    case 'danger':
      return { background: colors.danger, text: colors.onPrimary, border: colors.danger };
    case 'secondary':
      return { background: colors.surface, text: colors.text, border: colors.border };
    case 'ghost':
      return { background: 'transparent', text: colors.primary, border: 'transparent' };
  }
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const { colors } = useTheme();
  const palette = variantColors(variant, colors);
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? <ActivityIndicator color={palette.text} /> : icon}
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: tokens.layout.minTouchTarget,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.space.sm,
  },
  label: { fontSize: tokens.fontSize.body, fontWeight: '700', textAlign: 'center' },
});
