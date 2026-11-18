import { WORKOUT_LIMITS, type Profile } from '@pt/contracts';
import {
  elapsedMinutes,
  formatDuration,
  isStaleSession,
  lastDays,
  restRemaining,
  showsRecordsFor,
  staleEndTime,
  toLocalTime,
  type LiveSession,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { DaySelector } from '@/components/DaySelector';
import { ExerciseCard } from '@/components/ExerciseCard';
import { FinishSheet } from '@/components/FinishSheet';
import { Notice } from '@/components/Notice';
import { RestTimerBar } from '@/components/RestTimerBar';
import { Screen } from '@/components/Screen';
import { StaleSessionNotice } from '@/components/StaleSessionNotice';
import { TextField } from '@/components/TextField';
import { TrainingNotes } from '@/components/TrainingNotes';
import { useI18n } from '@/hooks/useI18n';
import { useNow } from '@/hooks/useNow';
import { useRestFeedback } from '@/hooks/useRestFeedback';
import { useSetFormat } from '@/hooks/useSetFormat';
import { useToday } from '@/hooks/useToday';
import { useTrainingActions } from '@/hooks/useTraining';
import { useMe, useWorkouts } from '@/lib/api';
import {
  dispatchSession,
  useSession,
  useStaleDismissed,
  type SessionSlot,
} from '@/lib/liveSession';
import { localDateTime } from '@/lib/trainingTime';

/**
 * The session screen (spec 009 AC6–AC13): the live session in the gym (`slot=live`), or a past or saved
 * session without the rest timer (`slot=draft`, AC17 and AC19). Every change is saved on the device at
 * once (AC11); "Terminar" opens the summary (AC12). `finish=stale` opens it at the last set (AC13).
 */
export default function SessionRoute() {
  const { t } = useI18n();
  const router = useRouter();
  const me = useMe();
  const params = useLocalSearchParams<{ slot?: string; finish?: string }>();
  const slot: SessionSlot = params.slot === 'draft' ? 'draft' : 'live';
  const session = useSession(slot);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/training'));

  if (!me.data?.profile) return <BlockingState />;
  if (!session) {
    return (
      <Screen testID="session-screen">
        <Notice tone="info" message={t.training.workout.notFound} testID="session-missing" />
        <Button variant="secondary" label={t.training.workout.close} onPress={close} />
      </Screen>
    );
  }
  return (
    <SessionEditor
      key={session.id}
      slot={slot}
      session={session}
      profile={me.data.profile}
      finishStale={params.finish === 'stale'}
    />
  );
}

const KEEP_AWAKE_TAG = 'training-session';

/**
 * The screen stays on while a live session is open (spec 009 Assumptions). Not `useKeepAwake`: on web
 * the wake lock activates asynchronously and releasing it before that throws; here both sides may fail
 * quietly (a browser without the Wake Lock API, a hidden tab).
 */
function KeepAwake() {
  useEffect(() => {
    const activation = activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    // Released after it is held, so a quick exit does not leave the screen on.
    return () => {
      void activation.then(() => deactivateKeepAwake(KEEP_AWAKE_TAG)).catch(() => undefined);
    };
  }, []);
  return null;
}

function SessionEditor({
  slot,
  session,
  profile,
  finishStale,
}: {
  slot: SessionSlot;
  session: LiveSession;
  profile: Profile;
  finishStale: boolean;
}) {
  const { t, format } = useI18n();
  const router = useRouter();
  const today = useToday();
  const actions = useTrainingActions();
  const workouts = useWorkouts(today);
  const fmt = useSetFormat(profile.units);
  const live = session.mode === 'live';
  const now = useNow(1000, live);
  const nowIso = now.toISOString();
  const feedback = useRestFeedback();
  const staleDismissed = useStaleDismissed(session.id);
  const stale = live && isStaleSession(session, nowIso) && !staleDismissed;
  const [finishing, setFinishing] = useState<'now' | 'stale' | null>(finishStale ? 'stale' : null);
  const s = t.training.session;
  const flags = profile.safetyFlags;

  // The end of the rest (AC9), from timestamps: the chime plays once, unless the timer ended while the
  // app was in the background. The bar then says the rest is over until the next set or "Saltar"; a
  // timer that ended long ago is closed.
  const remaining = restRemaining(session.rest, nowIso);
  const announced = useRef<string | null>(null);
  useEffect(() => {
    const rest = session.rest;
    if (!live || !rest || remaining > 0) return;
    const overdueS = (Date.parse(nowIso) - Date.parse(rest.startedAt)) / 1000 - rest.durationS;
    if (announced.current !== rest.setId) {
      announced.current = rest.setId;
      if (overdueS < 5) feedback();
    }
    if (overdueS > 30) dispatchSession(slot, { type: 'skipRest' });
  }, [live, session.rest, remaining, nowIso, feedback, slot]);
  const editing =
    session.mode === 'edit' ? (workouts.data?.find((w) => w.id === session.id) ?? null) : null;
  const leave = () => router.dismissTo('/training');

  if (finishing) {
    const endedAt = finishing === 'stale' ? staleEndTime(session) : nowIso;
    return (
      <Screen testID="session-screen">
        <FinishSheet
          session={
            finishing === 'stale' && session.minutes === null
              ? { ...session, minutes: elapsedMinutes(session, endedAt) }
              : session
          }
          endedAt={endedAt}
          flags={flags}
          fmt={fmt}
          onSave={(values) => {
            if (actions.saveSession(slot, values, editing)) leave();
          }}
          onBack={() => setFinishing(null)}
          onDiscard={() => {
            actions.discard(slot);
            leave();
          }}
        />
      </Screen>
    );
  }

  const title =
    session.mode === 'live' ? s.title : session.mode === 'manual' ? s.manualTitle : s.editTitle;
  const elapsed = formatDuration((Date.parse(nowIso) - Date.parse(session.startedAt)) / 1000);

  return (
    <Screen
      testID="session-screen"
      dense
      footer={
        live && session.rest ? (
          <RestTimerBar
            remaining={remaining}
            onAdjust={(deltaS) => dispatchSession(slot, { type: 'adjustRest', deltaS })}
            onSkip={() => dispatchSession(slot, { type: 'skipRest' })}
          />
        ) : undefined
      }
    >
      {live ? <KeepAwake /> : null}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="title">{session.name ?? title}</AppText>
          {live ? (
            <AppText
              tone="muted"
              accessibilityLabel={format(s.elapsedA11y, { time: elapsed })}
              testID="session-elapsed"
            >
              {elapsed}
            </AppText>
          ) : null}
        </View>
        <Button label={s.finish} onPress={() => setFinishing('now')} testID="session-finish" />
      </View>
      <TrainingNotes flags={flags} />
      {stale ? (
        <StaleSessionNotice session={session} onFinish={() => setFinishing('stale')} />
      ) : null}
      {session.mode === 'manual' ? (
        <ManualStart slot={slot} session={session} today={today} />
      ) : null}
      {session.exercises.length === 0 ? (
        <AppText tone="muted" testID="session-empty">
          {s.empty}
        </AppText>
      ) : null}
      {session.exercises.map((exercise, index) => (
        <ExerciseCard
          key={exercise.uid}
          slot={slot}
          exercise={exercise}
          position={index}
          count={session.exercises.length}
          units={profile.units}
          fmt={fmt}
          localDate={session.localDate}
          today={today}
          showRecords={showsRecordsFor(exercise.tracking, flags)}
        />
      ))}
      <Button
        variant="secondary"
        label={`+ ${s.addExercise}`}
        onPress={() => router.push({ pathname: '/training/picker', params: { slot } })}
        testID="session-add-exercise"
      />
    </Screen>
  );
}

/** AC17: the day (today and the 6 days before) and the start time of a past session. */
function ManualStart({
  slot,
  session,
  today,
}: {
  slot: SessionSlot;
  session: LiveSession;
  today: string;
}) {
  const { t } = useI18n();
  const s = t.training.session;
  const [time, setTime] = useState(() => toLocalTime(new Date(session.startedAt)));
  const [error, setError] = useState<string | null>(null);

  const apply = (day: string, text: string) => {
    const startedAt = localDateTime(day, text);
    if (!startedAt) {
      setError(s.startTimeError);
      return;
    }
    if (Date.parse(startedAt) > Date.now()) {
      setError(s.startTimeFuture);
      return;
    }
    setError(null);
    dispatchSession(slot, { type: 'setStart', localDate: day, startedAt });
  };

  return (
    <View style={styles.manual}>
      <DaySelector
        label={s.day}
        days={lastDays(today, WORKOUT_LIMITS.pastDaysUi)}
        today={today}
        value={session.localDate}
        onChange={(day) => apply(day, time)}
        layout="scroll"
        testID="session-day"
      />
      <TextField
        label={s.startTime}
        hint={s.startTimeHint}
        value={time}
        onChangeText={(text) => {
          setTime(text);
          apply(session.localDate, text);
        }}
        keyboardType="numbers-and-punctuation"
        error={error}
        testID="session-start-time"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  headerText: { flex: 1 },
  manual: { gap: tokens.space.md },
});
