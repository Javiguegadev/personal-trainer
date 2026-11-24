import {
  CHECKIN_LIMITS,
  type CheckinUpsertRequest,
  type DailyCheckin,
  type PlannedActivity,
  type WorkPattern,
  type WorkShift,
} from '@pt/contracts';
// Not `checkClientDates` of profile/evaluate: that module reads the context snapshot, which reads
// this one (a require cycle in Metro).
import { addDays, daysBetween, isPlausibleClientDate, isoWeekday } from '../dates';
import { routineDueOn } from '../training/routine';

/**
 * The daily check-in of spec 011: two taps for sleep and stress and, for shift and irregular workers,
 * today's shift. These helpers fill and prefill the form; `readiness.ts` turns the answers into the
 * day's readiness. Every rule here is PROVISIONAL until the professional review (spec 011 Open
 * questions).
 */

export type SleepChipKey = 'under_5' | '5_6' | '6_7' | '7_8' | 'over_8';

/** The five sleep chips and the minutes each stores: the middle of its range (Assumptions). */
export const SLEEP_CHIPS: readonly { key: SleepChipKey; minutes: number }[] = [
  { key: 'under_5', minutes: 270 },
  { key: '5_6', minutes: 330 },
  { key: '6_7', minutes: 390 },
  { key: '7_8', minutes: 450 },
  { key: 'over_8', minutes: 510 },
];

/** Where each chip starts, in minutes. A value on a boundary belongs to the higher chip (AC6). */
const CHIP_STARTS: readonly [SleepChipKey, number][] = [
  ['over_8', 480],
  ['7_8', 420],
  ['6_7', 360],
  ['5_6', 300],
];

/** The chip of any sleep value, also an exact one from a health import later (ADR 007). */
export function sleepChipOf(minutes: number): SleepChipKey {
  return CHIP_STARTS.find(([, start]) => minutes >= start)?.[0] ?? 'under_5';
}

const chipMinutes = (minutes: number) =>
  SLEEP_CHIPS.find((chip) => chip.key === sleepChipOf(minutes))!.minutes;

export type WorkingShift = Exclude<WorkShift, 'off'>;

export interface ShiftHours {
  startMinute: number;
  endMinute: number;
}

/** The order of the shift chips (AC3). */
export const SHIFT_KINDS: readonly WorkShift[] = ['morning', 'afternoon', 'night', 'off'];

/** Default hours of each working shift (AC3, provisional). An end before the start ends the next day. */
export const SHIFT_DEFAULT_HOURS: Readonly<Record<WorkingShift, ShiftHours>> = {
  morning: { startMinute: 360, endMinute: 840 },
  afternoon: { startMinute: 840, endMinute: 1320 },
  night: { startMinute: 1320, endMinute: 360 },
};

/** The hours the user chose last for each shift kind; kept on the device, they only prefill (AC3). */
export type PreferredShiftHours = Partial<Record<WorkingShift, ShiftHours>>;

/** The shift chips are asked only of shift and irregular workers (AC1, AC11). */
export function asksShift(workPattern: WorkPattern | null): boolean {
  return workPattern === 'shifts' || workPattern === 'irregular';
}

/** The answers of the check-in form. */
export type CheckinAnswers = Pick<
  DailyCheckin,
  'sleepMinutes' | 'stress' | 'workShift' | 'shiftStartMinute' | 'shiftEndMinute'
>;

/** A stored check-in as the helpers read it. */
export type CheckinPoint = CheckinAnswers &
  Pick<DailyCheckin, 'localDate'> & {
    /** When present, the newer of two rows of the same day wins (AC15). */
    recordedAt?: string;
  };

/**
 * One check-in per day (AC15): a merged cache may briefly hold two rows of a day (an optimistic write
 * and the server copy). The later `recordedAt` wins; without it, the later row in the list.
 */
export function latestPerDay<C extends { localDate: string; recordedAt?: string }>(
  checkins: readonly C[],
): C[] {
  const byDay = new Map<string, C>();
  for (const checkin of checkins) {
    const kept = byDay.get(checkin.localDate);
    const newer =
      !kept ||
      kept.recordedAt === undefined ||
      checkin.recordedAt === undefined ||
      Date.parse(checkin.recordedAt) >= Date.parse(kept.recordedAt);
    if (newer) byDay.set(checkin.localDate, checkin);
  }
  return [...byDay.values()];
}

/** Usual sleep: the median of the 14 days before today, once there are 5 nights (Assumptions). */
export const USUAL_SLEEP = { days: 14, minNights: 5 } as const;

export function usualSleep(
  checkins: readonly Pick<CheckinPoint, 'localDate' | 'sleepMinutes' | 'recordedAt'>[],
  today: string,
): number | null {
  const nights = latestPerDay(checkins)
    .filter((c) => {
      const age = daysBetween(c.localDate, today);
      return c.sleepMinutes !== null && age >= 1 && age <= USUAL_SLEEP.days;
    })
    .map((c) => c.sleepMinutes!)
    .sort((a, b) => a - b);
  if (nights.length < USUAL_SLEEP.minNights) return null;
  const middle = nights.length / 2;
  return Number.isInteger(middle)
    ? Math.round((nights[middle - 1]! + nights[middle]!) / 2)
    : nights[Math.floor(middle)]!;
}

