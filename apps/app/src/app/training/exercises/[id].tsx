import { WORKOUT_LIMITS, type ExerciseTracking, type Profile } from '@pt/contracts';
import {
  exerciseName,
  formatShortDate,
  oneRepMaxSeries,
  showsRecordsFor,
  type BestKind,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ExerciseProgressChart } from '@/components/ExerciseProgressChart';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/hooks/useI18n';
import { useSetFormat } from '@/hooks/useSetFormat';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useExerciseLookups } from '@/hooks/useTraining';
import { useDeleteCustomExercise, useExerciseHistory, useMe } from '@/lib/api';

/** The bests each way of tracking has (AC14). */
const BESTS: Record<ExerciseTracking, BestKind[]> = {
  weight_reps: ['heaviestKg', 'oneRepMaxKg'],
  reps: ['mostReps'],
  duration: ['longestS'],
  distance_duration: ['longestM'],
};

/**
 * An exercise (spec 009 AC15): its bests with their dates, the last 10 sessions with it and, for weight
 * exercises done in at least 3 sessions, the chart of the best estimated 1RM per session.
 */
export default function ExerciseRoute() {
  const me = useMe();
  if (!me.data?.profile) return <BlockingState />;
  return <ExercisePage profile={me.data.profile} />;
}

function ExercisePage({ profile }: { profile: Profile }) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const today = useToday();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { exerciseById, catalog } = useExerciseLookups();
  const history = useExerciseHistory(id ?? null);
  const remove = useDeleteCustomExercise();
  const fmt = useSetFormat(profile.units);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const e = t.training.exercise;
  const exercise = id ? exerciseById.get(id) : undefined;
  const sessions = history.data?.sessions ?? [];
  // A deleted custom exercise is no longer in the catalog: its sessions keep the name and the tracking.
  const tracking = exercise?.tracking ?? null;
  const name = exercise ? exerciseName(exercise, locale) : null;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/training/exercises'));

  if (!exercise && catalog.isPending) return <BlockingState />;
  if (!exercise) {
    return (
      <Screen testID="exercise-screen">
        <BackLink fallback="/training/exercises" />
        <Notice tone="info" message={e.notFound} testID="exercise-missing" />
      </Screen>
    );
  }

  const showBests = tracking !== null && showsRecordsFor(tracking, profile.safetyFlags);
  const bests = history.data?.bests;
  const kinds = tracking ? BESTS[tracking] : [];
  const bestRows = bests ? kinds.filter((kind) => bests[kind] !== null) : [];
  const series = tracking === 'weight_reps' ? oneRepMaxSeries(sessions) : [];
  const withYear = (date: string) => date.slice(0, 4) !== today.slice(0, 4);

  let body;
  if (history.isPending) {
    body = <ActivityIndicator color={colors.primary} accessibilityLabel={t.common.loading} />;
  } else if (history.isError && !history.data) {
    body = (
      <View style={styles.gap}>
        <Notice tone="danger" message={e.loadError} />
        <Button variant="secondary" label={t.common.retry} onPress={() => void history.refetch()} />
      </View>
    );
  } else {
    body = (
      <>
        {showBests ? (
          <Card title={e.bests} testID="exercise-bests">
            {bestRows.length === 0 ? (
              <AppText tone="muted">{e.bestsNone}</AppText>
            ) : (
              bestRows.map((kind) => {
                const best = bests![kind]!;
                return (
                  <View key={kind} style={[styles.row, { borderColor: colors.border }]}>
                    <AppText tone="muted">{e[kind]}</AppText>
                    <AppText weight="bold" testID={`best-${kind}`}>
                      {format(e.bestValue, {
                        value: fmt.best(kind, best.value),
                        date: formatShortDate(best.localDate, locale, withYear(best.localDate)),
                      })}
                    </AppText>
                  </View>
                );
              })
            )}
            {tracking === 'weight_reps' ? (
              <AppText variant="caption" tone="muted">
                {e.estimateNote}
              </AppText>
            ) : null}
          </Card>
        ) : null}
        {showBests && series.length >= WORKOUT_LIMITS.chartSessionsMin ? (
          <ExerciseProgressChart points={series} fmt={fmt} />
        ) : null}
        <View style={styles.gap} testID="exercise-history">
          <AppText variant="subtitle" weight="bold" accessibilityRole="header">
            {e.history}
          </AppText>
          {sessions.length === 0 ? (
            <AppText tone="muted">{e.historyEmpty}</AppText>
          ) : (
            sessions.map((session) => (
              <View key={session.workoutId} style={[styles.row, { borderColor: colors.border }]}>
                <AppText tone="muted">
                  {formatShortDate(session.localDate, locale, withYear(session.localDate))}
                </AppText>
                <AppText weight="semibold" style={styles.sets}>
                  {tracking ? fmt.sets(session.sets, tracking) : ''}
                </AppText>
              </View>
            ))
          )}
        </View>
      </>
    );
  }

  return (
    <Screen testID="exercise-screen">
      <BackLink fallback="/training/exercises" />
      <View>
        <AppText variant="title">{name}</AppText>
        {exercise.primaryMuscles.length ? (
          <AppText tone="muted">
            {format(e.primary, {
              muscles: exercise.primaryMuscles.map((m) => t.training.muscles[m]).join(', '),
            })}
          </AppText>
        ) : null}
        {exercise.origin === 'user' ? <AppText tone="muted">{e.custom}</AppText> : null}
      </View>
      {body}
      {exercise.origin === 'user' ? (
        confirmDelete ? (
          <Notice tone="warning" message={e.deleteConfirm} testID="exercise-delete-confirm">
            <View style={styles.actions}>
              <Button
                variant="danger"
                label={e.delete}
                onPress={() => {
                  remove.mutate({ id: exercise.id, recordedAt: new Date().toISOString() });
                  back();
                }}
                testID="exercise-delete-yes"
              />
              <Button
                variant="secondary"
                label={t.training.session.cancel}
                onPress={() => setConfirmDelete(false)}
              />
            </View>
          </Notice>
        ) : (
          <Button
            variant="ghost"
            label={e.delete}
            onPress={() => setConfirmDelete(true)}
            testID="exercise-delete"
          />
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: tokens.space.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sets: { flex: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
