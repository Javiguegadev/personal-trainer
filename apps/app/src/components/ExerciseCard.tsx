import type { Units } from '@pt/contracts';
import { formatShortDate, type LiveExercise } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import type { SetFormat } from '@/hooks/useSetFormat';
import { useTheme } from '@/hooks/useTheme';
import { newId } from '@/lib/id';
import { dispatchSession, type SessionSlot } from '@/lib/liveSession';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { SetRow } from './SetRow';

interface ExerciseCardProps {
  slot: SessionSlot;
  exercise: LiveExercise;
  position: number;
  count: number;
  units: Units;
  fmt: SetFormat;
  localDate: string;
  today: string;
  showRecords: boolean;
}

/**
 * One exercise of a session (spec 009 AC7, AC8): "Última vez", its sets, add or remove a set, move it up
 * or down, remove it. The name opens its bests and history (AC15).
 */
export function ExerciseCard({
  slot,
  exercise,
  position,
  count,
  units,
  fmt,
  localDate,
  today,
  showRecords,
}: ExerciseCardProps) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const s = t.training.session;
  const name = exercise.label;
  const uid = exercise.uid;

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
      testID={`exercise-${position}-${id}`}
      style={({ pressed }) => [styles.icon, { opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}
    >
      <AppText variant="subtitle" weight="bold" tone="muted">
        {glyph}
      </AppText>
    </Pressable>
  );

  const remove = () => {
    if (exercise.sets.some((set) => set.completedAt) && !confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    dispatchSession(slot, { type: 'removeExercise', uid });
  };

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID={`exercise-${position}`}
    >
      <View style={styles.header}>
        <Pressable
          role="link"
          style={styles.title}
          onPress={() =>
            router.push({
              pathname: '/training/exercises/[id]',
              params: { id: exercise.exerciseId },
            })
          }
        >
          <AppText variant="subtitle" weight="bold" accessibilityRole="header">
            {name}
          </AppText>
        </Pressable>
        {icon(
          '↑',
          format(s.moveUp, { name }),
          () => dispatchSession(slot, { type: 'moveExercise', uid, offset: -1 }),
          position === 0,
          'up',
        )}
        {icon(
          '↓',
          format(s.moveDown, { name }),
          () => dispatchSession(slot, { type: 'moveExercise', uid, offset: 1 }),
          position === count - 1,
          'down',
        )}
        {icon('✕', format(s.remove, { name }), remove, false, 'remove')}
      </View>
      <AppText variant="caption" tone="muted" testID={`exercise-${position}-last`}>
        {exercise.last
          ? format(s.lastTime, {
              sets: fmt.sets(exercise.last.sets, exercise.tracking),
              date: formatShortDate(
                exercise.last.localDate,
                locale,
                exercise.last.localDate.slice(0, 4) !== today.slice(0, 4),
              ),
            })
          : s.firstTime}
      </AppText>
      {confirmRemove ? (
        <Notice tone="warning" message={format(s.removeConfirm, { name })}>
          <View style={styles.actions}>
            <Button
              variant="danger"
              label={format(s.remove, { name })}
              onPress={() => dispatchSession(slot, { type: 'removeExercise', uid })}
              testID={`exercise-${position}-remove-yes`}
            />
            <Button variant="secondary" label={s.cancel} onPress={() => setConfirmRemove(false)} />
          </View>
        </Notice>
      ) : null}
      {exercise.sets.map((set, index) => (
        <SetRow
          key={set.id}
          exercise={exercise}
          set={set}
          position={position}
          index={index}
          units={units}
          fmt={fmt}
          localDate={localDate}
          showRecords={showRecords}
          onChange={(values) =>
            dispatchSession(slot, { type: 'updateSet', uid, setId: set.id, values })
          }
          onComplete={() =>
            dispatchSession(slot, {
              type: 'completeSet',
              uid,
              setId: set.id,
              at: new Date().toISOString(),
            })
          }
          onUncomplete={() => dispatchSession(slot, { type: 'uncompleteSet', uid, setId: set.id })}
        />
      ))}
      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={`+ ${s.addSet}`}
          accessibilityLabel={format(s.addSetA11y, { name })}
          onPress={() => dispatchSession(slot, { type: 'addSet', uid, setId: newId() })}
          testID={`exercise-${position}-add-set`}
        />
        {exercise.sets.length > 0 ? (
          <Button
            variant="ghost"
            label={`− ${format(t.training.set.remove, { n: exercise.sets.length })}`}
            onPress={() =>
              dispatchSession(slot, { type: 'removeSet', uid, setId: exercise.sets.at(-1)!.id })
            }
            testID={`exercise-${position}-remove-set`}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: tokens.radius.lg,
    paddingHorizontal: tokens.space.xs,
    paddingVertical: tokens.space.sm,
    gap: tokens.space.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: tokens.space.sm },
  title: { flex: 1, minHeight: tokens.layout.minTouchTarget, justifyContent: 'center' },
  icon: {
    width: 44,
    height: tokens.layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
