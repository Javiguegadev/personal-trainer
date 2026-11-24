import { isApiError } from '@pt/api-client';
import {
  IsoDateSchema,
  WORKOUT_DRAFT_LIMITS,
  WORKOUT_LIMITS,
  type WorkoutDraft,
  type WorkoutDraftResponse,
  type WorkoutUnreadableReason,
} from '@pt/contracts';
import { formatWeekdayDay, lastDays, nextProgramSession } from '@pt/core';
import { tokens } from '@pt/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { WorkoutTextInput } from '@/components/WorkoutTextInput';
import { useDraftGuard } from '@/hooks/useDraftGuard';
import { useI18n } from '@/hooks/useI18n';
import { useOnline } from '@/hooks/useOnline';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useTrainingActions } from '@/hooks/useTraining';
import { activityDraftParams, setActivityDraftExtras } from '@/lib/activityDraft';
import { useMe, useProgram, useWorkoutDraft, useWorkouts } from '@/lib/api';
import { draftStart, pastSessionStart } from '@/lib/trainingTime';

/** Why no draft came back: the model's own answer (AC9) or a failure of the call (AC16, AC17). */
type Failure = 'capReached' | 'unavailable' | 'lostConnection' | 'error';

type Step =
  | { kind: 'typing'; unreadable: WorkoutUnreadableReason | null; failure: Failure | null }
  | { kind: 'preparing'; run: number };

const TYPING = { kind: 'typing', unreadable: null, failure: null } as const satisfies Step;

function failureOf(error: unknown): Failure {
  if (isApiError(error, 'ai_cap_reached')) return 'capReached';
  if (isApiError(error, 'ai_unavailable')) return 'unavailable';
  // fetch() rejects with a TypeError when the network is gone.
  if (error instanceof TypeError) return 'lostConnection';
  return 'error';
}

/**
 * "Describir entreno" (spec 012 AC1, AC2, AC9, AC16, AC17): a sentence, typed or dictated, that the API
 * reads into an editable draft. A gym session opens the session editor (`slot=draft`), an activity
 * its sheet, both filled in; nothing is saved until the user saves there. The sentence stays here, so
 * going back keeps it. `?date=` comes from a day screen: the draft's day unless the sentence names one.
 */
export default function DescribeRoute() {
  const me = useMe();
  if (!me.data?.profile) return <BlockingState />;
  return <DescribeScreen />;
}

function DescribeScreen() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const today = useToday();
  const online = useOnline();
  const actions = useTrainingActions();
  const program = useProgram();
  const workouts = useWorkouts(today);
  const workoutDraft = useWorkoutDraft();
  const { guard, notice } = useDraftGuard();
  const params = useLocalSearchParams<{ date?: string }>();
  // The day of the screen it came from: today and the 6 days before, as the API accepts (AC1).
  const recent = lastDays(today, WORKOUT_LIMITS.pastDaysUi);
  const localDate =
    params.date && IsoDateSchema.safeParse(params.date).success && recent.includes(params.date)
      ? params.date
      : today;
  const [text, setText] = useState('');
  const [tooShort, setTooShort] = useState(false);
  const [step, setStep] = useState<Step>(TYPING);
  const runs = useRef(0);
  const d = t.training.describe;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/training'));

  const openDraft = (draft: WorkoutDraft) => {
    if (draft.activity) {
      setActivityDraftExtras({ extraActivities: draft.extraActivities, ignored: draft.ignored });
      router.push({
        pathname: '/training/activity',
        params: {
          ...activityDraftParams(draft.activity, draft.localDate, draft.startTime),
          ...(draft.painMentioned ? { pain: '1' } : {}),
          ...(draft.dayDropped ? { dayDropped: '1' } : {}),
        },
      });
      return;
    }
    const routine = program.data
      ? {
          program: program.data,
          nextSessionId: nextProgramSession(program.data, workouts.data ?? [])?.id ?? null,
        }
      : null;
    actions.startFromDraft(
      draft,
      draftStart(draft.localDate, draft.startTime, today, new Date()),
      routine,
    );
    router.push({ pathname: '/training/session', params: { slot: 'draft', from: 'describe' } });
  };

  const prepare = async (sentence: string) => {
    const run = ++runs.current;
    setStep({ kind: 'preparing', run });
    let response: WorkoutDraftResponse;
    try {
      response = await workoutDraft.mutateAsync({ text: sentence, locale, today, localDate });
    } catch (error) {
      if (runs.current === run) setStep({ ...TYPING, failure: failureOf(error) });
      return;
    }
    if (runs.current !== run) return;
    if (response.status === 'unreadable') {
      setStep({ ...TYPING, unreadable: response.reason });
      return;
    }
    setStep(TYPING);
    openDraft(response.draft);
  };

  const submit = () => {
    const sentence = text.trim();
    if (sentence.length < WORKOUT_DRAFT_LIMITS.textMin) {
      setTooShort(true);
      return;
    }
    // The answer of the last try no longer applies.
    setStep(TYPING);
    // AC2: an unsaved past session in the draft slot is discarded only after asking.
    guard(() => void prepare(sentence));
  };

  if (step.kind === 'preparing') {
    return (
      <Screen
        testID="workout-describe-preparing"
        footer={
          <Button
            variant="ghost"
            label={d.cancel}
            onPress={() => {
              runs.current++;
              setStep(TYPING);
            }}
            testID="workout-describe-cancel"
          />
        }
      >
        <AppText variant="title" accessibilityRole="header">
          {d.title}
        </AppText>
        <AppText tone="muted">«{text.trim()}»</AppText>
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <AppText accessibilityLiveRegion="polite">{d.preparing}</AppText>
        </View>
      </Screen>
    );
  }

  const { failure, unreadable } = step;
  return (
    <Screen
      testID="workout-describe"
      footer={
        <>
          <Button
            label={d.submit}
            onPress={submit}
            disabled={!online}
            testID="workout-describe-submit"
          />
          <Button variant="ghost" label={d.cancel} onPress={close} />
        </>
      }
    >
      <AppText variant="title" accessibilityRole="header">
        {d.title}
      </AppText>
      {localDate === today ? null : (
        <AppText tone="muted" testID="workout-describe-day">
          {formatWeekdayDay(localDate, locale)}
        </AppText>
      )}
      {notice}
      {failure ? (
        <Notice
          tone={failure === 'error' ? 'danger' : 'warning'}
          message={d[failure]}
          testID={`workout-describe-${failure}`}
        >
          {failure === 'error' ? null : (
            <View style={styles.actions}>
              <Button
                variant="secondary"
                label={t.training.logPast}
                onPress={() =>
                  guard(() => {
                    actions.startManual(localDate, pastSessionStart(localDate, today, new Date()));
                    router.replace({ pathname: '/training/session', params: { slot: 'draft' } });
                  })
                }
                testID="workout-describe-log-past"
              />
              <Button
                variant="secondary"
                label={t.training.logActivity}
                onPress={() =>
                  router.replace({ pathname: '/training/activity', params: { date: localDate } })
                }
                testID="workout-describe-log-activity"
              />
            </View>
          )}
        </Notice>
      ) : null}
      {unreadable ? (
        <Notice
          tone="info"
          message={d.unreadable[unreadable]}
          testID={`workout-describe-${unreadable}`}
        />
      ) : null}
      <WorkoutTextInput
        value={text}
        onChange={(value) => {
          setText(value);
          setTooShort(false);
        }}
        error={tooShort ? d.tooShort : null}
      />
      {online ? null : <Notice tone="info" message={d.offline} testID="workout-describe-offline" />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
