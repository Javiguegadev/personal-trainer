import type {
  ActivityDay,
  ActivityKind,
  Intensity,
  PlannedActivity,
  WeekRequest,
  Weekday,
  WorkBlock,
  WorkPattern,
} from '@pt/contracts';

/**
 * The typical week of spec 010 ("Mi semana"): work blocks per weekday and the weekdays of each planned
 * activity. Times are minutes after midnight; weekdays are ISO (Monday = 1). Pure helpers for the
 * screen (AC2, AC3), its notices (AC5) and the week view (AC8).
 */

const MINUTES_PER_DAY = 1440;

export interface TypicalWeek {
  workBlocks: readonly WorkBlock[];
  plannedActivities: readonly PlannedActivity[];
}

/** An activity planned on one weekday. */
export interface PlannedSlot {
  /** Index of the activity in `plannedActivities`. */
  activityIndex: number;
  kind: ActivityKind;
  label: string | null;
  intensity: Intensity;
  minutes: number;
  startMinute: number | null;
  isMatch: boolean;
}

export interface TypicalDay {
  weekday: Weekday;
  /** The work block that starts on this weekday. */
  work: WorkBlock | null;
  /** By start time; activities without a time last. */
  training: PlannedSlot[];
}

/** A work block whose end is earlier than its start ends the next day (AC3). */
export function blockEndsNextDay(block: Pick<WorkBlock, 'startMinute' | 'endMinute'>): boolean {
  return block.endMinute < block.startMinute;
}

export function isValidWorkBlock(block: Pick<WorkBlock, 'startMinute' | 'endMinute'>): boolean {
  return block.startMinute !== block.endMinute;
}

const previousWeekday = (weekday: number): Weekday => (weekday === 1 ? 7 : weekday - 1);

function slotsOf(activities: readonly PlannedActivity[], weekday: number): PlannedSlot[] {
  const slots: PlannedSlot[] = [];
  activities.forEach((activity, activityIndex) => {
    const day = activity.days.find((d) => d.weekday === weekday);
    if (!day) return;
    slots.push({
      activityIndex,
      kind: activity.kind,
      label: activity.label,
      intensity: activity.intensity,
      minutes: activity.minutesPerSession,
      startMinute: day.startMinute,
      isMatch: day.isMatch,
    });
  });
  return slots.sort(
    (a, b) =>
      (a.startMinute ?? MINUTES_PER_DAY) - (b.startMinute ?? MINUTES_PER_DAY) ||
      a.activityIndex - b.activityIndex,
  );
}

/** What the typical week plans on one weekday (AC8). Activities without days appear on no day. */
export function typicalDay(week: TypicalWeek, weekday: Weekday): TypicalDay {
  return {
    weekday,
    work: week.workBlocks.find((b) => b.weekday === weekday) ?? null,
    training: slotsOf(week.plannedActivities, weekday),
  };
}

// ── Editing an activity's days (AC2) ─────────────────────────────────────────────────────────────

/**
 * The activity with these days: sorted, `isMatch` only for a sport, and `sessionsPerWeek` equal to
 * their count. With no days it keeps its last count (the "N veces por semana" stepper returns).
 */
export function applyDaysToActivity(
  activity: PlannedActivity,
  days: readonly ActivityDay[],
): PlannedActivity {
  const sorted = [...days]
    .sort((a, b) => a.weekday - b.weekday)
    .map((day) => ({ ...day, isMatch: activity.kind === 'sport' && day.isMatch }));
  return {
    ...activity,
    days: sorted,
    sessionsPerWeek: sorted.length > 0 ? sorted.length : activity.sessionsPerWeek,
  };
}

/** The start time shared by the activity's training days (match days have their own). */
export function activityStartMinute(activity: PlannedActivity): number | null {
  return activity.days.find((d) => !d.isMatch)?.startMinute ?? null;
}

/** Adds the weekday (with the shared start time) or removes it. */
export function toggleActivityDay(activity: PlannedActivity, weekday: Weekday): PlannedActivity {
  const has = activity.days.some((d) => d.weekday === weekday);
  const days = has
    ? activity.days.filter((d) => d.weekday !== weekday)
    : [...activity.days, { weekday, startMinute: activityStartMinute(activity), isMatch: false }];
  return applyDaysToActivity(activity, days);
}

/** One start time for every training day of the activity (AC2); match days keep theirs. */
export function setActivityStartMinute(
  activity: PlannedActivity,
  startMinute: number | null,
): PlannedActivity {
  return applyDaysToActivity(
    activity,
    activity.days.map((d) => (d.isMatch ? d : { ...d, startMinute })),
  );
}

/** Marks a day of a sport as a match with its own start time, or back to a training day. */
export function setMatchDay(
  activity: PlannedActivity,
  weekday: Weekday,
  match: { isMatch: boolean; startMinute: number | null },
): PlannedActivity {
  const shared = activityStartMinute(activity);
  return applyDaysToActivity(
    activity,
    activity.days.map((d) =>
      d.weekday !== weekday
        ? d
        : match.isMatch
          ? { ...d, isMatch: true, startMinute: match.startMinute }
          : { ...d, isMatch: false, startMinute: shared },
    ),
  );
}

// ── Editing the work blocks (AC3) ────────────────────────────────────────────────────────────────

