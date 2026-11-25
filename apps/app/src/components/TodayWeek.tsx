import type { Profile, StoredTargets } from '@pt/contracts';
import {
  addDays,
  copyWeekTargets,
  formatShortDate,
  moveWeek,
  weekNavigation,
  weekRows,
  weekStartOf,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useCheckinList } from '@/hooks/useCheckin';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { usePlan, useWeekLog } from '@/lib/api';
import { profileActivities, profileWeek } from '@/lib/week';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { WeekDayRow } from './WeekDayRow';

/**
 * The week view of Today (spec 010 AC8–AC10): Monday to Sunday with the typical week and what was
 * logged; "‹" and "›" move from 12 weeks back to the end of the plan horizon (spec 013 AC1), "Hoy"
 * returns. A week already visited stays on the device; an unvisited one offline shows only its typical
 * week. Today and future rows add the plan, which is cached for the whole horizon (spec 013 AC2, AC22).
 * The current and later weeks offer "Planificar con mi rutina" and "Copiar semana" (AC11, AC21).
 */
export function TodayWeek({
  profile,
  targets,
}: {
  profile: Profile;
  targets: StoredTargets | null;
}) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const today = useToday();
  const current = weekStartOf(today);
  const [weekStart, setWeekStart] = useState(current);
  const nav = weekNavigation(weekStart, today);
  const future = weekStart > current;
  const log = useWeekLog(weekStart, { enabled: !future });
  const plan = usePlan(today);
  const { checkins } = useCheckinList();
  const v = t.week.view;

  const week = {
    workBlocks: profileWeek(profile).workBlocks,
    plannedActivities: profileActivities(profile),
  };
  const rows = weekRows({
    weekStart,
    today,
    week,
    items: log.data?.mealItems ?? [],
    workouts: log.data?.workouts ?? [],
    flags: profile.safetyFlags,
    // The shifts of the check-ins fill the days without a typical work block (spec 011 AC11).
    checkins,
    plan: plan.data,
    // Without numeric targets (pregnancy) the planned energy has no target (spec 013 AC3).
    targetKcal: targets?.kcal ?? null,
  });
  const noTypicalWeek =
    week.workBlocks.length === 0 && week.plannedActivities.every((a) => a.days.length === 0);
  const offline = !future && !log.data && log.fetchStatus === 'paused';
  const loading = !future && !log.data && log.fetchStatus === 'fetching';
  const failed = !future && !log.data && log.isError && !loading;
  const yearOf = (date: string) => date.slice(0, 4) !== today.slice(0, 4);

  return (
    <View style={styles.group} testID="today-week">
      <View style={styles.header}>
        <Button
          variant="secondary"
          label="‹"
          accessibilityLabel={v.previous}
          disabled={!nav.canGoBack}
          onPress={() => setWeekStart(moveWeek(weekStart, -1, today))}
          testID="week-previous"
        />
        <View style={styles.range}>
          <AppText weight="bold" testID="week-range">
            {format(v.range, {
              from: formatShortDate(weekStart, locale),
              to: formatShortDate(addDays(weekStart, 6), locale, yearOf(weekStart)),
            })}
          </AppText>
          {loading ? (
            <ActivityIndicator color={colors.primary} accessibilityLabel={t.common.loading} />
          ) : null}
        </View>
        <Button
          variant="secondary"
          label="›"
          accessibilityLabel={v.next}
          disabled={!nav.canGoForward}
          onPress={() => setWeekStart(moveWeek(weekStart, 1, today))}
          testID="week-next"
        />
      </View>
      {nav.isCurrent ? null : (
        <View style={styles.current}>
          <Button
            variant="ghost"
            label={v.current}
            onPress={() => setWeekStart(current)}
            testID="week-current"
          />
        </View>
      )}
      {/* The current week and later ones can be planned (spec 013 AC11, AC21). */}
      {weekStart >= current ? (
        <View style={styles.planActions}>
          <Button
            variant="secondary"
            label={t.plan.fill.open}
            onPress={() => router.push({ pathname: '/plan/fill', params: { week: weekStart } })}
            testID="week-plan-fill"
          />
          {copyWeekTargets(weekStart, today).length > 0 ? (
            <Button
              variant="secondary"
              label={t.plan.copy.weekOpen}
              onPress={() => router.push({ pathname: '/plan/copy', params: { week: weekStart } })}
              testID="week-plan-copy"
            />
          ) : null}
        </View>
      ) : null}
      {offline ? <Notice tone="info" message={v.offline} testID="week-offline-empty" /> : null}
      {failed ? (
        <Notice tone="danger" message={v.loadError} testID="week-load-error">
          <Button variant="secondary" label={t.common.retry} onPress={() => void log.refetch()} />
        </Notice>
      ) : null}
      {rows.map((row) => (
        <WeekDayRow key={row.date} row={row} targetKcal={targets?.kcal ?? null} />
      ))}
      {noTypicalWeek ? (
        <AppText tone="muted" testID="week-empty-hint">
          {v.emptyHint}
        </AppText>
      ) : null}
      <View style={styles.current}>
        <Button
          variant="ghost"
          label={`${t.week.link} ›`}
          onPress={() => router.push('/settings/week')}
          testID="week-open-settings"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  range: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: tokens.space.sm,
  },
  current: { alignSelf: 'flex-start' },
  planActions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
