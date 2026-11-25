import { formatShortDate, formatWeekdayDay, planTargetWeeks, weekStartOf } from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { ToggleChips } from './ToggleChips';

/**
 * The days a copy can go to (spec 013 AC19): today to the end of the horizon, a row of chips per week
 * ("Esta semana", "Semana del 7 dic"). `exclude` is the day being copied.
 */
export function TargetDayChips({
  today,
  exclude,
  selected,
  onToggle,
  error,
  testID,
}: {
  today: string;
  exclude?: string;
  selected: readonly string[];
  onToggle: (day: string) => void;
  error?: string | null;
  testID?: string;
}) {
  const { t, format, locale } = useI18n();
  const c = t.plan.copy;
  const weeks = planTargetWeeks(today)
    .map((week) => ({ ...week, days: week.days.filter((day) => day !== exclude) }))
    .filter((week) => week.days.length > 0);
  return (
    <View style={styles.group} testID={testID}>
      <AppText variant="label">{c.targets}</AppText>
      {weeks.map((week) => {
        const heading =
          week.weekStart === weekStartOf(today)
            ? c.thisWeek
            : format(c.weekOf, { date: formatShortDate(week.weekStart, locale) });
        return (
          <View key={week.weekStart} style={styles.week}>
            <AppText variant="caption" tone="muted" accessibilityRole="header">
              {heading}
            </AppText>
            <ToggleChips
              label={`${c.targets} ${heading}`}
              showLabel={false}
              options={week.days.map((day) => ({
                value: day,
                label: day === today ? t.weight.sheet.today : formatWeekdayDay(day, locale),
              }))}
              selected={selected}
              onToggle={onToggle}
              chipTestID={testID}
            />
          </View>
        );
      })}
      {error ? (
        <AppText variant="caption" tone="danger" role="alert">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.sm },
  week: { gap: tokens.space.xs },
});
