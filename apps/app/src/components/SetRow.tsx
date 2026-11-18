import { WORKOUT_LIMITS, type SetValues, type Units } from '@pt/contracts';
import {
  canCompleteSet,
  formatDuration,
  isWeightJump,
  liveSetRecords,
  parseDurationField,
  parseSetWeightField,
  stepWeight,
  withPlaceholder,
  type LiveExercise,
  type LiveSet,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useNow } from '@/hooks/useNow';
import type { SetFormat } from '@/hooks/useSetFormat';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { RecordMark } from './RecordMark';
import { SetField } from './SetField';

/** Width of a stepper button: 48 px tall, 44 px wide, so the whole row fits in one line at 360 px. */
const STEP_WIDTH = 44;

const parseReps = (text: string) => {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= WORKOUT_LIMITS.repsMin && n <= WORKOUT_LIMITS.repsMax
    ? n
    : undefined;
};
const parseDistance = (text: string) => {
  if (text.trim() === '') return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) && n >= WORKOUT_LIMITS.distanceMMin && n <= WORKOUT_LIMITS.distanceMMax
    ? Math.round(n)
    : undefined;
};

interface SetRowProps {
  exercise: LiveExercise;
  set: LiveSet;
  /** Position of the exercise in the session, for test ids. */
  position: number;
  index: number;
  units: Units;
  fmt: SetFormat;
  localDate: string;
  /** False for bodyweight exercises with `ed_soft_stop` (spec 009 Safety). */
  showRecords: boolean;
  onChange: (values: Partial<SetValues>) => void;
  onComplete: () => void;
  onUncomplete: () => void;
}

/**
 * One set (spec 009 AC8): the fields of the exercise's tracking, steppers for weight and reps, and ✓.
 * Last time's values show as placeholders and become the values when ✓ is tapped without changes. A
 * completed set can still be edited, or unchecked with ✓ again. A beaten best shows a badge (AC10).
 */
