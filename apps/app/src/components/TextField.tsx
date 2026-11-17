import { tokens } from '@pt/ui';
import { useId } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Shown under the field and announced; the border also changes, so color is not the only signal. */
  error?: string | null;
  hint?: string;
  inputStyle?: StyleProp<TextStyle>;
}

export function TextField({ label, error, hint, inputStyle, ...input }: TextFieldProps) {
  const { colors } = useTheme();
  const id = useId();
  return (
    <View style={styles.field}>
      <AppText variant="label" nativeID={`${id}-label`}>
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        aria-labelledby={`${id}-label`}
        aria-invalid={error ? true : undefined}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.border,
            borderWidth: error ? 2 : 1,
          },
          inputStyle,
        ]}
        {...input}
      />
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite" role="alert">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" tone="muted">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: tokens.space.xs },
  input: {
    minHeight: tokens.layout.minTouchTarget,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    // 16 px or more: iOS Safari does not zoom into the field on focus.
    fontSize: tokens.fontSize.body,
  },
});
