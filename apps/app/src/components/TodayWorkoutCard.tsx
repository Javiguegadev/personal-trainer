import type { Profile } from '@pt/contracts';
import { formatList, workoutRecordCount, workoutsOfDay } from '@pt/core';
import { useRouter } from 'expo-router';
import { useI18n } from '@/hooks/useI18n';
import { useToday } from '@/hooks/useToday';
import { useExerciseLookups } from '@/hooks/useTraining';
import { useWorkoutText } from '@/hooks/useWorkoutText';
import { useWorkouts } from '@/lib/api';
import { useSession } from '@/lib/liveSession';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { RoutineCard } from './RoutineCard';
import { SessionInProgress } from './SessionInProgress';

/**
 * The training block of Today (spec 009 AC21): the session in progress with "Continuar", or what was
 * done today ("Hoy: Pierna · 55 min · 1 récord"), and "Registrar entreno", which opens the Training
 * tab's choice (start a session or log an activity). On a gym day, the routine's next session (spec 010
 * AC17).
 */
export function TodayWorkoutCard({ profile }: { profile: Profile }) {
  const { t, format, locale } = useI18n();
  const router = useRouter();
  const today = useToday();
  const log = useWorkouts(today);
  const live = useSession('live');
  const { statsList } = useExerciseLookups();
  const text = useWorkoutText();
  const done = workoutsOfDay(log.data ?? [], today);
  const records = done.reduce(
    (sum, w) => sum + workoutRecordCount(w, log.data ?? [], statsList, profile.safetyFlags),
    0,
  );
  const minutes = done.reduce((sum, w) => sum + w.minutes, 0);

  return (
    <Card title={t.today.workoutTitle} testID="today-workout">
      {live ? <SessionInProgress session={live} label={t.today.workoutInProgress} /> : null}
      {done.length ? (
        <AppText testID="today-training-done">
          {format(t.today.trainingDone, {
            summary: [
              formatList(done.map(text.label), locale),
              text.minutes(minutes),
              records ? `🏆 ${text.records(records)}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
          })}
        </AppText>
      ) : null}
      <RoutineCard profile={profile} compact />
      {live ? null : (
        <Button
          variant="secondary"
          label={t.today.logWorkout}
          onPress={() => router.push('/training')}
          testID="log-workout"
        />
      )}
    </Card>
  );
}
