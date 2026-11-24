import { IsoDateSchema, WORKOUT_LIMITS, type Profile } from '@pt/contracts';
import { activityChoices, dayAccess, lastDays, toLocalTime, type ActivityChoice } from '@pt/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { DaySelector } from '@/components/DaySelector';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useI18n } from '@/hooks/useI18n';
import { useToday } from '@/hooks/useToday';
import { useTrainingActions } from '@/hooks/useTraining';
import { useMe } from '@/lib/api';
import { localDateTime } from '@/lib/trainingTime';

const MINUTE_CHIPS = ['30', '45', '60', '90'] as const;
const RPE = Array.from({ length: WORKOUT_LIMITS.rpeMax }, (_, i) => String(i + 1));

const keyOf = (choice: ActivityChoice) =>
  choice.activity ? `a:${choice.activity}` : `p:${choice.name ?? ''}`;

/**
 * "Registrar actividad" (spec 009 AC16): a sport, cardio or another activity in a few taps: the type
 * (the profile's activities first), the day, the minutes and, optionally, how hard it was.
 */
export default function ActivityRoute() {
  const me = useMe();
  if (!me.data?.profile) return <BlockingState />;
  return <ActivitySheet profile={me.data.profile} />;
}

function ActivitySheet({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  const router = useRouter();
  const today = useToday();
  const actions = useTrainingActions();
  const choices = activityChoices(profile.plannedActivities);
  const [type, setType] = useState<string | null>(choices[0] ? keyOf(choices[0]) : null);
  // `?date=` from a day screen of the week view (spec 010 AC12): up to 27 days back.
  const { date } = useLocalSearchParams<{ date?: string }>();
  const requested =
    date !== undefined && IsoDateSchema.safeParse(date).success && dayAccess(date, today) === 'add'
      ? date
      : null;
  const [day, setDay] = useState(requested ?? today);
  const recentDays = lastDays(today, WORKOUT_LIMITS.pastDaysUi);
  const days =
    requested && !recentDays.includes(requested) ? [...recentDays, requested] : recentDays;
  const [minutesText, setMinutesText] = useState('60');
  const [rpe, setRpe] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const a = t.training.activity;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/training'));

  const minutes = Number(minutesText);
  const minutesValid =
    Number.isInteger(minutes) &&
    minutes >= WORKOUT_LIMITS.activityMinutesMin &&
    minutes <= WORKOUT_LIMITS.minutesMax;
  const choice = choices.find((c) => keyOf(c) === type) ?? null;

  const save = () => {
    if (!choice || !minutesValid) {
      setShowErrors(true);
      return;
    }
    const now = new Date();
    actions.saveActivity({
      kind: choice.kind,
      activity: choice.activity,
      name: choice.name,
      localDate: day,
      startedAt: localDateTime(day, toLocalTime(now)) ?? now.toISOString(),
      minutes,
      sessionRpe: rpe === null ? null : Number(rpe),
    });
    close();
  };

  return (
    <Screen
      testID="activity-sheet"
      footer={
        <>
          <Button label={a.save} onPress={save} testID="activity-save" />
          <Button variant="ghost" label={a.cancel} onPress={close} />
        </>
      }
    >
      <AppText variant="title">{a.title}</AppText>
      <ChoiceGroup
        label={a.type}
        options={choices.map((c) => ({
          value: keyOf(c),
          label: c.name ?? t.training.activities[c.activity ?? 'other'],
        }))}
        value={type}
        onChange={setType}
        error={showErrors && !choice ? a.typeError : null}
        testID="activity-type"
      />
      <DaySelector
        label={a.day}
        days={days}
        today={today}
        value={day}
        onChange={setDay}
        layout="scroll"
        testID="activity-day"
      />
      <ChoiceGroup
        label={a.minutes}
        options={MINUTE_CHIPS.map((value) => ({ value, label: value }))}
        value={MINUTE_CHIPS.find((m) => m === minutesText) ?? null}
        onChange={setMinutesText}
        testID="activity-minutes"
      />
      <TextField
        label={a.minutesField}
        value={minutesText}
        onChangeText={setMinutesText}
        keyboardType="number-pad"
        error={showErrors && !minutesValid ? a.minutesError : null}
        testID="activity-minutes-field"
      />
      <ChoiceGroup
        label={t.training.finish.rpe}
        hint={t.training.finish.rpeHint}
        options={RPE.map((value) => ({ value, label: value }))}
        value={rpe}
        onChange={(value) => setRpe(value === rpe ? null : value)}
        testID="activity-rpe"
      />
    </Screen>
  );
}