export function SetRow({
  exercise,
  set,
  position,
  index,
  units,
  fmt,
  localDate,
  showRecords,
  onChange,
  onComplete,
  onUncomplete,
}: SetRowProps) {
  const { t, format } = useI18n();
  const { colors } = useTheme();
  const [confirmJump, setConfirmJump] = useState(false);
  const [stopwatchFrom, setStopwatchFrom] = useState<number | null>(null);
  const now = useNow(250, stopwatchFrom !== null);
  const s = t.training.set;
  const n = index + 1;
  const done = set.completedAt !== null;
  const effective = withPlaceholder(set.values, set.placeholder);
  const ph = set.placeholder;
  const completable = canCompleteSet(set, exercise.tracking);
  const tid = `exercise-${position}-set-${index}`;
  const heaviest = exercise.bestsBefore.heaviestKg?.value ?? null;

  // A completed set edited to a weight far above any lifted before goes back to unchecked, so ✓ asks
  // "¿Seguro?" again: a 25 → 250 slip must not become a record (spec 009 Safety).
  const changeWeight = (weightKg: number | null) => {
    if (done && exercise.tracking === 'weight_reps' && isWeightJump(weightKg, heaviest)) {
      onUncomplete();
    }
    onChange({ weightKg });
  };

  const stepButton = (
    label: string,
    glyph: string,
    disabled: boolean,
    onPress: () => void,
    id: string,
  ) => (
    <Pressable
      role="button"
      accessibilityLabel={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      testID={`${tid}-${id}`}
      style={({ pressed }) => [styles.step, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
    >
      <AppText variant="subtitle" weight="bold">
        {glyph}
      </AppText>
    </Pressable>
  );
  const group = (children: ReactNode, flex = 1) => (
    <View
      style={[styles.group, { flex, borderColor: colors.border, backgroundColor: colors.surface }]}
    >
      {children}
    </View>
  );

  const weightField = (label: string, width?: number) => (
    <SetField
      value={set.values.weightKg}
      placeholder={ph?.weightKg ?? null}
      emptyPlaceholder={width === undefined ? fmt.unit : `+${fmt.unit}`}
      toText={fmt.weightField}
      parse={(text) =>
        text.trim() === '' ? null : (parseSetWeightField(text, units) ?? undefined)
      }
      onChange={changeWeight}
      accessibilityLabel={label}
      inGroup={width === undefined}
      width={width}
      testID={`${tid}-weight`}
    />
  );
  const repsField = (
    <SetField
      value={set.values.reps}
      placeholder={ph?.reps ?? null}
      emptyPlaceholder={s.reps.toLowerCase()}
      toText={String}
      parse={parseReps}
      onChange={(reps) => onChange({ reps })}
      accessibilityLabel={`${format(s.number, { n })}: ${s.reps}`}
      keyboardType="number-pad"
      inGroup
      testID={`${tid}-reps`}
    />
  );
  const repsStepper = group(
    <>
      {stepButton(
        format(s.lessReps, { n }),
        '−',
        (effective.reps ?? 0) <= WORKOUT_LIMITS.repsMin,
        () => onChange({ reps: (effective.reps ?? 1) - 1 }),
        'reps-less',
      )}
      {repsField}
      {stepButton(
        format(s.moreReps, { n }),
        '+',
        (effective.reps ?? 0) >= WORKOUT_LIMITS.repsMax,
        () => onChange({ reps: (effective.reps ?? 0) + 1 }),
        'reps-more',
      )}
    </>,
    0.85,
  );
  const durationField = (
    <SetField
      value={set.values.durationS}
      placeholder={ph?.durationS ?? null}
      emptyPlaceholder="0:00"
      toText={formatDuration}
      parse={(text) => (text.trim() === '' ? null : (parseDurationField(text) ?? undefined))}
      onChange={(durationS) => onChange({ durationS })}
      accessibilityLabel={`${format(s.number, { n })}: ${s.time}`}
      keyboardType="numbers-and-punctuation"
      override={
        stopwatchFrom !== null ? formatDuration((now.getTime() - stopwatchFrom) / 1000) : null
      }
      testID={`${tid}-time`}
    />
  );

  let fields: ReactNode;
  switch (exercise.tracking) {
    case 'weight_reps':
      fields = (
        <>
          {group(
            <>
              {stepButton(
                format(s.lessWeight, { n }),
                '−',
                (effective.weightKg ?? 0) <= 0,
                () => changeWeight(stepWeight(effective.weightKg, -1, units)),
                'weight-less',
              )}
              {weightField(`${format(s.number, { n })}: ${format(s.weight, { unit: fmt.unit })}`)}
              {stepButton(
                format(s.moreWeight, { n }),
                '+',
                (effective.weightKg ?? 0) >= WORKOUT_LIMITS.weightKgMax,
                () => changeWeight(stepWeight(effective.weightKg, 1, units)),
                'weight-more',
              )}
            </>,
            1.15,
          )}
          {repsStepper}
        </>
      );
      break;
    case 'reps':
      fields = (
        <>
          {repsStepper}
          {weightField(
            `${format(s.number, { n })}: ${format(s.extraWeight, { unit: fmt.unit })}`,
            72,
          )}
        </>
      );
      break;
    case 'duration':
      fields = (
        <>
          {durationField}
          <Pressable
            role="button"
            accessibilityLabel={format(stopwatchFrom === null ? s.stopwatch : s.stopwatchStop, {
              n,
            })}
            onPress={() => {
              if (stopwatchFrom === null) {
                setStopwatchFrom(Date.now());
                return;
              }
              const seconds = Math.round((Date.now() - stopwatchFrom) / 1000);
              setStopwatchFrom(null);
              onChange({
                durationS: Math.min(
                  Math.max(seconds, WORKOUT_LIMITS.durationSMin),
                  WORKOUT_LIMITS.durationSMax,
                ),
              });
            }}
            testID={`${tid}-stopwatch`}
            style={({ pressed }) => [
              styles.square,
              {
                borderColor: colors.border,
                backgroundColor: colors.surface,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <AppText weight="bold">{stopwatchFrom === null ? '⏱' : '■'}</AppText>
          </Pressable>
        </>
      );
      break;
    case 'distance_duration':
      fields = (
        <>
          <SetField
            value={set.values.distanceM}
            placeholder={ph?.distanceM ?? null}
            emptyPlaceholder="m"
            toText={String}
            parse={parseDistance}
            onChange={(distanceM) => onChange({ distanceM })}
            accessibilityLabel={`${format(s.number, { n })}: ${s.distance}`}
            keyboardType="number-pad"
            testID={`${tid}-distance`}
          />
          {durationField}
        </>
      );
      break;
  }

  const complete = () => {
    if (done) {
      onUncomplete();
      return;
    }
    if (exercise.tracking === 'weight_reps' && isWeightJump(effective.weightKg, heaviest)) {
      setConfirmJump(true);
      return;
    }
    onComplete();
  };

  const records = done && showRecords ? liveSetRecords(exercise, set.id, localDate) : [];

  return (
    <View style={styles.wrap} testID={tid}>
      <View
        style={[
          styles.row,
          done
            ? { backgroundColor: colors.successSurface, borderColor: colors.success }
            : { borderColor: 'transparent' },
        ]}
      >
        <Pressable
          role="checkbox"
          aria-checked={done}
          accessibilityLabel={format(done ? s.uncomplete : s.complete, { n })}
          aria-disabled={!done && !completable}
          disabled={!done && !completable}
          onPress={complete}
          testID={`${tid}-complete`}
          style={({ pressed }) => [
            styles.square,
            {
              backgroundColor: done ? colors.primary : colors.surface,
              borderColor: done ? colors.primary : colors.border,
              opacity: !done && !completable ? 0.4 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <AppText weight="bold" style={{ color: done ? colors.onPrimary : colors.text }}>
            {done ? '✓' : n}
          </AppText>
        </Pressable>
        {fields}
      </View>
      {confirmJump && effective.weightKg !== null ? (
        <Notice
          tone="warning"
          title={format(s.weightJumpTitle, { weight: fmt.weight(effective.weightKg) })}
          message={s.weightJumpText}
          testID={`${tid}-jump`}
        >
          <View style={styles.actions}>
            <Button
              label={s.weightJumpYes}
              onPress={() => {
                setConfirmJump(false);
                onComplete();
              }}
              testID={`${tid}-jump-yes`}
            />
            <Button
              variant="secondary"
              label={s.weightJumpFix}
              onPress={() => setConfirmJump(false)}
            />
          </View>
        </Notice>
      ) : null}
      {records.map((record) => (
        <RecordMark
          key={record.kind}
          label={format(t.training.records[record.kind], {
            value: fmt.best(record.kind, record.value),
          })}
          testID={`${tid}-record-${record.kind}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: tokens.space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.xs,
    borderWidth: 1,
    borderRadius: tokens.radius.md,
    padding: 2,
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: tokens.radius.md,
    overflow: 'hidden',
  },
  step: {
    width: STEP_WIDTH,
    height: tokens.layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  square: {
    width: tokens.layout.minTouchTarget,
    height: tokens.layout.minTouchTarget,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
