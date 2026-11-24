import { WORKOUT_LIMITS, type Profile } from '@pt/contracts';
import {
  formatShortDate,
  localToday,
  repeatShortcuts,
  weekStartOf,
  workoutHistoryWeeks,
  workoutRecordCount,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DescribeWorkoutButton } from '@/components/DescribeWorkoutButton';
import { Notice } from '@/components/Notice';
import { OfflineBanner } from '@/components/OfflineBanner';
import { RoutineCard } from '@/components/RoutineCard';
import { Screen } from '@/components/Screen';
import { SessionInProgress } from '@/components/SessionInProgress';
import { TrainingNotes } from '@/components/TrainingNotes';
import { TrainingRejectedNotice } from '@/components/TrainingRejectedNotice';
import { UndoToast } from '@/components/UndoToast';
import { WorkoutRow } from '@/components/WorkoutRow';
import { useDraftGuard } from '@/hooks/useDraftGuard';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useExerciseLookups, useTrainingActions } from '@/hooks/useTraining';
import { useWorkoutText } from '@/hooks/useWorkoutText';
import { useMe, usePendingTrainingIds, useProgram, useWorkouts } from '@/lib/api';
import { useSession } from '@/lib/liveSession';
import { profileWeek } from '@/lib/week';
import { clearWorkoutUndo, useWorkoutUndo } from '@/lib/workoutUndo';

/** Days of history shown before "Ver más" (AC20); the cache holds `WORKOUT_LIMITS.cacheDays`. */
const HISTORY_DAYS = 30;

/** The Training tab (spec 009 AC6, AC16–AC20). */
export default function TrainingScreen() {
  const me = useMe();
  if (!me.data?.profile) return <BlockingState />;
  return <TrainingTab profile={me.data.profile} />;
}

function TrainingTab({ profile }: { profile: Profile }) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const today = useToday();
  const log = useWorkouts(today);
  const program = useProgram();
  const live = useSession('live');
  const { statsList } = useExerciseLookups();
  const pendingIds = usePendingTrainingIds();
  const actions = useTrainingActions();
  const undo = useWorkoutUndo();
  const text = useWorkoutText();
  const draftGuard = useDraftGuard();
  const [days, setDays] = useState(HISTORY_DAYS);
  const tr = t.training;
  const flags = profile.safetyFlags;

  const start = () => {
    actions.startLive();
    router.push({ pathname: '/training/session', params: { slot: 'live' } });
  };
  const startPast = () => {
    // An hour ago by default; the day and the time are the first fields of the screen (AC17).
    const startedAt = new Date(Date.now() - 60 * 60 * 1000);
    actions.startManual(
      localToday(startedAt, profileWeek(profile).dayStartMinute),
      startedAt.toISOString(),
    );
    router.push({ pathname: '/training/session', params: { slot: 'draft' } });
  };

  const workouts = log.data ?? [];
  const { weeks, hasOlder } = workoutHistoryWeeks(workouts, today, days);
  const shortcuts = live ? [] : repeatShortcuts(workouts);

  let history;
  if (log.isPending) {
    history = (
      <ActivityIndicator
        color={colors.primary}
        accessibilityLabel={t.common.loading}
        style={styles.loading}
      />
    );
  } else if (log.isError && !log.data) {
    history = (
      <View style={styles.gap}>
        <Notice tone="danger" message={tr.loadError} />
        <Button variant="secondary" label={t.common.retry} onPress={() => void log.refetch()} />
      </View>
    );
  } else if (workouts.length === 0) {
    history = (
      <AppText tone="muted" testID="training-first-hint">
        {tr.firstHint}
      </AppText>
    );
  } else {
    history = (
      <View style={styles.gap} testID="training-history">
        <AppText variant="subtitle" weight="bold" accessibilityRole="header">
          {tr.history}
        </AppText>
        {weeks.map((week) => (
          <View key={week.weekStart} style={styles.gap}>
            <AppText variant="label" tone="muted" accessibilityRole="header">
              {week.weekStart === weekStartOf(today)
                ? tr.thisWeek
                : format(tr.weekOf, { date: formatShortDate(week.weekStart, locale) })}
            </AppText>
            {week.workouts.map((workout) => (
              <WorkoutRow
                key={workout.id}
                workout={workout}
                today={today}
                records={workoutRecordCount(workout, workouts, statsList, flags)}
                pending={pendingIds.includes(workout.id)}
              />
            ))}
          </View>
        ))}
        {hasOlder && days < WORKOUT_LIMITS.cacheDays ? (
          <Button
            variant="ghost"
            label={tr.seeMore}
            onPress={() => setDays(WORKOUT_LIMITS.cacheDays)}
            testID="training-see-more"
          />
        ) : null}
      </View>
    );
  }

  return (
    <Screen
      testID="training-screen"
      footer={
        undo ? (
          <UndoToast
            message={tr.deleted}
            onUndo={() => {
              actions.restore(undo);
              clearWorkoutUndo();
            }}
          />
        ) : undefined
      }
    >
      <AppText variant="title">{tr.title}</AppText>
      <OfflineBanner />
      <TrainingRejectedNotice />
      <TrainingNotes flags={flags} />
      <RoutineCard profile={profile} />
      {live ? (
        <SessionInProgress session={live} label={tr.inProgress} />
      ) : (
        <Button
          // With a routine, its "Empezar" is the main action (spec 010 AC17).
          variant={program.data ? 'secondary' : 'primary'}
          label={tr.start}
          onPress={start}
          testID="training-start"
        />
      )}
      <View style={styles.pair}>
        <View style={styles.pairItem}>
          <Button
            variant="secondary"
            label={tr.logActivity}
            onPress={() => router.push('/training/activity')}
            testID="training-log-activity"
          />
        </View>
        <DescribeWorkoutButton
          label={tr.describe.button}
          accessibilityLabel={tr.describe.a11y}
          testID="training-describe"
        />
      </View>
      {draftGuard.notice}
      <Button
        variant="ghost"
        label={tr.logPast}
        onPress={() => draftGuard.guard(startPast)}
        testID="training-log-past"
      />
      {shortcuts.length ? (
        <Card title={tr.repeatTitle} testID="training-repeat">
          {shortcuts.map((workout, index) => (
            <View key={workout.id} style={styles.repeat}>
              <View style={styles.repeatText}>
                <AppText weight="bold">{text.label(workout)}</AppText>
                <AppText variant="caption" tone="muted">
                  {[formatShortDate(workout.localDate, locale), text.detail(workout)]
                    .filter(Boolean)
                    .join(' · ')}
                </AppText>
              </View>
              <Button
                variant="secondary"
                label={tr.repeat}
                accessibilityLabel={format(tr.repeatA11y, { name: text.label(workout) })}
                onPress={() => {
                  actions.repeat(workout);
                  router.push({ pathname: '/training/session', params: { slot: 'live' } });
                }}
                testID={`training-repeat-${index}`}
              />
            </View>
          ))}
        </Card>
      ) : null}
      {history}
      <Button
        variant="ghost"
        label={`${t.week.link} ›`}
        onPress={() => router.push('/settings/week')}
        testID="training-week"
      />
      <Button
        variant="ghost"
        label={`${tr.libraryLink} ›`}
        onPress={() => router.push('/training/exercises')}
        testID="training-library"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: tokens.space.xl },
  gap: { gap: tokens.space.sm },
  repeat: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
  pairItem: { flexGrow: 1 },
  repeatText: { flex: 1, gap: 2 },
});
