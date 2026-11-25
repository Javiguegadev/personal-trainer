import type { PlannedActivity, PlannedWorkout, Weekday } from '@pt/contracts';
import type { WorkingShift } from '../checkin/checkin';
import { addDays, isoWeekday } from '../dates';
import { dayWorkBlock, type ShiftCheckin } from '../week/day';
import { blockEndsNextDay, typicalDay, type TypicalWeek } from '../week/typical';
import { defaultGymMinutes } from './items';
import { sortPlannedSessions } from './status';

/**
 * Quiet notices of a planned day (spec 013 AC13), on the day screen and in the planning sheet. They
 * never block and only ever suggest less. Same rules and PROVISIONAL thresholds as spec 010 AC5 until
 * the professional review.
 */
export type PlanNotice =
  /** A planned session whose time overlaps the work block (or the check-in's shift) of its day. */
  | { type: 'work_overlap'; plannedId: string; shift: WorkingShift | null }
  /** A strength session or a hard activity planned the day before a match. */
  | { type: 'hard_before_match'; plannedId: string; matchDate: string };

const MINUTES_PER_DAY = 1440;
/** A planned gym session without minutes, and no strength activity to take them from. */
const FALLBACK_MINUTES = 60;

/** The work intervals touching a day, on a timeline where 0 is its midnight. */
function workIntervals(
  week: TypicalWeek,
  checkins: readonly ShiftCheckin[],
  date: string,
): { shift: WorkingShift | null; from: number; to: number }[] {
  const block = (day: string) =>
    dayWorkBlock(week, checkins.find((c) => c.localDate === day) ?? null, day);
  const intervals: { shift: WorkingShift | null; from: number; to: number }[] = [];
  const own = block(date);
  if (own) {
    const to = blockEndsNextDay(own) ? own.endMinute + MINUTES_PER_DAY : own.endMinute;
    intervals.push({ shift: own.shift, from: own.startMinute, to });
  }
  const previous = block(addDays(date, -1));
  if (previous && blockEndsNextDay(previous)) {
    intervals.push({
      shift: previous.shift,
      from: previous.startMinute - MINUTES_PER_DAY,
      to: previous.endMinute,
    });
  }
  return intervals;
}

/**
 * The sessions of a day: the planned ones when it has some (they replace the typical slots, AC2),
 * otherwise the typical week's. Here only whether one is a match matters.
 */
function hasMatch(planned: readonly PlannedWorkout[], week: TypicalWeek, date: string): boolean {
  const ofDay = planned.filter((p) => p.localDate === date);
  if (ofDay.length > 0) return ofDay.some((p) => p.isMatch);
  return typicalDay(week, isoWeekday(date) as Weekday).training.some((slot) => slot.isMatch);
}

/**
 * A planned activity is hard when the profile activity of the same name is (planned rows carry no
 * intensity). A default chip ("Correr") has no profile activity and is not hard.
 */
function isHardActivity(
  planned: Pick<PlannedWorkout, 'kind' | 'name'>,
  activities: readonly PlannedActivity[],
): boolean {
  const name = planned.name?.trim().toLowerCase();
  if (!name) return false;
  return activities.some(
    (a) =>
      a.kind !== 'strength' && a.intensity === 'hard' && a.label?.trim().toLowerCase() === name,
  );
}

export function planNotices(input: {
  date: string;
  /** The plan of the day and the days around it (the sheet passes its draft in). */
  planned: readonly PlannedWorkout[];
  week: TypicalWeek;
  /** The check-ins of the day and the day before, for the shifts (spec 011 AC11). */
  checkins?: readonly ShiftCheckin[];
}): PlanNotice[] {
  const { date, week } = input;
  const sessions = sortPlannedSessions(input.planned.filter((p) => p.localDate === date));
  const notices: PlanNotice[] = [];

  const intervals = workIntervals(week, input.checkins ?? [], date);
  const gymMinutes = defaultGymMinutes(week.plannedActivities) ?? FALLBACK_MINUTES;
  for (const session of sessions) {
    if (session.startMinute === null) continue;
    const start = session.startMinute;
    const end = start + (session.minutes ?? gymMinutes);
    const hit = intervals.find(({ from, to }) => start < to && from < end);
    if (hit) notices.push({ type: 'work_overlap', plannedId: session.id, shift: hit.shift });
  }

  const matchDate = addDays(date, 1);
  if (hasMatch(input.planned, week, matchDate)) {
    for (const session of sessions) {
      if (session.isMatch) continue;
      if (session.kind === 'gym' || isHardActivity(session, week.plannedActivities)) {
        notices.push({ type: 'hard_before_match', plannedId: session.id, matchDate });
      }
    }
  }
  return notices;
}
