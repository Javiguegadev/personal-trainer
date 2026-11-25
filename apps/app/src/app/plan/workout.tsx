import {
  IsoDateSchema,
  PLAN_LIMITS,
  WORKOUT_LIMITS,
  type PlannedWorkout,
  type Profile,
  type Program,
  type Workout,
} from '@pt/contracts';
import {
  activityChoices,
  canPlan,
  defaultGymMinutes,
  formatShortDate,
  isStaleRoutineLink,
  nextProgramSession,
  planNotices,
  planTargetWeeks,
  plannedSessionFor,
  repeatShortcuts,
  type ActivityChoice,
  type PlanSessionChoice,
} from '@pt/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { DaySelector } from '@/components/DaySelector';
import { Notice } from '@/components/Notice';
import { PlanNotices } from '@/components/PlanNotices';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { TimeField } from '@/components/TimeField';
import { useCheckinList } from '@/hooks/useCheckin';
import { useI18n } from '@/hooks/useI18n';
import { usePlanActions } from '@/hooks/usePlanActions';
import { usePlanText } from '@/hooks/usePlanText';
import { useToday } from '@/hooks/useToday';
import { useWorkoutText } from '@/hooks/useWorkoutText';
import { useMe, usePlan, useProgram, useWorkouts } from '@/lib/api';
import { newId } from '@/lib/id';
import { profileActivities, profileWeek } from '@/lib/week';

const MINUTE_CHIPS = ['30', '45', '60', '90'] as const;
const DEFAULT_ACTIVITY_MINUTES = 60;

/** What a planned session is (AC10): a session of the routine, a repeat, an activity or free gym. */
type What = 'program' | 'repeat' | 'activity' | 'free';

const keyOf = (choice: Pick<ActivityChoice, 'activity' | 'name'>) =>
  choice.activity ? `a:${choice.activity}` : `p:${choice.name ?? ''}`;

/**
 * "Planificar entreno" (spec 013 AC10) and a planned session changed or removed (AC12), opened over
 * the day screen: `?date=` plans a new one, `?id=` opens a planned one. The quiet notices of AC13
 * follow the draft; nothing here blocks except the 4 sessions a day.
 */
export default function PlanWorkoutRoute() {
  const { t } = useI18n();
  const router = useRouter();
  const me = useMe();
  const today = useToday();
  const plan = usePlan(today);
  const program = useProgram();
  const log = useWorkouts(today);
  const params = useLocalSearchParams<{ date?: string; id?: string }>();
  const w = t.plan.workout;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const found = params.id ? plan.data?.workouts.find((p) => p.id === params.id) : undefined;
  // A removed session leaves the plan at once: keep showing it while the sheet closes.
  const [last, setLast] = useState(found);
  if (found && found !== last) setLast(found);
  const editing = found ?? last ?? null;

  if (!me.data?.profile || plan.isPending || program.isPending) return <BlockingState />;
  const missing = (message: string, testID: string) => (
    <Screen testID="plan-workout-sheet">
      <Notice tone="info" message={message} testID={testID} />
      <Button variant="secondary" label={w.close} onPress={close} />
    </Screen>
  );
  if (params.id && !editing) return missing(w.notFound, 'plan-workout-missing');
  const requested = IsoDateSchema.safeParse(params.date);
  const date = editing?.localDate ?? (requested.success ? requested.data : today);
  if (!canPlan(date, today)) return missing(w.pastDay, 'plan-workout-past');

  return (
    <PlanWorkoutSheet
      profile={me.data.profile}
      program={program.data ?? null}
      workouts={log.data ?? []}
      planned={plan.data?.workouts ?? []}
      editing={editing}
      date={date}
      today={today}
      close={close}
    />
  );
}

