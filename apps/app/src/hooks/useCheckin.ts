import type { DailyCheckin, Profile, Readiness, Weekday } from '@pt/contracts';
import {
  checkinToRequest,
  dayReadiness,
  isoWeekday,
  latestPerDay,
  nextProgramSession,
  readinessPlanSession,
  routineDueOn,
  typicalDay,
  usualSleep,
  type CheckinAnswers,
  type ReadinessPlan,
} from '@pt/core';
import { useMemo } from 'react';
import { useCheckins, useDeleteCheckin, useProgram, useSaveCheckin, useWorkouts } from '@/lib/api';
import { rememberShiftHours } from '@/lib/checkinPrefs';
import { profileActivities } from '@/lib/week';
import { useToday } from './useToday';

/**
 * The cached check-ins (spec 011), one per day, oldest first. Every screen reads this one list, so it
 * works offline and an optimistic write shows everywhere at once (AC14).
 */
export function useCheckinList() {
  const today = useToday();
  const query = useCheckins(today);
  const checkins = useMemo(() => latestPerDay(query.data ?? []), [query.data]);
  // Known: loaded, or there is nothing to wait for (offline with no copy, or an error).
  const settled = query.data !== undefined || query.fetchStatus !== 'fetching';
  return { query, checkins, today, settled };
}

/** Today's check-in and readiness, computed on the device from the cached list (AC6). */
export function useTodayReadiness(): {
  checkin: DailyCheckin | null;
  readiness: Readiness;
  checkins: DailyCheckin[];
  today: string;
  settled: boolean;
} {
  const { checkins, today, settled } = useCheckinList();
  return useMemo(() => {
    const checkin = checkins.find((c) => c.localDate === today) ?? null;
    const readiness = dayReadiness(checkin, usualSleep(checkins, today));
    return { checkin, readiness, checkins, today, settled };
  }, [checkins, today, settled]);
}

/**
 * Today's plan as the readiness line reads it (AC9): the routine session due today (the one "Empezar"
 * would start, spec 010 AC17) and the activities of today's weekday.
 */
export function useTodayPlan(profile: Profile): ReadinessPlan {
  const today = useToday();
  const program = useProgram();
  const log = useWorkouts(today);
  const activities = profileActivities(profile);
  const weekday = isoWeekday(today) as Weekday;
  const routine = program.data;
  const next =
    routine && routineDueOn(activities, weekday)
      ? nextProgramSession(routine, log.data ?? [])
      : null;
  const slots = typicalDay({ workBlocks: [], plannedActivities: activities }, weekday).training;
  const planned = slots.map((slot) => ({ isMatch: slot.isMatch }));
  // A gym activity without days may fall on any day (spec 010 AC17): without a routine it still counts
  // as today's training, as it does for the card (AC1).
  const undatedGym = activities.some((a) => a.kind === 'strength' && a.days.length === 0);
  if (!next && undatedGym && !slots.some((slot) => slot.kind === 'strength')) {
    planned.push({ isMatch: false });
  }
  return { session: next ? readinessPlanSession(next) : null, activities: planned };
}

/** Saving and deleting a check-in: optimistic, queued offline in its own scope (AC14). */
export function useCheckinActions() {
  const today = useToday();
  const save = useSaveCheckin();
  const remove = useDeleteCheckin();
  const now = () => new Date().toISOString();
  return {
    save(localDate: string, answers: CheckinAnswers) {
      const { workShift, shiftStartMinute, shiftEndMinute } = answers;
      if (
        workShift !== null &&
        workShift !== 'off' &&
        shiftStartMinute !== null &&
        shiftEndMinute !== null
      ) {
        // The hours chosen for a shift kind prefill it next time (AC3).
        rememberShiftHours(workShift, { startMinute: shiftStartMinute, endMinute: shiftEndMinute });
      }
      save.mutate({ localDate, ...checkinToRequest(answers, { recordedAt: now(), today }) });
    },
    remove(localDate: string) {
      remove.mutate({ localDate, recordedAt: now(), today });
    },
  };
}
