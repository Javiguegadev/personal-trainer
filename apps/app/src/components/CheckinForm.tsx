import type { StressLevel, WorkShift } from '@pt/contracts';
import {
  SHIFT_KINDS,
  SLEEP_CHIPS,
  blockEndsNextDay,
  selectShift,
  setShiftHours,
  sleepChipOf,
  type CheckinAnswers,
  type PreferredShiftHours,
  type SleepChipKey,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useWeekText } from '@/hooks/useWeekText';
import { useCheckinPrefs } from '@/lib/checkinPrefs';
import { AppText } from './AppText';
import { Button } from './Button';
import { ChoiceGroup } from './ChoiceGroup';
import { TimeField } from './TimeField';

const STRESS_LEVELS: readonly StressLevel[] = ['low', 'normal', 'high'];

/**
 * The five sleep chips (spec 011 Assumptions). A chip stores the middle of its range; tapping the
 * selected chip again clears the answer (AC2: any field may stay empty).
 */
export function SleepChips({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
}) {
  const { t } = useI18n();
  const c = t.checkin;
  const selected = value === null ? null : sleepChipOf(value);
  return (
    <ChoiceGroup<SleepChipKey>
      label={c.sleep}
      options={SLEEP_CHIPS.map((chip) => ({ value: chip.key, label: c.sleepChips[chip.key] }))}
      value={selected}
      onChange={(key) =>
        onChange(key === selected ? null : SLEEP_CHIPS.find((chip) => chip.key === key)!.minutes)
      }
      testID="checkin-sleep"
    />
  );
}

export function StressChips({
  value,
  onChange,
}: {
  value: StressLevel | null;
  onChange: (stress: StressLevel | null) => void;
}) {
  const { t } = useI18n();
  const c = t.checkin;
  return (
    <ChoiceGroup<StressLevel>
      label={c.stress}
      options={STRESS_LEVELS.map((level) => ({ value: level, label: c.stressChips[level] }))}
      value={value}
      onChange={(level) => onChange(level === value ? null : level)}
      testID="checkin-stress"
    />
  );
}

/**
 * Today's shift (AC3): a working shift shows its hours ("Noche · 22:00–06:00 · termina al día
 * siguiente") with "Cambiar hora"; "Libre" has no hours. A kind starts with the hours last chosen for
 * it, or the defaults.
 */
export function ShiftChips({
  answers,
  onChange,
  preferred,
}: {
  answers: CheckinAnswers;
  onChange: (answers: CheckinAnswers) => void;
  preferred: PreferredShiftHours;
}) {
  const { t, format } = useI18n();
  const text = useWeekText();
  const [editing, setEditing] = useState(false);
  const [sameTimes, setSameTimes] = useState(false);
  const c = t.checkin;
  const { workShift: shift, shiftStartMinute: start, shiftEndMinute: end } = answers;

  const apply = (startMinute: number, endMinute: number) => {
    // A shift never starts and ends at the same minute: the change is not applied, and it says why.
    setSameTimes(startMinute === endMinute);
    onChange(setShiftHours(answers, { startMinute, endMinute }));
  };

  return (
    <View style={styles.group}>
      <ChoiceGroup<WorkShift>
        label={c.shift}
        options={SHIFT_KINDS.map((kind) => ({ value: kind, label: c.shiftChips[kind] }))}
        value={shift}
        onChange={(kind) => {
          setEditing(false);
          setSameTimes(false);
          onChange(selectShift(answers, kind, preferred));
        }}
        testID="checkin-shift"
      />
      {shift !== null && shift !== 'off' && start !== null && end !== null ? (
        <View style={styles.group}>
          <AppText testID="checkin-shift-hours">
            {[
              format(c.shiftHours, {
                shift: c.shiftChips[shift],
                start: text.time(start),
                end: text.time(end),
              }),
              blockEndsNextDay({ startMinute: start, endMinute: end }) ? t.week.endsNextDay : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
          {editing ? (
            <View style={styles.times}>
              <TimeField
                label={t.week.start}
                value={start}
                onChange={(minute) => apply(minute ?? start, end)}
                testID="checkin-shift-start"
              />
              <TimeField
                label={t.week.end}
                value={end}
                onChange={(minute) => apply(start, minute ?? end)}
                error={sameTimes ? t.week.sameTimes : null}
                testID="checkin-shift-end"
              />
            </View>
          ) : null}
          <View style={styles.start}>
            <Button
              variant="ghost"
              label={editing ? c.doneTime : c.changeTime}
              onPress={() => {
                setEditing(!editing);
                setSameTimes(false);
              }}
              testID="checkin-shift-change"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** The check-in questions, shared by the Today card and the check-in screen. */
export function CheckinForm({
  answers,
  onChange,
  asksShift,
}: {
  answers: CheckinAnswers;
  onChange: (answers: CheckinAnswers) => void;
  asksShift: boolean;
}) {
  const { t } = useI18n();
  const prefs = useCheckinPrefs();
  return (
    <View style={styles.form}>
      <SleepChips
        value={answers.sleepMinutes}
        onChange={(sleepMinutes) => onChange({ ...answers, sleepMinutes })}
      />
      <StressChips value={answers.stress} onChange={(stress) => onChange({ ...answers, stress })} />
      {asksShift ? (
        <ShiftChips answers={answers} onChange={onChange} preferred={prefs.shiftHours} />
      ) : null}
      <AppText variant="caption" tone="muted">
        {t.checkin.hint}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: tokens.space.md },
  group: { gap: tokens.space.xs },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.md },
  start: { alignSelf: 'flex-start' },
});
