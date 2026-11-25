import type { PlannedWorkout, Workout } from '@pt/contracts';
import { formatNumber, formatWeekdayDay, type WeekDayRow as Row } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { usePlanText } from '@/hooks/usePlanText';
import { useTheme } from '@/hooks/useTheme';
import { useWeekText } from '@/hooks/useWeekText';
import { useWorkoutText } from '@/hooks/useWorkoutText';
import { AppText } from './AppText';
import { PlanDot } from './PlanDot';

/**
 * One day of the week view (spec 010 AC8, AC9): date, work hours, planned training, workouts logged,
 * one dot per meal with items and the kcal as plain text. A shift told in the check-in shows in the
 * work slot (spec 011 AC11). With the weekly planner (spec 013 AC2): outlined dots for the planned
 * meals, "Plan: …" for the planned energy, and the pending planned sessions instead of the typical ones.
 * Nothing judges the day: no colour, icon or word says it went well or badly, or that a plan was missed.
 * Opens the day screen (AC11).
 */
export function WeekDayRow({
  row,
  targetKcal,
}: {
  row: Row<Workout, PlannedWorkout>;
  targetKcal: number | null;
}) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const text = useWeekText();
  const workoutText = useWorkoutText();
  const planText = usePlanText();
  const v = t.week.view;

  const date = formatWeekdayDay(row.date, locale);
  // Planned sessions replace the typical ones; each is "Rutina B · 18:30", so they are listed with commas.
  const planned =
    row.plannedSessions.length > 0
      ? row.plannedSessions.map(planText.line).join(', ')
      : row.planned.map(text.slot).join(' · ');
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
  const plannedMeals = row.plannedMeals.map((meal) => t.food.meals[meal]).join(', ');
  const planKcal =
    row.planKcal === null
      ? null
      : row.planKcal.targetKcal === null
        ? format(t.plan.energyOnly, { kcal: formatNumber(row.planKcal.kcal, locale) })
        : format(t.plan.energy, {
            kcal: formatNumber(row.planKcal.kcal, locale),
            target: formatNumber(row.planKcal.targetKcal, locale),
          });
  // A shift told in the check-in names itself (spec 011 AC11); a typical work block shows its hours.
  const work = row.work
    ? row.shift
      ? text.shift(row.shift, row.work)
      : text.work(row.work)
    : null;
  const summary = [
    row.isToday ? `${date}, ${v.today}` : date,
    row.work && !row.shift ? `${t.week.day.work} ${work}` : work,
    planned || null,
    done || null,
    meals ? format(v.meals, { meals }) : null,
    plannedMeals ? format(t.plan.plannedMeals, { meals: plannedMeals }) : null,
    kcal,
    planKcal,
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
        {work ? (
          <AppText variant="caption" tone="muted" testID={`week-day-${row.date}-work`}>
            {work}
          </AppText>
        ) : null}
        {planned ? (
          <AppText variant="caption" tone="muted" testID={`week-day-${row.date}-planned`}>
            {planned}
          </AppText>
        ) : null}
      </View>
      {done || row.meals.length > 0 || row.plannedMeals.length > 0 || planKcal ? (
        <View style={styles.line}>
          {done ? (
            <AppText variant="caption" testID={`week-day-${row.date}-workouts`}>
              {done}
            </AppText>
          ) : null}
          {row.meals.length > 0 || row.plannedMeals.length > 0 ? (
            <View style={styles.dots} testID={`week-day-${row.date}-meals`}>
              {row.meals.map((meal) => (
                <PlanDot key={meal} planned={false} />
              ))}
              {row.plannedMeals.map((meal) => (
                <View key={`plan-${meal}`} testID={`week-day-${row.date}-planned-${meal}`}>
                  <PlanDot planned />
                </View>
              ))}
            </View>
          ) : null}
          {kcal ? (
            <AppText variant="caption" testID={`week-day-${row.date}-kcal`}>
              {kcal}
            </AppText>
          ) : null}
          {planKcal ? (
            <AppText variant="caption" tone="muted" testID={`week-day-${row.date}-plan-kcal`}>
              {planKcal}
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
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