const sortBlocks = (blocks: WorkBlock[]) => blocks.sort((a, b) => a.weekday - b.weekday);

/** Adds the weekday with the given hours, or removes it. */
export function toggleWorkDay(
  blocks: readonly WorkBlock[],
  weekday: Weekday,
  hours: Pick<WorkBlock, 'startMinute' | 'endMinute'>,
): WorkBlock[] {
  if (blocks.some((b) => b.weekday === weekday)) return blocks.filter((b) => b.weekday !== weekday);
  return sortBlocks([...blocks, { weekday, ...hours }]);
}

/** Changes the hours of one day alone. */
export function setWorkHours(
  blocks: readonly WorkBlock[],
  weekday: Weekday,
  hours: Pick<WorkBlock, 'startMinute' | 'endMinute'>,
): WorkBlock[] {
  return blocks.map((b) => (b.weekday === weekday ? { ...b, ...hours } : b));
}

/** "Copiar a todos": the hours of one day on every other selected day. */
export function copyWorkHours(blocks: readonly WorkBlock[], fromWeekday: Weekday): WorkBlock[] {
  const from = blocks.find((b) => b.weekday === fromWeekday);
  if (!from) return [...blocks];
  return blocks.map((b) => ({ ...b, startMinute: from.startMinute, endMinute: from.endMinute }));
}

/**
 * The `PUT /me/week` body (AC4). Only fixed hours keep work blocks (AC3): with shifts, irregular hours
 * or no schedule they are hidden on screen and not stored.
 */
export function weekToRequest(input: {
  workPattern: WorkPattern;
  workBlocks: readonly WorkBlock[];
  dayStartMinute: number;
  plannedActivities: readonly PlannedActivity[];
  today: string;
}): WeekRequest {
  return {
    workPattern: input.workPattern,
    workBlocks: input.workPattern === 'fixed' ? [...input.workBlocks] : [],
    dayStartMinute: input.dayStartMinute,
    plannedActivities: input.plannedActivities.map((a) => applyDaysToActivity(a, a.days)),
    today: input.today,
  };
}

/**
 * Whether two activity lists give the same weekly energy (AC4): same kinds, counts, minutes and
 * intensities in the same order. Days, times and names do not change the targets.
 */
export function sameTrainingLoad(
  before: readonly PlannedActivity[],
  after: readonly PlannedActivity[],
): boolean {
  return (
    before.length === after.length &&
    before.every((a, i) => {
      const b = after[i]!;
      return (
        a.kind === b.kind &&
        a.sessionsPerWeek === b.sessionsPerWeek &&
        a.minutesPerSession === b.minutesPerSession &&
        a.intensity === b.intensity
      );
    })
  );
}

// ── Notices (AC5) ────────────────────────────────────────────────────────────────────────────────

/**
 * Quiet notes under "Mi semana" (AC5). They never block the save and never suggest training more.
 * The rules are PROVISIONAL until the professional review (spec 010 Open questions).
 */
export type WeekNotice =
  /** A session that overlaps the work hours of its day. */
  | { type: 'work_overlap'; weekday: Weekday; activityIndex: number }
  /** A strength or hard session the day before a match. */
  | { type: 'hard_before_match'; weekday: Weekday; activityIndex: number; matchWeekday: Weekday }
  /** Every weekday has training. */
  | { type: 'no_rest_day' };

/** The work intervals that touch a weekday, on a timeline where 0 is its midnight. */
function workIntervals(blocks: readonly WorkBlock[], weekday: number): [number, number][] {
  const intervals: [number, number][] = [];
  const own = blocks.find((b) => b.weekday === weekday);
  if (own) {
    const end = blockEndsNextDay(own) ? own.endMinute + MINUTES_PER_DAY : own.endMinute;
    intervals.push([own.startMinute, end]);
  }
  const previous = blocks.find((b) => b.weekday === previousWeekday(weekday));
  if (previous && blockEndsNextDay(previous)) {
    intervals.push([previous.startMinute - MINUTES_PER_DAY, previous.endMinute]);
  }
  return intervals;
}

export function weekNotices(week: TypicalWeek): WeekNotice[] {
  const notices: WeekNotice[] = [];
  const days = ([1, 2, 3, 4, 5, 6, 7] as const).map((weekday) => typicalDay(week, weekday));

  for (const day of days) {
    const intervals = workIntervals(week.workBlocks, day.weekday);
    for (const slot of day.training) {
      if (slot.startMinute === null) continue;
      const start = slot.startMinute;
      const end = start + slot.minutes;
      if (intervals.some(([from, to]) => start < to && from < end)) {
        notices.push({
          type: 'work_overlap',
          weekday: day.weekday,
          activityIndex: slot.activityIndex,
        });
      }
    }
  }

  for (const day of days) {
    if (!day.training.some((slot) => slot.isMatch)) continue;
    const before = days[previousWeekday(day.weekday) - 1]!;
    for (const slot of before.training) {
      if (slot.isMatch) continue;
      if (slot.kind === 'strength' || slot.intensity === 'hard') {
        notices.push({
          type: 'hard_before_match',
          weekday: before.weekday,
          activityIndex: slot.activityIndex,
          matchWeekday: day.weekday,
        });
      }
    }
  }

  if (days.every((day) => day.training.length > 0)) notices.push({ type: 'no_rest_day' });
  return notices;
}
