import type { Profile, ProgramSession } from '@pt/contracts';
import {
  isoWeekday,
  nextProgramSession,
  programToDraft,
  routineDays,
  routineDueOn,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useToday } from '@/hooks/useToday';
import { useTrainingActions } from '@/hooks/useTraining';
import { usePendingTrainingIds, useProgram, useWorkouts } from '@/lib/api';
import { useSession } from '@/lib/liveSession';
import { setRoutineDraft } from '@/lib/routineDraft';
import { profileActivities } from '@/lib/week';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { SyncBadge } from './SyncBadge';

/**
 * The starter routine on the Training tab (spec 010 AC13, AC17): "Crea tu rutina", or the next session
 * of the rotation with "Empezar", the other sessions and "Mi rutina". On Today (`compact`) only the
 * next session, and only on a gym day of the typical week (or for a gym activity without days).
 */
export function RoutineCard({ profile, compact = false }: { profile: Profile; compact?: boolean }) {
  const { t, format } = useI18n();
  const router = useRouter();
  const today = useToday();
  const program = useProgram();
  const log = useWorkouts(today);
  const live = useSession('live');
  const pendingIds = usePendingTrainingIds();
  const actions = useTrainingActions();
  const [showAll, setShowAll] = useState(false);
  const r = t.routine;
  const activities = profileActivities(profile);

  const start = (session: ProgramSession) => {
    actions.startProgram(session);
    router.push({ pathname: '/training/session', params: { slot: 'live' } });
  };

  const routine = program.data;
  if (compact) {
    if (!routine || live || !routineDueOn(activities, isoWeekday(today))) return null;
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
    if (!routineDays(activities)) {
      return (
        <Card title={r.cardTitle} testID="routine-needs-gym">
          <AppText tone="muted">{r.needsGym}</AppText>
          <Button
            variant="secondary"
            label={r.needsGymLink}
            onPress={() => router.push('/settings/week')}
            testID="routine-needs-gym-link"
          />
        </Card>
      );
    }
    return (
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
  }

  const next = nextProgramSession(routine, log.data ?? []);
  return (
    <Card
      title={routine.name}
      aside={pendingIds.includes(routine.id) ? <SyncBadge /> : undefined}
      testID="routine-card"
    >
      {next ? (
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
      ) : routine.sessions.length > 1 ? (
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
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  flex: { flex: 1 },
});