/** The sheet's first values: the planned session's, or the defaults of a new one. */
function initialDraft(input: {
  editing: PlannedWorkout | null;
  program: Program | null;
  workouts: readonly Workout[];
  repeatable: readonly Workout[];
  choices: readonly ActivityChoice[];
  gymMinutes: number | null;
  activityMinutes: (choice: ActivityChoice | undefined) => number;
}) {
  const { editing, program, choices } = input;
  const sessions = program?.sessions ?? [];
  const firstSession = program
    ? (nextProgramSession(program, input.workouts) ?? sessions[0])
    : null;
  const base = {
    sessionId: firstSession?.id ?? null,
    repeatId: input.repeatable[0]?.id ?? null,
    activityKey: choices[0] ? keyOf(choices[0]) : null,
    activityMinutes: String(input.activityMinutes(choices[0])),
    isMatch: false,
    name: '',
    gymMinutes: input.gymMinutes === null ? '' : String(input.gymMinutes),
    startMinute: null as number | null,
  };
  if (!editing) {
    const what: What =
      sessions.length > 0 ? 'program' : input.repeatable.length > 0 ? 'repeat' : 'activity';
    return { what, ...base };
  }
  const shared = {
    ...base,
    startMinute: editing.startMinute,
    gymMinutes: editing.minutes === null ? '' : String(editing.minutes),
  };
  if (editing.kind !== 'gym') {
    return {
      ...shared,
      what: 'activity' as What,
      activityKey: keyOf(editing),
      activityMinutes: String(editing.minutes ?? DEFAULT_ACTIVITY_MINUTES),
      isMatch: editing.isMatch,
      gymMinutes: base.gymMinutes,
    };
  }
  if (editing.programSessionId !== null && !isStaleRoutineLink(editing, program)) {
    return { ...shared, what: 'program' as What, sessionId: editing.programSessionId };
  }
  if (editing.repeatWorkoutId !== null) {
    return { ...shared, what: 'repeat' as What, repeatId: editing.repeatWorkoutId };
  }
  // A free gym session, or the session of a routine that was deleted (Stale links).
  return { ...shared, what: 'free' as What, name: editing.name ?? '' };
}

