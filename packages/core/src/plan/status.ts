import type { MealItem, PlannedWorkout, Program, ProgramSession, Workout } from '@pt/contracts';

/**
 * Planned and done (spec 013 Assumptions): a planned row is done while a live log row points at it, so
 * deleting the log makes it pending again and no device keeps a separate "done" flag. The plan row
 * never changes when it is logged.
 */

const MINUTES_PER_DAY = 1440;

/** The planned items no live log item points at (AC9). */
export function pendingPlannedItems<P extends { id: string }>(
  planned: readonly P[],
  logged: readonly { plannedItemId?: MealItem['plannedItemId'] }[],
): P[] {
  const done = new Set(logged.map((i) => i.plannedItemId).filter((id) => id != null));
  return planned.filter((p) => !done.has(p.id));
}

/** Each planned session with the live workout that does it, or null (AC17). */
export function plannedWorkoutStatus<
  P extends { id: string },
  W extends { plannedWorkoutId?: Workout['plannedWorkoutId'] },
>(planned: readonly P[], workouts: readonly W[]): { planned: P; done: W | null }[] {
  return planned.map((p) => ({
    planned: p,
    done: workouts.find((w) => w.plannedWorkoutId === p.id) ?? null,
  }));
}

/** The planned sessions no live workout does (AC17). */
export function pendingPlannedWorkouts<P extends { id: string }>(
  planned: readonly P[],
  workouts: readonly { plannedWorkoutId?: Workout['plannedWorkoutId'] }[],
): P[] {
  const done = new Set(workouts.map((w) => w.plannedWorkoutId).filter((id) => id != null));
  return planned.filter((p) => !done.has(p.id));
}

/** By start time; sessions without a time last, in their order. */
export function sortPlannedSessions<P extends Pick<PlannedWorkout, 'startMinute'>>(
  planned: readonly P[],
): P[] {
  return [...planned].sort(
    (a, b) => (a.startMinute ?? MINUTES_PER_DAY) - (b.startMinute ?? MINUTES_PER_DAY),
  );
}

/**
 * Today's pending planned sessions (AC14), by start time: the Training tab and Today show them instead
 * of "Siguiente: …"; none means the rotation of spec 010 AC17 applies unchanged.
 */
export function todayPlannedSessions<
  P extends Pick<PlannedWorkout, 'id' | 'localDate' | 'startMinute'>,
>(
  planned: readonly P[],
  workouts: readonly { plannedWorkoutId?: Workout['plannedWorkoutId'] }[],
  today: string,
): P[] {
  return sortPlannedSessions(
    pendingPlannedWorkouts(
      planned.filter((p) => p.localDate === today),
      workouts,
    ),
  );
}

/**
 * A routine link that no longer reads right (spec 013 Stale links): the session of a routine the user
 * deleted (spec 010 AC20 keeps its row). It shows as a free gym session with its name, and "Planificar
 * con mi rutina" replaces it (AC11). A session removed from a routine loses the link in the database.
 */
export function isStaleRoutineLink(
  planned: Pick<PlannedWorkout, 'programSessionId'>,
  program: Pick<Program, 'sessions'> | null,
): boolean {
  if (planned.programSessionId === null) return false;
  return !program?.sessions.some((s) => s.id === planned.programSessionId);
}

/** What "Empezar" or "Registrar" does with a planned session (AC15, AC16, AC17). */
export type PlannedSessionStart =
  /** A session of the current routine (spec 010 AC18). */
  | { type: 'program'; session: ProgramSession }
  /** A past workout to repeat (spec 009 AC18). */
  | { type: 'repeat'; workoutId: string; name: string | null }
  /** An empty live session with this name ("Gimnasio libre"). */
  | { type: 'free'; name: string | null }
  /** The activity sheet (spec 009 AC16), prefilled from the planned row. */
  | { type: 'activity' };

export function resolvePlannedSession(
  planned: Pick<PlannedWorkout, 'kind' | 'name' | 'programSessionId' | 'repeatWorkoutId'>,
  program: Pick<Program, 'sessions'> | null,
): PlannedSessionStart {
  if (planned.kind !== 'gym') return { type: 'activity' };
  if (planned.programSessionId !== null) {
    const session = program?.sessions.find((s) => s.id === planned.programSessionId);
    return session ? { type: 'program', session } : { type: 'free', name: planned.name };
  }
  if (planned.repeatWorkoutId !== null) {
    return { type: 'repeat', workoutId: planned.repeatWorkoutId, name: planned.name };
  }
  return { type: 'free', name: planned.name };
}
