import { WORKOUT_LIMITS, type SafetyFlag } from '@pt/contracts';
import {
  formatNumber,
  hasCompletedSet,
  liveSetRecords,
  sessionSummary,
  showsRecordsFor,
  type LiveSession,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import type { SetFormat } from '@/hooks/useSetFormat';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { Button } from './Button';
import { ChoiceGroup } from './ChoiceGroup';
import { Notice } from './Notice';
import { TextField } from './TextField';

const RPE = Array.from({ length: WORKOUT_LIMITS.rpeMax }, (_, i) => String(i + 1));

export interface FinishValues {
  minutes: number;
  sessionRpe: number | null;
  name: string | null;
}

/**
 * "Terminar" (spec 009 AC12, AC13): duration (editable), exercises, completed sets, volume and new
 * records, how hard it was and a name. "Guardar" needs a completed set; otherwise "Descartar".
 */
export function FinishSheet({
  session,
  endedAt,
  flags,
  fmt,
  onSave,
  onBack,
  onDiscard,
}: {
  session: LiveSession;
  /** Now, or the last completed set of a stale session (AC13). */
  endedAt: string;
  flags: readonly SafetyFlag[];
  fmt: SetFormat;
  onSave: (values: FinishValues) => void;
  onBack: () => void;
  onDiscard: () => void;
}) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const summary = sessionSummary(session, endedAt);
  const f = t.training.finish;
  // A past session has no clock to go by: an hour is the usual length (editable). A sentence draft
  // keeps the duration said, or an empty field: its sets carry no times (spec 012 AC14).
  const draft = session.textDraft ?? null;
  const [minutesText, setMinutesText] = useState(
    draft
      ? session.minutes === null
        ? ''
        : String(session.minutes)
      : String(summary.minutes ?? 60),
  );
  const [rpe, setRpe] = useState<string | null>(
    session.sessionRpe === null ? null : String(session.sessionRpe),
  );
  const [name, setName] = useState(session.name ?? '');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const minutes = Number(minutesText);
  const minutesValid =
    Number.isInteger(minutes) &&
    minutes >= WORKOUT_LIMITS.minutesMin &&
    minutes <= WORKOUT_LIMITS.minutesMax;
  const canSave = hasCompletedSet(session);
  const hideVolume = flags.includes('ed_soft_stop');
  const records = session.exercises
    .filter((e) => showsRecordsFor(e.tracking, flags))
    .reduce(
      (sum, e) =>
        sum +
        e.sets.filter((s) => s.completedAt && liveSetRecords(e, s.id, session.localDate).length)
          .length,
      0,
    );

  const row = (label: string, value: string, id: string) => (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <AppText tone="muted">{label}</AppText>
      <AppText weight="bold" testID={`finish-${id}`}>
        {value}
      </AppText>
    </View>
  );

  return (
    <View style={styles.sheet} testID="finish-sheet">
      <AppText variant="title">{f.title}</AppText>
      <TextField
        label={f.duration}
        value={minutesText}
        onChangeText={setMinutesText}
        keyboardType="number-pad"
        error={showErrors && !minutesValid ? f.durationError : null}
        testID="finish-minutes"
      />
      <View>
        {row(f.exercises, formatNumber(summary.exercises, locale), 'exercises')}
        {row(f.sets, formatNumber(summary.sets, locale), 'sets')}
        {hideVolume ? null : row(f.volume, fmt.weight(summary.volumeKg), 'volume')}
        {records > 0 ? row(f.records, `🏆 ${formatNumber(records, locale)}`, 'records') : null}
      </View>
      <ChoiceGroup
        label={f.rpe}
        hint={f.rpeHint}
        options={RPE.map((value) => ({ value, label: value }))}
        value={rpe}
        onChange={(value) => setRpe(value === rpe ? null : value)}
        testID="finish-rpe"
      />
      <TextField
        label={f.name}
        value={name}
        onChangeText={setName}
        placeholder={f.namePlaceholder}
        maxLength={WORKOUT_LIMITS.nameMax}
        testID="finish-name"
      />
      {canSave ? null : <Notice tone="info" message={f.noSets} testID="finish-no-sets" />}
      {draft && draft.unresolved.length > 0 ? (
        <Notice
          tone="warning"
          message={t.training.draft.unresolvedLeft}
          testID="finish-unresolved"
        />
      ) : null}
      <Button
        label={f.save}
        disabled={!canSave}
        onPress={() => {
          if (!minutesValid) {
            setShowErrors(true);
            return;
          }
          onSave({
            minutes,
            sessionRpe: rpe === null ? null : Number(rpe),
            name: name.trim() || null,
          });
        }}
        testID="finish-save"
      />
      <Button variant="secondary" label={f.back} onPress={onBack} testID="finish-back" />
      {session.mode === 'edit' ? null : confirmDiscard ? (
        <Notice tone="warning" message={t.training.session.discardConfirm} testID="discard-confirm">
          <View style={styles.actions}>
            <Button
              variant="danger"
              label={t.training.session.discardYes}
              onPress={onDiscard}
              testID="discard-yes"
            />
            <Button
              variant="secondary"
              label={t.training.session.cancel}
              onPress={() => setConfirmDiscard(false)}
            />
          </View>
        </Notice>
      ) : (
        <Button
          variant="ghost"
          label={t.training.session.discard}
          onPress={() => setConfirmDiscard(true)}
          testID="discard"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: tokens.space.md },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
