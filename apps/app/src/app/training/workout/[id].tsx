import { WORKOUT_LIMITS, type Profile, type Workout } from '@pt/contracts';
import { canRewriteWorkout, formatLongDate, lastDays } from '@pt/core';
import { tokens } from '@pt/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { DaySelector } from '@/components/DaySelector';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { SyncBadge } from '@/components/SyncBadge';
import { TextField } from '@/components/TextField';
import { useI18n } from '@/hooks/useI18n';
import { useSetFormat } from '@/hooks/useSetFormat';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useTrainingActions } from '@/hooks/useTraining';
import { useWorkoutText } from '@/hooks/useWorkoutText';
import { useMe, usePendingTrainingIds, useWorkouts } from '@/lib/api';
import { moveToDay } from '@/lib/trainingTime';

const RPE = Array.from({ length: WORKOUT_LIMITS.rpeMax }, (_, i) => String(i + 1));

/**
 * A saved session or activity (spec 009 AC19): change its day, duration, effort or name, edit its
 * exercises and sets on the session screen, or delete it with 5 seconds to undo.
 */
export default function WorkoutRoute() {
  const { t } = useI18n();
  const router = useRouter();
  const me = useMe();
  const today = useToday();
  const log = useWorkouts(today);
  const { id } = useLocalSearchParams<{ id: string }>();
  const found = log.data?.find((w) => w.id === id);
  // A deleted workout leaves the log at once: keep showing it while the sheet closes.
  const [last, setLast] = useState(found);
  if (found && found !== last) setLast(found);
  const workout = found ?? last;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/training'));

  if (!me.data?.profile || log.isPending) return <BlockingState />;
  if (!workout) {
    return (
      <Screen testID="workout-sheet">
        <Notice tone="info" message={t.training.workout.notFound} testID="workout-missing" />
        <Button variant="secondary" label={t.training.workout.close} onPress={close} />
      </Screen>
    );
  }
  return (
    <WorkoutEditor key={workout.id} workout={workout} profile={me.data.profile} close={close} />
  );
}

function WorkoutEditor({
  workout,
  profile,
  close,
}: {
  workout: Workout;
  profile: Profile;
  close: () => void;
}) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const today = useToday();
  const actions = useTrainingActions();
  const pending = usePendingTrainingIds().includes(workout.id);
  const fmt = useSetFormat(profile.units);
  const text = useWorkoutText();
  const [day, setDay] = useState(workout.localDate);
  const [minutesText, setMinutesText] = useState(String(workout.minutes));
  const [rpe, setRpe] = useState<string | null>(
    workout.sessionRpe === null ? null : String(workout.sessionRpe),
  );
  const [name, setName] = useState(workout.name ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const w = t.training.workout;
  const gym = workout.kind === 'gym';
  // An exercise that no longer exists cannot be sent again: editing would erase its sets.
  const editable = canRewriteWorkout(workout);
  const remove = () => {
    actions.remove(workout);
    close();
  };

  // Today and the 6 days before; an older workout keeps its own day as a choice.
  const recentDays = lastDays(today, WORKOUT_LIMITS.pastDaysUi);
  const days = recentDays.includes(workout.localDate)
    ? recentDays
    : [...recentDays, workout.localDate];
  const minutes = Number(minutesText);
  const minMinutes = gym ? WORKOUT_LIMITS.minutesMin : WORKOUT_LIMITS.activityMinutesMin;
  const minutesValid =
    Number.isInteger(minutes) && minutes >= minMinutes && minutes <= WORKOUT_LIMITS.minutesMax;

  const save = () => {
    if (!minutesValid) {
      setShowErrors(true);
      return;
    }
    actions.update(workout, {
      localDate: day,
      startedAt: day === workout.localDate ? workout.startedAt : moveToDay(workout.startedAt, day),
      minutes,
      sessionRpe: rpe === null ? null : Number(rpe),
      name: name.trim() || (gym ? null : workout.name),
    });
    close();
  };

  return (
    <Screen
      testID="workout-sheet"
      footer={
        <>
          {editable ? <Button label={w.save} onPress={save} testID="workout-save" /> : null}
          <Button variant="ghost" label={w.close} onPress={close} />
        </>
      }
    >
      <View>
        <AppText variant="title">{text.label(workout)}</AppText>
        <AppText tone="muted">{formatLongDate(workout.localDate, locale)}</AppText>
      </View>
      {pending ? <SyncBadge /> : null}
      {editable ? null : <Notice tone="info" message={w.locked} testID="workout-locked" />}
      {gym ? (
        <View style={styles.gap} testID="workout-exercises">
          {workout.exercises.map((exercise, index) => (
            <View
              key={`${exercise.exerciseId ?? exercise.label}-${index}`}
              style={[styles.exercise, { borderColor: colors.border }]}
            >
              <AppText weight="bold">{exercise.label}</AppText>
              <AppText tone="muted">{fmt.sets(exercise.sets, exercise.tracking)}</AppText>
            </View>
          ))}
          {editable ? (
            <Button
              variant="secondary"
              label={w.editSets}
              onPress={() => {
                actions.edit(workout);
                router.push({ pathname: '/training/session', params: { slot: 'draft' } });
              }}
              testID="workout-edit-sets"
            />
          ) : null}
        </View>
      ) : null}
      {editable ? (
        <>
          <DaySelector
            label={w.day}
            days={days}
            today={today}
            value={day}
            onChange={setDay}
            layout="scroll"
            testID="workout-day"
          />
          <TextField
            label={w.duration}
            value={minutesText}
            onChangeText={setMinutesText}
            keyboardType="number-pad"
            error={
              showErrors && !minutesValid
                ? gym
                  ? t.training.finish.durationError
                  : t.training.activity.minutesError
                : null
            }
            testID="workout-minutes"
          />
          <ChoiceGroup
            label={t.training.finish.rpe}
            hint={t.training.finish.rpeHint}
            options={RPE.map((value) => ({ value, label: value }))}
            value={rpe}
            onChange={(value) => setRpe(value === rpe ? null : value)}
            testID="workout-rpe"
          />
          <TextField
            label={w.name}
            value={name}
            onChangeText={setName}
            maxLength={WORKOUT_LIMITS.nameMax}
            testID="workout-name"
          />
        </>
      ) : null}
      {editable ? (
        // Deleted at once: the Training tab offers 5 seconds to undo (AC19).
        <Button variant="danger" label={w.delete} onPress={remove} testID="workout-delete" />
      ) : confirmDelete ? (
        <Notice tone="warning" message={w.deleteConfirm} testID="workout-delete-confirm">
          <Button variant="danger" label={w.delete} onPress={remove} testID="workout-delete-yes" />
          <Button
            variant="secondary"
            label={t.training.session.cancel}
            onPress={() => setConfirmDelete(false)}
          />
        </Notice>
      ) : (
        <Button
          variant="danger"
          label={w.delete}
          onPress={() => setConfirmDelete(true)}
          testID="workout-delete"
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: tokens.space.sm },
  exercise: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: tokens.space.xs },
});
