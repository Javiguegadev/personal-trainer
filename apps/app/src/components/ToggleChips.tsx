import { tokens } from '@pt/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import type { Choice } from './ChoiceGroup';

interface ToggleChipsProps<T extends string> {
  label: string;
  /** Hidden when the chips sit under a heading that already names them. */
  showLabel?: boolean;
  options: readonly Choice<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  error?: string | null;
  testID?: string;
  /** The prefix of each chip's test id (`<prefix>-<value>`); `testID` when omitted. */
  chipTestID?: string;
}

/**
 * Several choices (checkbox chips) that wrap in rows, as `ChoiceGroup` looks: a selected chip has a
 * thicker border, bold text and a ✓, so colour is never the only signal.
 */
export function ToggleChips<T extends string>({
  label,
  showLabel = true,
  options,
  selected,
  onToggle,
  error,
  testID,
  chipTestID = testID,
}: ToggleChipsProps<T>) {
  const { colors } = useTheme();
  return (
    <View style={styles.group} testID={testID}>
      {showLabel ? <AppText variant="label">{label}</AppText> : null}
      <View role="group" aria-label={label} style={styles.chips}>
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <Pressable
              key={option.value}
              role="checkbox"
              aria-checked={on}
              accessibilityLabel={option.label}
              onPress={() => onToggle(option.value)}
              testID={chipTestID ? `${chipTestID}-${option.value}` : undefined}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: on ? colors.surfaceMuted : colors.surface,
                  borderColor: on ? colors.primary : error ? colors.danger : colors.border,
                  borderWidth: on ? 2 : 1,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <AppText weight={on ? 'bold' : 'regular'}>
                {on ? '✓ ' : ''}
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <AppText variant="caption" tone="danger" role="alert">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
  chip: {
    minHeight: tokens.layout.minTouchTarget,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.space.md,
    justifyContent: 'center',
  },
});