const NO_SHIFT = { workShift: null, shiftStartMinute: null, shiftEndMinute: null } as const;

/**
 * What the form shows (AC2, AC3): today's own answers when they exist (editing); otherwise the chip
 * of the usual sleep (or of the latest check-in with sleep, or nothing), "Normal" stress, and
 * yesterday's shift with its hours when it was a working one.
 */
export function checkinPrefill(input: {
  checkins: readonly CheckinPoint[];
  today: string;
  asksShift: boolean;
}): CheckinAnswers {
  const { today } = input;
  const checkins = latestPerDay(input.checkins);
  const own = checkins.find((c) => c.localDate === today);
  if (own) {
    return {
      sleepMinutes: own.sleepMinutes,
      stress: own.stress,
      workShift: own.workShift,
      shiftStartMinute: own.shiftStartMinute,
      shiftEndMinute: own.shiftEndMinute,
    };
  }

  const usual = usualSleep(checkins, today);
  const latest = checkins
    .filter((c) => c.sleepMinutes !== null && daysBetween(c.localDate, today) > 0)
    .sort((a, b) => b.localDate.localeCompare(a.localDate))[0];
  const sleep = usual ?? latest?.sleepMinutes ?? null;

  const yesterday = checkins.find((c) => c.localDate === addDays(today, -1));
  const shift =
    input.asksShift &&
    yesterday &&
    yesterday.workShift !== null &&
    yesterday.workShift !== 'off' &&
    yesterday.shiftStartMinute !== null &&
    yesterday.shiftEndMinute !== null
      ? {
          workShift: yesterday.workShift,
          shiftStartMinute: yesterday.shiftStartMinute,
          shiftEndMinute: yesterday.shiftEndMinute,
        }
      : NO_SHIFT;

  return {
    sleepMinutes: sleep === null ? null : chipMinutes(sleep),
    stress: 'normal',
    ...shift,
  };
}

/**
 * A tap on a shift chip (AC3): a working shift takes the hours last chosen for its kind, or the
 * defaults; "Libre" has no hours; tapping the selected chip again clears the answer.
 */
export function selectShift(
  answers: CheckinAnswers,
  kind: WorkShift,
  preferred: PreferredShiftHours,
): CheckinAnswers {
  if (answers.workShift === kind) return { ...answers, ...NO_SHIFT };
  if (kind === 'off') return { ...answers, ...NO_SHIFT, workShift: 'off' };
  const hours = preferred[kind] ?? SHIFT_DEFAULT_HOURS[kind];
  return {
    ...answers,
    workShift: kind,
    shiftStartMinute: hours.startMinute,
    shiftEndMinute: hours.endMinute,
  };
}

/** "Cambiar hora" (AC3). A shift never starts and ends at the same minute. */
export function setShiftHours(answers: CheckinAnswers, hours: ShiftHours): CheckinAnswers {
  if (answers.workShift === null || answers.workShift === 'off') return answers;
  if (hours.startMinute === hours.endMinute) return answers;
  return { ...answers, shiftStartMinute: hours.startMinute, shiftEndMinute: hours.endMinute };
}

export function checkinToRequest(
  answers: CheckinAnswers,
  placement: { recordedAt: string; today: string },
): CheckinUpsertRequest {
  return { ...answers, recordedAt: placement.recordedAt, today: placement.today };
}

/**
 * Whether the weekday has training planned: a routine session is due (spec 010 AC17) or an activity
 * has that weekday.
 */
export function trainingPlannedOn(
  activities: readonly Pick<PlannedActivity, 'kind' | 'days'>[],
  weekday: number,
): boolean {
  return (
    routineDueOn(activities, weekday) ||
    activities.some((a) => a.days.some((d) => d.weekday === weekday))
  );
}

/**
 * Whether Today shows the check-in card (AC1): only when it can change something today (ADR 003),
 * that is training planned or a shift to tell, and only until it is saved or "Hoy no" is tapped.
 */
export function checkinDue(input: {
  today: string;
  activities: readonly Pick<PlannedActivity, 'kind' | 'days'>[];
  workPattern: WorkPattern | null;
  hasCheckin: boolean;
  /** The day "Hoy no" was last tapped (device storage). */
  skippedOn: string | null;
}): boolean {
  if (input.hasCheckin || input.skippedOn === input.today) return false;
  return (
    asksShift(input.workPattern) || trainingPlannedOn(input.activities, isoWeekday(input.today))
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Request-level checks of a check-in write that need the server clock (AC15): the client's day must be
 * plausible, the check-in's day neither in the future nor more than a year back, and the device clock
 * not more than a day ahead (it would win every later conflict). Returns the field errors, or null.
 */
export function checkCheckinWrite(
  write: { localDate: string; today: string; recordedAt: string },
  now: Date,
): Record<string, string> | null {
  if (!isPlausibleClientDate(write.today, now.toISOString())) return { today: 'implausible' };
  if (write.localDate > write.today) return { localDate: 'in_future' };
  if (daysBetween(write.localDate, write.today) > CHECKIN_LIMITS.historyDays) {
    return { localDate: 'too_old' };
  }
  if (Date.parse(write.recordedAt) > now.getTime() + DAY_MS) return { recordedAt: 'in_future' };
  return null;
}
