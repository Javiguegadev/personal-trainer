import { PROGRAM_LIMITS, type ProgramExercise } from '@pt/contracts';
import { formatDuration, type ProgramTargetPatch } from '@pt/core';
import { tokens } from '@pt/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Stepper } from './Stepper';

const REPS = { min: 1, max: 100 } as const;
const TIME = { min: 15, max: 600, step: 15 } as const;

/**
 * One exercise of a routine session in the editor (spec 010 AC16): "Press de banca · 3 × 8–12" with
 * move, remove and a tap that opens steppers for the sets and the rep range or the time.
 */
export function ProgramExerciseRow({
  exercise,
  index,
  count,
  open,
  onToggle,
  onChange,
  onMove,
  onRemove,
  testID,
}: {
  exercise: ProgramExercise;
  index: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: ProgramTargetPatch) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
  testID: string;
}) {
  const { t, format } = useI18n();
  const { colors } = useTheme();
  const e = t.routine.editor;
  const name = exercise.label;
  const byReps = exercise.repsMin !== null && exercise.repsMax !== null;
  const timed = exercise.tracking === 'duration' && exercise.durationS !== null;

  let target = format(e.targetSets, { sets: exercise.sets });
  if (byReps) {
    target =
      exercise.repsMin === exercise.repsMax
        ? format(e.targetRepsOne, { sets: exercise.sets, reps: exercise.repsMin! })
        : format(e.targetReps, {
            sets: exercise.sets,
            min: exercise.repsMin!,
            max: exercise.repsMax!,
          });
  } else if (timed) {
    target = format(e.targetTime, {
      sets: exercise.sets,
      time: formatDuration(exercise.durationS!),
    });
  }

  const stepper = (
    field: string,
    value: number,
    limits: { min: number; max: number; step?: number },
    patch: (value: number) => ProgramTargetPatch,
    id: string,
    formatValue?: (value: number) => string,
  ) => (
    <Stepper
      label={field}
      value={value}
      min={limits.min}
      max={limits.max}
      step={limits.step ?? 1}
      onChange={(v) => onChange(patch(v))}
      formatValue={formatValue}
      decreaseLabel={format(e.less, { field: `${field} (${name})` })}
      increaseLabel={format(e.more, { field: `${field} (${name})` })}
      testID={`${testID}-${id}`}
    />
  );

  // The same compact icons as the session's exercise cards (spec 009).
  const icon = (
    glyph: string,
    label: string,
    onPress: () => void,
    disabled: boolean,
    id: string,
  ) => (
    <Pressable
      role="button"
      accessibilityLabel={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      testID={`${testID}-${id}`}
      style={({ pressed }) => [styles.icon, { opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}
    >
      <AppText variant="subtitle" weight="bold" tone="muted">
        {glyph}
      </AppText>
    </Pressable>
  );

  return (
    <View style={[styles.row, { borderColor: colors.border }]} testID={testID}>
      <View style={styles.header}>
        <Pressable
          role="button"
          aria-expanded={open}
          accessibilityLabel={format(e.editA11y, { name })}
          onPress={onToggle}
          style={styles.text}
          testID={`${testID}-toggle`}
        >
          <AppText weight="bold">{name}</AppText>
          <AppText tone="muted" testID={`${testID}-target`}>
            {target}
          </AppText>
          {exercise.exerciseId === null ? (
            <AppText variant="caption" tone="warning">
              {e.noExercise}
            </AppText>
          ) : null}
        </Pressable>
        {icon('↑', format(e.moveUp, { name }), () => onMove(-1), index === 0, 'up')}
        {icon('↓', format(e.moveDown, { name }), () => onMove(1), index === count - 1, 'down')}
        {icon('✕', format(e.remove, { name }), onRemove, false, 'remove')}
      </View>
      {open ? (
        <View style={styles.editor}>
          {stepper(
            e.sets,
            exercise.sets,
            { min: PROGRAM_LIMITS.setsMin, max: PROGRAM_LIMITS.setsMax },
            (sets) => ({ sets }),
            'sets',
          )}
          {byReps ? (
            <>
              {stepper(e.repsMin, exercise.repsMin!, REPS, (repsMin) => ({ repsMin }), 'reps-min')}
              {stepper(e.repsMax, exercise.repsMax!, REPS, (repsMax) => ({ repsMax }), 'reps-max')}
            </>
          ) : null}
          {timed
            ? stepper(
                e.time,
                exercise.durationS!,
                TIME,
                (durationS) => ({ durationS }),
                'time',
                formatDuration,
              )
            : null}
          <Button variant="secondary" label={e.done} onPress={onToggle} testID={`${testID}-done`} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: tokens.space.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs },
  text: { flex: 1, gap: 2, minHeight: 44, justifyContent: 'center' },
  icon: {
    width: 40,
    height: tokens.layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editor: { gap: tokens.space.sm, paddingTop: tokens.space.sm },
});
