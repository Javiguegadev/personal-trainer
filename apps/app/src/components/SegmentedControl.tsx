import { tokens } from '@pt/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import type { Choice } from './ChoiceGroup';

interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
}

/** Two or three views of one screen side by side (Today: Día / Semana, spec 010 AC7). */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  testID,
}: SegmentedControlProps<T>) {
  const { colors } = useTheme();
  return (
    <View
      role="radiogroup"
      aria-label={label}
      style={[styles.row, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}
      testID={testID}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            role="radio"
            aria-checked={selected}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            testID={testID ? `${testID}-${option.value}` : undefined}
            style={({ pressed }) => [
              styles.segment,
              selected && { backgroundColor: colors.surface, borderColor: colors.primary },
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <AppText weight={selected ? 'bold' : 'regular'}>{option.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: tokens.radius.full,
    padding: 2,
    gap: 2,
  },
  segment: {
    flex: 1,
    minHeight: tokens.layout.minTouchTarget - 4,
    borderRadius: tokens.radius.full,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
