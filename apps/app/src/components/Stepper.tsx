import { tokens } from '@pt/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Accessible names of the two buttons, e.g. "One less per week". */
  decreaseLabel: string;
  increaseLabel: string;
  testID?: string;
}

/** A whole number changed with two large buttons: no keyboard needed (touch first, ADR 004). */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  decreaseLabel,
  increaseLabel,
  testID,
}: StepperProps) {
  const { colors } = useTheme();
  const button = (delta: -1 | 1) => {
    const next = value + delta;
    const disabled = next < min || next > max;
    return (
      <Pressable
        role="button"
        accessibilityLabel={delta === -1 ? decreaseLabel : increaseLabel}
        aria-disabled={disabled}
        disabled={disabled}
        onPress={() => onChange(next)}
        testID={testID ? `${testID}-${delta === -1 ? 'decrease' : 'increase'}` : undefined}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <AppText variant="subtitle" weight="bold">
          {delta === -1 ? '−' : '+'}
        </AppText>
      </Pressable>
    );
  };

  return (
    <View style={styles.group} testID={testID}>
      <AppText variant="label">{label}</AppText>
      <View style={styles.row}>
        {button(-1)}
        <View style={styles.value} accessibilityLiveRegion="polite" aria-live="polite">
          <AppText
            variant="subtitle"
            weight="bold"
            accessibilityLabel={`${label}: ${value}`}
            testID={testID ? `${testID}-value` : undefined}
          >
            {value}
          </AppText>
        </View>
        {button(1)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  button: {
    width: tokens.layout.minTouchTarget,
    height: tokens.layout.minTouchTarget,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: { minWidth: 40, alignItems: 'center' },
});
