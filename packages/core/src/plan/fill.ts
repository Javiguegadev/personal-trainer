import {
  PLAN_LIMITS,
  type PlannedActivity,
  type PlannedWorkout,
  type Program,
  type Weekday,
  type Workout,
} from '@pt/contracts';
import { isoWeekday, weekDays, weekStartOf } from '../dates';
import { nextProgramSession } from '../training/program';
import type { PlanChanges } from './changes';
import { canPlan } from './horizon';
import { isStaleRoutineLink, sortPlannedSessions } from './status';

/**
 * "Planificar con mi rutina" (spec 013 AC11): the next sessions of the rotation on the gym days of the
 * typical week, in one tap. It uses only the declared gym days and never adds a day (Safety); a day that
 * already has a planned gym session keeps it. The plan never moves the rotation (Assumptions).
 */

const MINUTES_PER_DAY = 1440;

export interface FillWeekInput {
  /** The Monday of the week to fill: the current week or a later one in the horizon. */
  weekStart: string;
  today: string;
  program: Pick<Program, 'sessions'> | null;
  /** The profile's activities: the strength ones give the gym days, times and minutes. */
  activities: readonly PlannedActivity[];
  /** The workouts the rotation reads (spec 010 AC19). */
  workouts: readonly Pick<Workout, 'programSessionId' | 'localDate' | 'startedAt'>[];
  /** The plan from today to the end of the week. */
  planned: readonly PlannedWorkout[];
  newId: () => string;
  recordedAt: string;
}

export type FillWeekResult =
  /** "Crea tu rutina". */
  | { type: 'no_routine' }
  /** "Indica tus días de gimnasio en Mi semana". */
  | { type: 'no_gym_days' }
  /** The preview (`placed`, by day) and the change; the undo removes what it placed. */
  | { type: 'ok'; placed: PlannedWorkout[]; changes: PlanChanges; undo: PlanChanges };

/** The gym days of the typical week, with the start time and minutes of their strength activity. */
function gymDays(
  activities: readonly PlannedActivity[],
): Map<Weekday, { startMinute: number | null; minutes: number }> {
  const days = new Map<Weekday, { startMinute: number | null; minutes: number }>();
  for (const activity of activities) {
    if (activity.kind !== 'strength') continue;
    for (const day of activity.days) {
      if (!days.has(day.weekday)) {
        days.set(day.weekday, {
          startMinute: day.startMinute,
          minutes: activity.minutesPerSession,
        });
      }
    }
  }
  return days;
}

export function fillWeekWithRoutine(input: FillWeekInput): FillWeekResult {
  const { program, today, recordedAt } = input;
  if (!program || program.sessions.length === 0) return { type: 'no_routine' };
  const gym = gymDays(input.activities);
  if (gym.size === 0) return { type: 'no_gym_days' };

  const ids = program.sessions.map((s) => s.id);
  const routineIndex = (planned: PlannedWorkout) =>
    planned.kind === 'gym' && planned.programSessionId !== null
      ? ids.indexOf(planned.programSessionId)
      : -1;
  const isGym = (planned: PlannedWorkout) =>
    planned.kind === 'gym' && !isStaleRoutineLink(planned, program);

  // Where the rotation starts: the next session (spec 010 AC19), or after the last routine session
  // planned between today and a later week.
  let cursor = ids.indexOf(nextProgramSession(program, input.workouts)!.id);
  if (input.weekStart > weekStartOf(today)) {
    const last = input.planned
      .filter((p) => p.localDate >= today && p.localDate < input.weekStart && routineIndex(p) >= 0)
      .sort(
        (a, b) =>
          a.localDate.localeCompare(b.localDate) ||
          (a.startMinute ?? MINUTES_PER_DAY) - (b.startMinute ?? MINUTES_PER_DAY),
      )
      .at(-1);
    if (last) cursor = routineIndex(last) + 1;
  }

  const placed: PlannedWorkout[] = [];
  const replaced: PlannedWorkout[] = [];
  for (const date of weekDays(input.weekStart)) {
    if (date < today || !canPlan(date, today)) continue;
    const ofDay = input.planned.filter((p) => p.localDate === date);
    const planned = sortPlannedSessions(ofDay.filter(isGym));
    const routine = planned.filter((p) => routineIndex(p) >= 0);
    if (routine.length > 0) {
      cursor = routineIndex(routine.at(-1)!) + 1;
      continue;
    }
    if (planned.length > 0) continue;
    const day = gym.get(isoWeekday(date) as Weekday);
    if (!day) continue;
    const stale = ofDay.filter((p) => p.kind === 'gym' && isStaleRoutineLink(p, program));
    if (ofDay.length - stale.length >= PLAN_LIMITS.sessionsPerDayMax) continue;
    const session = program.sessions[cursor % ids.length]!;
    cursor += 1;
    replaced.push(...stale);
    placed.push({
      id: input.newId(),
      localDate: date,
      startMinute: day.startMinute,
      kind: 'gym',
      activity: null,
      name: session.name,
      minutes: day.minutes,
      isMatch: false,
      programSessionId: session.id,
      repeatWorkoutId: null,
      recordedAt,
    });
  }

  const deleteOf = (row: { id: string }) => ({ id: row.id, recordedAt });
  return {
    type: 'ok',
    placed,
    changes: {
      mealItems: { upserts: [], deletes: [] },
      workouts: { upserts: placed, deletes: replaced.map(deleteOf) },
    },
    undo: {
      mealItems: { upserts: [], deletes: [] },
      workouts: {
        upserts: replaced.map((row) => ({ ...row, recordedAt })),
        deletes: placed.map(deleteOf),
      },
    },
  };
}
