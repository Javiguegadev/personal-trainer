import type { PlannedWorkout, Profile, ProgramSession } from '@pt/contracts';
import {
  isoWeekday,
  nextProgramSession,
  programToDraft,
  routineDays,
  routineDueOn,
  todayPlannedSessions,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { usePlannedStart } from '@/hooks/usePlannedStart';
import { useToday } from '@/hooks/useToday';
import { useTrainingActions } from '@/hooks/useTraining';
import {
  usePendingPlanIds,
  usePendingTrainingIds,
  usePlan,
  useProgram,
  useWorkouts,
} from '@/lib/api';
import { useSession } from '@/lib/liveSession';
import { setRoutineDraft } from '@/lib/routineDraft';
import { setTodayView } from '@/lib/todayView';
import { profileActivities } from '@/lib/week';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { PlannedSessionRow } from './PlannedSessionRow';
import { SyncBadge } from './SyncBadge';

/**
 * The starter routine on the Training tab (spec 010 AC13, AC17): "Crea tu rutina", or the next session
 * of the rotation with "Empezar", the other sessions and "Mi rutina". On Today (`compact`) only the
 * next session, and only on a gym day of the typical week (or for a gym activity without days). A
 * planned session for today that is not done shows instead of "Siguiente: …", one line each, with
 * "Empezar" or "Hecho" (spec 013 AC14); "Planificar mi semana" opens the week view.
 */
export function RoutineCard({ profile, compact = false }: { profile: Profile; compact?: boolean }) {
  const { t, format } = useI18n();
  const router = useRouter();
  const today = useToday();
  const program = useProgram();
  const log = useWorkouts(today);
  const plan = usePlan(today);
  const live = useSession('live');
  const pendingIds = usePendingTrainingIds();
  const pendingPlanIds = usePendingPlanIds();
  const actions = useTrainingActions();
  const startPlanned = usePlannedStart();
  const [showAll, setShowAll] = useState(false);
  const r = t.routine;
  const activities = profileActivities(profile);
  const todays = todayPlannedSessions(plan.data?.workouts ?? [], log.data ?? [], today);

  const start = (session: ProgramSession) => {
    actions.startProgram(session);
    router.push({ pathname: '/training/session', params: { slot: 'live' } });
  };
  const plannedRows = (testID: string) => (
    <View style={styles.group} testID={testID}>
      {todays.map((planned: PlannedWorkout) => (
        <PlannedSessionRow
          key={planned.id}
          planned={planned}
          prefix={t.plan.today}
          // A gym session waits for the one in progress; an activity can be logged any time.
          action={planned.kind === 'gym' ? (live ? null : 'start') : 'done'}
          pending={pendingPlanIds.includes(planned.id)}
          onAction={() => startPlanned(planned)}
        />
      ))}
    </View>
  );
  const planWeek = (
    <Button
      variant="ghost"
      label={`${t.plan.planWeek} ›`}
      onPress={() => {
        setTodayView('week');
        router.navigate('/');
      }}
      testID="routine-plan-week"
    />
  );

  const routine = program.data;
  if (compact) {
    if (live) return null;
    if (todays.length > 0) return plannedRows('today-planned');
    if (!routine || !routineDueOn(activities, isoWeekday(today))) return null;
    const next = nextProgramSession(routine, log.data ?? []);
    if (!next) return null;
    return (
      <View style={styles.row} testID="today-routine">
        <AppText weight="bold" style={styles.flex}>
          {format(r.next, { session: next.name })}
        </AppText>
        <Button
          label={r.start}
          accessibilityLabel={format(r.startA11y, { session: next.name })}
          onPress={() => start(next)}
          testID="today-routine-start"
        />
      </View>
    );
  }

  // Loading or not cached yet: nothing rather than a card that changes a moment later.
  if (program.isPending) return null;

  if (!routine) {
    const empty = !routineDays(activities) ? (
      <Card title={r.cardTitle} testID="routine-needs-gym">
        <AppText tone="muted">{r.needsGym}</AppText>
        <Button
          variant="secondary"
          label={r.needsGymLink}
          onPress={() => router.push('/settings/week')}
          testID="routine-needs-gym-link"
        />
      </Card>
    ) : (
      <Card title={r.createTitle} testID="routine-create-card">
        <AppText tone="muted">{r.createText}</AppText>
        <Button
          variant="secondary"
          label={r.create}
          onPress={() => router.push('/training/routine/new')}
          testID="routine-create"
        />
      </Card>
    );
    return (
      <>
        {todays.length > 0 ? (
          <Card title={t.today.workoutTitle} testID="training-planned-card">
            {plannedRows('training-planned')}
            {planWeek}
          </Card>
        ) : null}
        {empty}
      </>
    );
  }

  const next = nextProgramSession(routine, log.data ?? []);
  return (
    <Card
      title={routine.name}
      aside={pendingIds.includes(routine.id) ? <SyncBadge /> : undefined}
      testID="routine-card"
    >
      {todays.length > 0 ? (
        plannedRows('training-planned')
      ) : next ? (
        <View style={styles.row}>
          <AppText weight="bold" style={styles.flex} testID="routine-next">
            {format(r.next, { session: next.name })}
          </AppText>
          {live ? null : (
            <Button
              label={r.start}
              accessibilityLabel={format(r.startA11y, { session: next.name })}
              onPress={() => start(next)}
              testID="routine-start"
            />
          )}
        </View>
      ) : null}
      {live ? (
        <AppText variant="caption" tone="muted">
          {r.busy}
        </AppText>
      ) : routine.sessions.length > 1 || todays.length > 0 ? (
        <Button
          variant="ghost"
          label={showAll ? r.hideOther : r.chooseOther}
          onPress={() => setShowAll((v) => !v)}
          testID="routine-choose"
        />
      ) : null}
      {showAll && !live
        ? routine.sessions.map((session, index) => (
            <View key={session.id} style={styles.row}>
              <AppText style={styles.flex}>{session.name}</AppText>
              <Button
                variant="secondary"
                label={r.start}
                accessibilityLabel={format(r.startA11y, { session: session.name })}
                onPress={() => start(session)}
                testID={`routine-session-${index}`}
              />
            </View>
          ))
        : null}
      <Button
        variant="ghost"
        label={`${r.mine} ›`}
        onPress={() => {
          setRoutineDraft(programToDraft(routine));
          router.push('/training/routine');
        }}
        testID="routine-open"
      />
      {planWeek}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  group: { gap: tokens.space.xs },
  flex: { flex: 1 },
});
