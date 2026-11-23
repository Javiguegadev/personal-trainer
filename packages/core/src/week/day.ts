import type { DailyCheckin, PlannedActivity, Weekday, WorkBlock } from '@pt/contracts';
import type { WorkingShift } from '../checkin/checkin';
import { addDays, isoWeekday } from '../dates';
import { blockEndsNextDay, typicalDay, type TypicalWeek } from './typical';

/**
 * One day of the user's real week (spec 011 AC11, AC12): the typical week of spec 010 plus the shift
 * told in that day's check-in. A shift crossing midnight is stored on the day it starts.
 */

const MINUTES_PER_DAY = 1440;

/** The shift fields of a check-in. */
export type ShiftCheckin = Pick<
  DailyCheckin,
  'localDate' | 'workShift' | 'shiftStartMinute' | 'shiftEndMinute'
>;

/** A work block of a day; `shift` is set when it comes from the check-in instead of the typical week. */
export interface DayWork extends WorkBlock {
  shift: WorkingShift | null;
}

/** The working shift of a check-in with its hours, or null (`off`, no answer). */
function workingShift(
  checkin: ShiftCheckin | null | undefined,
): { shift: WorkingShift; startMinute: number; endMinute: number } | null {
  if (!checkin || checkin.workShift === null || checkin.workShift === 'off') return null;
  if (checkin.shiftStartMinute === null || checkin.shiftEndMinute === null) return null;
  return {
    shift: checkin.workShift,
    startMinute: checkin.shiftStartMinute,
    endMinute: checkin.shiftEndMinute,
  };
}

/**
 * The work block of a day (AC11): the typical week's block when there is one (a fixed schedule is
 * shown as in spec 010), otherwise the working shift of that day's check-in.
 */
export function dayWorkBlock(
  week: Pick<TypicalWeek, 'workBlocks'>,
  checkin: ShiftCheckin | null,
  date: string,
): DayWork | null {
  const weekday = isoWeekday(date) as Weekday;
  const typical = week.workBlocks.find((b) => b.weekday === weekday);
  if (typical) return { ...typical, shift: null };
  const shift = checkin?.localDate === date ? workingShift(checkin) : null;
  return shift ? { weekday, ...shift } : null;
}

/**
 * A quiet notice of the day (AC12), never blocking: a planned training of the day overlaps the shift
 * (same wording family as the work overlap of spec 010 AC5).
 */
export type DayNotice = {
  type: 'shift_overlap';
  activityIndex: number;
  startMinute: number;
  shift: WorkingShift;
};

export function dayNotices(input: {
  date: string;
  plannedActivities: readonly PlannedActivity[];
  /** The check-ins of the day and the day before (a night shift reaches into the next morning). */
  checkins: readonly ShiftCheckin[];
}): DayNotice[] {
  const { date } = input;
  // The shifts touching the day, on a timeline where 0 is its midnight.
  const intervals: { shift: WorkingShift; from: number; to: number }[] = [];
  const today = workingShift(input.checkins.find((c) => c.localDate === date));
  if (today) {
    const end = blockEndsNextDay(today) ? today.endMinute + MINUTES_PER_DAY : today.endMinute;
    intervals.push({ shift: today.shift, from: today.startMinute, to: end });
  }
  const yesterday = workingShift(input.checkins.find((c) => c.localDate === addDays(date, -1)));
  if (yesterday && blockEndsNextDay(yesterday)) {
    intervals.push({
      shift: yesterday.shift,
      from: yesterday.startMinute - MINUTES_PER_DAY,
      to: yesterday.endMinute,
    });
  }
  if (intervals.length === 0) return [];

  const day = typicalDay(
    { workBlocks: [], plannedActivities: input.plannedActivities },
    isoWeekday(date) as Weekday,
  );
  const notices: DayNotice[] = [];
  for (const slot of day.training) {
    if (slot.startMinute === null) continue;
    const start = slot.startMinute;
    const end = start + slot.minutes;
    const hit = intervals.find(({ from, to }) => start < to && from < end);
    if (hit) {
      notices.push({
        type: 'shift_overlap',
        activityIndex: slot.activityIndex,
        startMinute: start,
        shift: hit.shift,
      });
    }
  }
  return notices;
}
