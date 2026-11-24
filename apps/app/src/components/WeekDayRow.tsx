import type { Workout } from '@pt/contracts';
import { formatNumber, formatWeekdayDay, type WeekDayRow as Row } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useWeekText } from '@/hooks/useWeekText';
import { useWorkoutText } from '@/hooks/useWorkoutText';
import { AppText } from './AppText';

/**
 * One day of the week view (spec 010 AC8, AC9): date, work hours, planned training, workouts logged,
 * one dot per meal with items and the kcal as plain text. Nothing judges the day: no colour, icon or
 * word says it went well or badly. Opens the day screen (AC11).
 */
export function WeekDayRow({ row, targetKcal }: { row: Row<Workout>; targetKcal: number | null }) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const text = useWeekText();
  const workoutText = useWorkoutText();
  const v = t.week.view;

  const date = formatWeekdayDay(row.date, locale);
  const planned = row.planned.map(text.slot).join(' · ');
  const done = row.workouts
    .map((w) => `${workoutText.label(w)} ${workoutText.minutes(w.minutes)}`)
    .join(' · ');
  const kcal =
    row.kcal === null
      ? null
      : targetKcal === null
        ? format(v.kcalOnly, { kcal: formatNumber(row.kcal, locale) })
        : format(v.kcal, {
            kcal: formatNumber(row.kcal, locale),
            target: formatNumber(targetKcal, locale),
          });
  const meals = row.meals.map((meal) => t.food.meals[meal]).join(', ');
  const summary = [
    row.isToday ? `${date}, ${v.today}` : date,
    row.work ? `${t.week.day.work} ${text.work(row.work)}` : null,
    planned || null,
    done || null,
    meals ? format(v.meals, { meals }) : null,
    kcal,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      role="button"
      accessibilityLabel={summary}
      accessibilityHint={format(v.openDay, { day: date })}
      onPress={() => router.push({ pathname: '/day/[date]', params: { date: row.date } })}
      testID={`week-day-${row.date}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: row.isToday ? colors.primary : colors.border,
          borderWidth: row.isToday ? 2 : 1,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.line}>
        <AppText weight="bold" style={styles.date}>
          {date}
          {row.isToday ? ` · ${v.today}` : ''}
        </AppText>
        {row.work ? (
          <AppText variant="caption" tone="muted" testID={`week-day-${row.date}-work`}>
            {text.work(row.work)}
          </AppText>
        ) : null}
        {planned ? (
          <AppText variant="caption" tone="muted" testID={`week-day-${row.date}-planned`}>
            {planned}
          </AppText>
        ) : null}
      </View>
      {done || row.meals.length > 0 ? (
        <View style={styles.line}>
          {done ? (
            <AppText variant="caption" testID={`week-day-${row.date}-workouts`}>
              {done}
            </AppText>
          ) : null}
          {row.meals.length > 0 ? (
            <View style={styles.dots} testID={`week-day-${row.date}-meals`}>
              {row.meals.map((meal) => (
                <View key={meal} style={[styles.dot, { backgroundColor: colors.textMuted }]} />
              ))}
            </View>
          ) : null}
          {kcal ? (
            <AppText variant="caption" testID={`week-day-${row.date}-kcal`}>
              {kcal}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: tokens.layout.minTouchTarget,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    gap: 2,
    justifyContent: 'center',
  },
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: tokens.space.sm,
  },
  date: { minWidth: 56 },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