function PlanWorkoutSheet({
  profile,
  program,
  workouts,
  planned,
  editing,
  date,
  today,
  close,
}: {
  profile: Profile;
  program: Program | null;
  workouts: readonly Workout[];
  planned: readonly PlannedWorkout[];
  editing: PlannedWorkout | null;
  date: string;
  today: string;
  close: () => void;
}) {
  const { t, format, locale } = useI18n();
  const actions = usePlanActions();
  const planText = usePlanText();
  const workoutText = useWorkoutText();
  const { checkins } = useCheckinList();
  const w = t.plan.workout;
  const sessions = program?.sessions ?? [];
  // "Repetir": the last 3 distinct past sessions, as on the Training tab (AC10).
  const repeatable = repeatShortcuts([...workouts]);
  const profileChoices = activityChoices(profile.plannedActivities);
  // A planned activity whose profile activity was removed keeps its own chip.
  const choices: ActivityChoice[] =
    editing && editing.kind !== 'gym' && !profileChoices.some((c) => keyOf(c) === keyOf(editing))
      ? [{ kind: editing.kind, activity: editing.activity, name: editing.name }, ...profileChoices]
      : profileChoices;
  /** The minutes of the profile activity of that name, or an hour. */
  const activityMinutes = (choice: ActivityChoice | undefined) => {
    const name = choice?.name?.trim().toLowerCase();
    const match = name
      ? profile.plannedActivities.find((a) => a.label?.trim().toLowerCase() === name)
      : undefined;
    return match?.minutesPerSession ?? DEFAULT_ACTIVITY_MINUTES;
  };
  const [draft, setDraft] = useState(() =>
    initialDraft({
      editing,
      program,
      workouts,
      repeatable,
      choices,
      gymMinutes: defaultGymMinutes(profile.plannedActivities),
      activityMinutes,
    }),
  );
  const [day, setDay] = useState(date);
  const [showErrors, setShowErrors] = useState(false);
  const [id] = useState(() => editing?.id ?? newId());
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));

  // A planned repeat of a workout no longer in the shortcuts still shows as an option.
  const repeatOptions: { id: string; label: string }[] = repeatable.map((workout) => ({
    id: workout.id,
    label: format(w.repeatOption, {
      name: workoutText.label(workout),
      date: formatShortDate(workout.localDate, locale),
    }),
  }));
  if (
    editing?.repeatWorkoutId &&
    !repeatOptions.some((option) => option.id === editing.repeatWorkoutId)
  ) {
    repeatOptions.unshift({
      id: editing.repeatWorkoutId,
      label: planText.name(editing),
    });
  }
  const whatOptions: { value: What; label: string }[] = [
    ...(sessions.length > 0 ? [{ value: 'program' as const, label: w.types.program }] : []),
    ...(repeatOptions.length > 0 ? [{ value: 'repeat' as const, label: w.types.repeat }] : []),
    { value: 'activity', label: w.types.activity },
    { value: 'free', label: w.types.free },
  ];

  const activity = choices.find((c) => keyOf(c) === draft.activityKey) ?? null;
  const minutes = Number(draft.activityMinutes);
  const activityMinutesValid =
    Number.isInteger(minutes) &&
    minutes >= WORKOUT_LIMITS.activityMinutesMin &&
    minutes <= WORKOUT_LIMITS.minutesMax;
  const gymMinutesText = draft.gymMinutes.trim();
  const gymMinutes = gymMinutesText === '' ? null : Number(gymMinutesText);
  const gymMinutesValid =
    gymMinutes === null ||
    (Number.isInteger(gymMinutes) &&
      gymMinutes >= WORKOUT_LIMITS.minutesMin &&
      gymMinutes <= WORKOUT_LIMITS.minutesMax);

  const choice = ((): PlanSessionChoice | null => {
    switch (draft.what) {
      case 'program': {
        const session = sessions.find((s) => s.id === draft.sessionId);
        return session ? { type: 'program', session } : null;
      }
      case 'repeat': {
        const option = repeatOptions.find((o) => o.id === draft.repeatId);
        const workout = workouts.find((wk) => wk.id === draft.repeatId);
        if (!option) return null;
        // The name is a snapshot, so the plan still reads right if the workout goes away.
        const name = workout ? workoutText.label(workout) : (editing?.name ?? null);
        return { type: 'repeat', workout: { id: option.id, name } };
      }
      case 'free':
        return { type: 'free', name: draft.name.trim() || null };
      case 'activity':
        return activity && activityMinutesValid
          ? {
              type: 'activity',
              choice: activity,
              minutes,
              isMatch: activity.kind === 'sport' && draft.isMatch,
            }
          : null;
    }
  })();
  const gym = draft.what !== 'activity';
  const row =
    choice && (!gym || gymMinutesValid)
      ? plannedSessionFor(choice, {
          id,
          localDate: day,
          startMinute: draft.startMinute,
          minutes: gym ? gymMinutes : undefined,
          recordedAt: new Date().toISOString(),
        })
      : null;

  const others = planned.filter((p) => p.id !== id);
  const dayFull = others.filter((p) => p.localDate === day).length >= PLAN_LIMITS.sessionsPerDayMax;
  // The quiet notices of AC13 for this session, with the rest of the plan around it.
  const week = {
    workBlocks: profileWeek(profile).workBlocks,
    plannedActivities: profileActivities(profile),
  };
  const notices = row
    ? planNotices({ date: day, planned: [...others, row], week, checkins }).filter(
        (notice) => notice.plannedId === id,
      )
    : [];

  const save = () => {
    if (!row || dayFull) {
      setShowErrors(true);
      return;
    }
    actions.saveSession({ ...row, recordedAt: new Date().toISOString() });
    close();
  };
  const minutesError = (min: number) =>
    format(w.minutesError, { min: String(min), max: String(WORKOUT_LIMITS.minutesMax) });

  return (
    <Screen
      testID="plan-workout-sheet"
      footer={
        <>
          <Button label={w.save} onPress={save} testID="plan-workout-save" />
          {editing ? (
            <Button
              variant="secondary"
              label={w.remove}
              onPress={() => {
                actions.removeSessions(
                  [editing],
                  format(w.removed, { session: planText.name(editing) }),
                );
                close();
              }}
              testID="plan-workout-remove"
            />
          ) : null}
          <Button variant="ghost" label={w.cancel} onPress={close} testID="plan-workout-cancel" />
        </>
      }
    >
      <AppText variant="title">{editing ? w.editTitle : w.title}</AppText>
      <ChoiceGroup
        label={w.what}
        options={whatOptions}
        value={draft.what}
        onChange={(what) => set({ what })}
        testID="plan-workout-what"
      />
      {draft.what === 'program' ? (
        <ChoiceGroup
          label={w.session}
          options={sessions.map((s) => ({ value: s.id, label: s.name }))}
          value={draft.sessionId}
          onChange={(sessionId) => set({ sessionId })}
          testID="plan-workout-session"
        />
      ) : null}
      {draft.what === 'repeat' ? (
        <ChoiceGroup
          label={w.repeatPick}
          options={repeatOptions.map((o) => ({ value: o.id, label: o.label }))}
          value={draft.repeatId}
          onChange={(repeatId) => set({ repeatId })}
          layout="list"
          testID="plan-workout-repeat"
        />
      ) : null}
      {draft.what === 'free' ? (
        <TextField
          label={w.name}
          placeholder={w.namePlaceholder}
          value={draft.name}
          onChangeText={(name) => set({ name })}
          maxLength={WORKOUT_LIMITS.nameMax}
          testID="plan-workout-name"
        />
      ) : null}
      {draft.what === 'activity' ? (
        <>
          <ChoiceGroup
            label={w.activity}
            options={choices.map((c) => ({
              value: keyOf(c),
              label: c.name ?? t.training.activities[c.activity ?? 'other'],
            }))}
            value={draft.activityKey}
            onChange={(activityKey) =>
              set({
                activityKey,
                activityMinutes: String(
                  activityMinutes(choices.find((c) => keyOf(c) === activityKey)),
                ),
              })
            }
            error={showErrors && !activity ? t.training.activity.typeError : null}
            testID="plan-workout-activity"
          />
          {activity?.kind === 'sport' ? (
            <Checkbox
              label={w.match}
              checked={draft.isMatch}
              onChange={(isMatch) => set({ isMatch })}
              testID="plan-workout-match"
            />
          ) : null}
          <ChoiceGroup
            label={w.minutes}
            options={MINUTE_CHIPS.map((value) => ({ value, label: value }))}
            value={MINUTE_CHIPS.find((m) => m === draft.activityMinutes) ?? null}
            onChange={(activityMinutes) => set({ activityMinutes })}
            testID="plan-workout-minutes"
          />
          <TextField
            label={w.minutesField}
            value={draft.activityMinutes}
            onChangeText={(activityMinutes) => set({ activityMinutes })}
            keyboardType="number-pad"
            error={
              showErrors && !activityMinutesValid
                ? minutesError(WORKOUT_LIMITS.activityMinutesMin)
                : null
            }
            testID="plan-workout-minutes-field"
          />
        </>
      ) : null}
      <DaySelector
        label={w.day}
        days={planTargetWeeks(today).flatMap((week) => week.days)}
        today={today}
        value={day}
        onChange={setDay}
        layout="scroll"
        error={dayFull ? format(w.dayFull, { max: String(PLAN_LIMITS.sessionsPerDayMax) }) : null}
        testID="plan-workout-day"
      />
      <TimeField
        label={w.time}
        value={draft.startMinute}
        onChange={(startMinute) => set({ startMinute })}
        optional
        testID="plan-workout-time"
      />
      {gym ? (
        <TextField
          label={w.gymMinutes}
          value={draft.gymMinutes}
          onChangeText={(value) => set({ gymMinutes: value })}
          keyboardType="number-pad"
          error={showErrors && !gymMinutesValid ? minutesError(WORKOUT_LIMITS.minutesMin) : null}
          testID="plan-workout-gym-minutes"
        />
      ) : null}
      {row ? <PlanNotices notices={notices} planned={[row]} /> : null}
    </Screen>
  );
}
