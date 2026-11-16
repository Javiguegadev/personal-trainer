import { tokens } from '@pt/ui';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface ChoiceGroupProps<T extends string> {
  label: string;
  options: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /**
   * `chips` wrap in rows (short labels); `scroll` keeps the chips in one row that scrolls sideways;
   * `list` stacks full-width rows with descriptions.
   */
  layout?: 'chips' | 'scroll' | 'list';
  error?: string | null;
  hint?: string;
  testID?: string;
}

/** Single choice (radio group). Selection is shown by fill, border and a ✓, not by color alone. */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  layout = 'chips',
  error,
  hint,
  testID,
}: ChoiceGroupProps<T>) {
  const { colors } = useTheme();
  const group = (
    <View
      role="radiogroup"
      aria-label={label}
      style={layout === 'chips' ? styles.chips : layout === 'scroll' ? styles.scroll : styles.list}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            role="radio"
            aria-checked={selected}
            accessibilityLabel={
              option.description ? `${option.label}. ${option.description}` : option.label
            }
            onPress={() => onChange(option.value)}
            testID={testID ? `${testID}-${option.value}` : undefined}
            style={({ pressed }) => [
              layout === 'list' ? styles.row : styles.chip,
              {
                backgroundColor: selected ? colors.surfaceMuted : colors.surface,
                borderColor: selected ? colors.primary : error ? colors.danger : colors.border,
                borderWidth: selected ? 2 : 1,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <AppText weight={selected ? 'bold' : 'regular'}>
              {selected ? '✓ ' : ''}
              {option.label}
            </AppText>
            {option.description ? (
              <AppText variant="caption" tone="muted">
                {option.description}
              </AppText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <View style={styles.group} testID={testID}>
      <AppText variant="label">{label}</AppText>
      {layout === 'scroll' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {group}
        </ScrollView>
      ) : (
        group
      )}
      {error ? (
        <AppText variant="caption" tone="danger" role="alert">
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
  group: { gap: tokens.space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
  scroll: { flexDirection: 'row', gap: tokens.space.sm },
  list: { gap: tokens.space.sm },
  chip: {
    minHeight: tokens.layout.minTouchTarget,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.space.md,
    justifyContent: 'center',
  },
  row: {
    minHeight: tokens.layout.minTouchTarget,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    justifyContent: 'center',
    gap: 2,
  },
});
