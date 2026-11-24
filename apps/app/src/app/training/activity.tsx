import { ActivityTypeSchema, IsoDateSchema, WORKOUT_LIMITS, type Profile } from '@pt/contracts';
import { activityChoices, dayAccess, lastDays, toLocalTime, type ActivityChoice } from '@pt/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { DaySelector } from '@/components/DaySelector';
import { DraftBanner } from '@/components/DraftBanner';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useI18n } from '@/hooks/useI18n';
import { useToday } from '@/hooks/useToday';
import { useTrainingActions } from '@/hooks/useTraining';
import {
  activityDraftParams,
  removeActivityDraftExtra,
  setActivityDraftExtras,
  useActivityDraftExtras,
} from '@/lib/activityDraft';
import { useMe } from '@/lib/api';
import { dispatchSession } from '@/lib/liveSession';
import { draftStart, localDateTime } from '@/lib/trainingTime';

const MINUTE_CHIPS = ['30', '45', '60', '90'] as const;
const RPE = Array.from({ length: WORKOUT_LIMITS.rpeMax }, (_, i) => String(i + 1));

const keyOf = (choice: ActivityChoice) =>
  choice.activity ? `a:${choice.activity}` : `p:${choice.name ?? ''}`;

/**
 * Params of a sheet opened from a sentence (spec 012 AC5, AC6, AC10): `source=text` saves with the
 * input method `text`; `extra` is the index of a "También" line of the gym editor (`extraOf=session`)
 * or of another activity sheet (`extraOf=activity`), removed once saved.
 */
type ActivityParams = {
  date?: string;
  type?: string;
  minutes?: string;
  rpe?: string;
  time?: string;
  source?: string;
  extra?: string;
  extraOf?: string;
  pain?: string;
  distance?: string;
  dayDropped?: string;
};

const intParam = (value: string | undefined, min: number, max: number) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isInteger(n) && n >= min && n <= max
    ? n
    : null;
};

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
  const params = useLocalSearchParams<ActivityParams>();
  const fromText = params.source === 'text';
  const saidType = ActivityTypeSchema.safeParse(params.type);
  const [type, setType] = useState<string | null>(
    saidType.success ? `a:${saidType.data}` : choices[0] ? keyOf(choices[0]) : null,
  );
  // `?date=` from a day screen of the week view (spec 010 AC12): up to 27 days back.
  const { date } = params;
  const requested =
    date !== undefined && IsoDateSchema.safeParse(date).success && dayAccess(date, today) === 'add'
      ? date
      : null;
  const [day, setDay] = useState(requested ?? today);
  // The day said in the sentence was dropped (spec 012 AC4): marked until the user picks one.
  const [dayDropped, setDayDropped] = useState(params.dayDropped === '1');
  const recentDays = lastDays(today, WORKOUT_LIMITS.pastDaysUi);
  const days =
    requested && !recentDays.includes(requested) ? [...recentDays, requested] : recentDays;
  // A sentence that said no minutes leaves the field empty: a value not said is never invented.
  const saidMinutes = intParam(
    params.minutes,
    WORKOUT_LIMITS.activityMinutesMin,
    WORKOUT_LIMITS.minutesMax,
  );
  const [minutesText, setMinutesText] = useState(
    saidMinutes !== null ? String(saidMinutes) : fromText ? '' : '60',
  );
  const saidRpe = intParam(params.rpe, WORKOUT_LIMITS.rpeMin, WORKOUT_LIMITS.rpeMax);
  const [rpe, setRpe] = useState<string | null>(saidRpe === null ? null : String(saidRpe));
  // Only the sheet of the sentence itself lists the other activities said (AC6).
  const extras = useActivityDraftExtras();
  const ownExtras = fromText && params.extra === undefined;
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
      startedAt: params.time
        ? draftStart(day, params.time, today, now)
        : (localDateTime(day, toLocalTime(now)) ?? now.toISOString()),
      minutes,
      sessionRpe: rpe === null ? null : Number(rpe),
      inputMethod: fromText ? 'text' : 'activity',
    });
    const extra = intParam(params.extra, 0, 10);
    if (extra !== null) {
      // A "También" line (AC6): back to the draft it came from, without that line.
      if (params.extraOf === 'session') {
        dispatchSession('draft', { type: 'removeExtraActivity', index: extra });
      } else {
        removeActivityDraftExtra(extra);
      }
      close();
    } else if (fromText) {
      setActivityDraftExtras(null);
      router.dismissTo('/training');
    } else {
      close();
    }
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
      {fromText ? (
        <DraftBanner
          painMentioned={params.pain === '1'}
          distanceDropped={params.distance === '1'}
          extraActivities={ownExtras ? extras.extraActivities : []}
          ignored={ownExtras ? extras.ignored : 0}
          onRegister={(index, extra) =>
            router.push({
              pathname: '/training/activity',
              params: {
                ...activityDraftParams(extra, day, params.time ?? null),
                extra: String(index),
                extraOf: 'activity',
              },
            })
          }
          onChangeSentence={ownExtras ? close : undefined}
        />
      ) : null}
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
        onChange={(next) => {
          setDay(next);
          setDayDropped(false);
        }}
        layout="scroll"
        testID="activity-day"
      />
      {dayDropped ? (
        <Notice
          tone="warning"
          message={t.training.draft.dayDropped}
          testID="activity-day-dropped"
        />
      ) : null}
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
