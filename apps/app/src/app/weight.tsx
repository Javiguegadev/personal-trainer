import { IsoDateSchema, type Profile, type WeightEntry } from '@pt/contracts';
import {
  WEIGHT_STEP,
  checkWeightDate,
  formatDecimal,
  parseWeightField,
  stepWeightField,
  weightDayOptions,
  weightFieldFromKg,
  weightNeedingConfirmation,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { DaySelector, useDayLabel } from '@/components/DaySelector';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useI18n } from '@/hooks/useI18n';
import { useOnline } from '@/hooks/useOnline';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useWeightFormat } from '@/hooks/useWeightFormat';
import { useDeleteWeight, useMe, useSaveWeight, useWeights } from '@/lib/api';

/** The weight sheet (spec 003 AC6–AC9), opened over the tabs. `?date=` edits that day. */
export default function WeightRoute() {
  const me = useMe();
  const today = useToday();
  const weights = useWeights(today);
  const params = useLocalSearchParams<{ date?: string }>();
  // Wait for the log once: the field opens with the last weight.
  if (!me.data?.profile || weights.isPending) return <BlockingState />;

  const requested = IsoDateSchema.safeParse(params.date);
  const initialDate =
    requested.success && checkWeightDate(requested.data, today) === null ? requested.data : today;
  return (
    <WeightSheet
      profile={me.data.profile}
      entries={weights.data ?? []}
      today={today}
      initialDate={initialDate}
    />
  );
}

function WeightSheet({
  profile,
  entries,
  today,
  initialDate,
}: {
  profile: Profile;
  entries: readonly WeightEntry[];
  today: string;
  initialDate: string;
}) {
  const { t, format, locale } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const save = useSaveWeight();
  const remove = useDeleteWeight();
  const { units } = profile;
  const fmt = useWeightFormat(units);
  const s = t.weight.sheet;
  const dayLabel = useDayLabel(today);

  const entryOn = (localDate: string) => entries.find((entry) => entry.localDate === localDate);
  const [date, setDate] = useState(initialDate);
  const [text, setText] = useState(() =>
    weightFieldFromKg(
      entryOn(initialDate)?.weightKg ?? entries.at(-1)?.weightKg ?? profile.weightKg,
      units,
      locale,
    ),
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [confirmFrom, setConfirmFrom] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const days = weightDayOptions(today);
  // An older entry opened from the list gets its own chip.
  if (!days.includes(date)) days.push(date);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const editText = (next: string) => {
    setText(next);
    setFieldError(null);
    setConfirmFrom(null);
  };
  const parsed = parseWeightField(text, units);
  const formErrors: Record<string, string> = t.onboarding.form.errors;

  function submit(confirmed: boolean) {
    if (!parsed.ok) {
      setFieldError(formErrors[parsed.error] ?? t.errors.validation_error);
      return;
    }
    const dateError = checkWeightDate(date, today);
    if (dateError) {
      setDayError(t.weight.dateErrors[dateError]);
      return;
    }
    // A reading far from the previous one is often a typing mistake (AC7).
    const previous = weightNeedingConfirmation(parsed.weightKg, date, entries);
    if (!confirmed && previous !== null) {
      setConfirmFrom(previous);
      return;
    }
    save.mutate({
      localDate: date,
      weightKg: parsed.weightKg,
      recordedAt: new Date().toISOString(),
      today,
    });
    close();
  }

  const step = formatDecimal(WEIGHT_STEP[units], locale, 1);
  return (
    <Screen
      testID="weight-sheet"
      footer={
        <>
          {confirmFrom !== null && parsed.ok ? (
            <Notice
              tone="warning"
              title={s.confirmTitle}
              message={format(s.confirmMessage, {
                from: fmt.weight(confirmFrom),
                to: fmt.weight(parsed.weightKg),
              })}
              testID="weight-confirm"
            >
              <Button
                label={s.confirmYes}
                onPress={() => submit(true)}
                testID="weight-confirm-yes"
              />
              <Button variant="ghost" label={s.confirmNo} onPress={() => setConfirmFrom(null)} />
            </Notice>
          ) : (
            <Button label={s.save} onPress={() => submit(false)} testID="save-weight" />
          )}
          <Button variant="ghost" label={s.cancel} onPress={close} testID="cancel-weight" />
        </>
      }
    >
      <AppText variant="title">{s.title}</AppText>
      {online ? null : <Notice tone="info" message={s.offline} testID="weight-offline" />}

      <View style={styles.fieldRow}>
        <StepButton
          symbol="−"
          label={format(s.decrease, { step, unit: fmt.unit })}
          onPress={() => editText(stepWeightField(text, units, locale, -1))}
          testID="weight-decrease"
        />
        <View style={styles.field}>
          <TextField
            label={format(s.field, { unit: fmt.unit })}
            value={text}
            onChangeText={editText}
            keyboardType="decimal-pad"
            inputMode="decimal"
            selectTextOnFocus
            inputStyle={styles.input}
            testID="weight-input"
          />
        </View>
        <StepButton
          symbol="+"
          label={format(s.increase, { step, unit: fmt.unit })}
          onPress={() => editText(stepWeightField(text, units, locale, 1))}
          testID="weight-increase"
        />
      </View>
      {fieldError ? (
        <AppText variant="caption" tone="danger" role="alert" testID="weight-error">
          {fieldError}
        </AppText>
      ) : null}

      <DaySelector
        label={s.day}
        days={days}
        today={today}
        value={date}
        onChange={(next) => {
          setDate(next);
          setDayError(null);
          setConfirmFrom(null);
          setConfirmDelete(false);
          // Editing a day that has an entry starts from its weight.
          const existing = entryOn(next);
          if (existing) setText(weightFieldFromKg(existing.weightKg, units, locale));
        }}
        error={dayError}
        testID="weight-day"
      />
      <AppText variant="caption" tone="muted">
        {s.hint}
      </AppText>

      {entryOn(date) ? (
        confirmDelete ? (
          <Notice
            tone="warning"
            message={format(s.deleteConfirm, { date: dayLabel(date) })}
            testID="weight-delete-confirm"
          >
            <Button
              variant="danger"
              label={s.deleteYes}
              onPress={() => {
                remove.mutate({ localDate: date, today });
                close();
              }}
              testID="delete-weight-yes"
            />
            <Button variant="ghost" label={s.cancel} onPress={() => setConfirmDelete(false)} />
          </Notice>
        ) : (
          <Button
            variant="secondary"
            label={s.delete}
            onPress={() => setConfirmDelete(true)}
            testID="delete-weight"
          />
        )
      ) : null}
    </Screen>
  );
}

function StepButton({
  symbol,
  label,
  onPress,
  testID,
}: {
  symbol: string;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.step,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <AppText variant="subtitle" weight="bold">
        {symbol}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fieldRow: { flexDirection: 'row', alignItems: 'flex-end', gap: tokens.space.sm },
  field: { flex: 1 },
  input: { minHeight: 56, fontSize: tokens.fontSize.title, fontWeight: '700', textAlign: 'center' },
  step: {
    width: 56,
    height: 56,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
