import type { Weekday } from '@pt/contracts';
import { tokens } from '@pt/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

/** A weekday as the key of the day names in `@pt/i18n`. */
export type WeekdayKey = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: readonly WeekdayKey[] = [1, 2, 3, 4, 5, 6, 7];

interface WeekdayChipsProps {
  /** Read before each day by screen readers ("Gimnasio: lunes"). */
  label: string;
  selected: readonly Weekday[];
  onToggle: (weekday: Weekday) => void;
  testID?: string;
}

/**
 * Seven weekday chips (L M X J V S D) in one row at 360 px (spec 010 AC1–AC3). A selected day is
 * filled, bold and checked for screen readers: colour is never the only signal.
 */
export function WeekdayChips({ label, selected, onToggle, testID }: WeekdayChipsProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View style={styles.row} role="group" aria-label={label} testID={testID}>
      {WEEKDAYS.map((weekday) => {
        const on = selected.includes(weekday);
        return (
          <Pressable
            key={weekday}
            role="checkbox"
            aria-checked={on}
            accessibilityLabel={`${label}: ${t.week.weekdayLong[weekday]}`}
            onPress={() => onToggle(weekday)}
            testID={testID ? `${testID}-${weekday}` : undefined}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: on ? colors.primary : colors.surface,
                borderColor: on ? colors.primary : colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <AppText weight={on ? 'bold' : 'regular'} style={on && { color: colors.onPrimary }}>
              {t.week.weekdayShort[weekday]}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: tokens.space.xs },
  chip: {
    flex: 1,
    maxWidth: tokens.layout.minTouchTarget,
    height: tokens.layout.minTouchTarget,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
