import type { PlannedWorkout } from '@pt/contracts';
import { formatMinuteOfDay } from '@pt/core';
import { useRouter } from 'expo-router';
import { useProgram, useWorkouts } from '@/lib/api';
import { localDateTime, pastSessionStart } from '@/lib/trainingTime';
import { useToday } from './useToday';
import { useTrainingActions } from './useTraining';

/**
 * "Empezar", "Hecho" and "Registrar" on a planned session (spec 013 AC15–AC17): a gym session starts
 * live today, or opens the past-session screen on an earlier day, prefilled from its routine session or
 * the workout it repeats; an activity opens the activity sheet with its values. The saved workout keeps
 * the link to the plan.
 */
export function usePlannedStart() {
  const router = useRouter();
  const today = useToday();
  const actions = useTrainingActions();
  const program = useProgram();
  const log = useWorkouts(today);

  return (planned: PlannedWorkout) => {
    if (planned.kind !== 'gym') {
      router.push({ pathname: '/training/activity', params: { plan: planned.id } });
      return;
    }
    const start =
      planned.localDate < today
        ? {
            mode: 'manual' as const,
            localDate: planned.localDate,
            startedAt:
              (planned.startMinute !== null
                ? localDateTime(planned.localDate, formatMinuteOfDay(planned.startMinute, 'es'))
                : null) ?? pastSessionStart(planned.localDate, today, new Date()),
          }
        : { mode: 'live' as const };
    const slot = actions.startPlanned(planned, start, program.data ?? null, log.data ?? []);
    router.push({ pathname: '/training/session', params: { slot } });
  };
}
