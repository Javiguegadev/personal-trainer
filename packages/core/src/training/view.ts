import {
  WORKOUT_LIMITS,
  type ExerciseStats,
  type ExerciseTracking,
  type Locale,
  type SafetyFlag,
  type SetValues,
  type Workout,
  type WorkoutUpsertRequest,
} from '@pt/contracts';
import { addDays } from '../dates';
import { setScores, type BestKind } from './bests';

/**
 * Derived values of the Training tab and the session screen (spec 009 UI): how sets are summarised, the
 * history by week, the picker's recents and the "Récord" marks of saved workouts.
 */

const sameValues = (a: SetValues, b: SetValues) =>
  a.reps === b.reps &&
  a.weightKg === b.weightKg &&
  a.durationS === b.durationS &&
  a.distanceM === b.distanceM;

/** Consecutive equal sets as one group, so "8 × 60 kg, 8 × 60 kg, 8 × 60 kg" reads "3 × 8 · 60 kg" (AC7). */
export function groupSets(sets: readonly SetValues[]): { count: number; values: SetValues }[] {
  const groups: { count: number; values: SetValues }[] = [];
  for (const values of sets) {
    const last = groups.at(-1);
    if (last && sameValues(last.values, values)) last.count++;
    else groups.push({ count: 1, values });
  }
  return groups;
}

/** The Monday of the week of a day (YYYY-MM-DD). */
export function weekStartOf(isoDate: string): string {
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(isoDate, -((weekday + 6) % 7));
}

/**
 * The history of the Training tab (AC20): the workouts of the last `days` days grouped by week (Monday
 * first), newest first, and whether older workouts exist for "Ver más".
 */
export function workoutHistoryWeeks(
  log: readonly Workout[],
  today: string,
  days: number,
): { weeks: { weekStart: string; workouts: Workout[] }[]; hasOlder: boolean } {
  const from = addDays(today, -(days - 1));
  const shown = [...log]
    .filter((w) => w.localDate >= from)
    .sort(
      (a, b) =>
        b.localDate.localeCompare(a.localDate) || Date.parse(b.startedAt) - Date.parse(a.startedAt),
    );
  const weeks: { weekStart: string; workouts: Workout[] }[] = [];
  for (const workout of shown) {
    const weekStart = weekStartOf(workout.localDate);
    const week = weeks.at(-1);
    if (week?.weekStart === weekStart) week.workouts.push(workout);
    else weeks.push({ weekStart, workouts: [workout] });
  }
  return { weeks, hasOlder: log.some((w) => w.localDate < from) };
}

/** The picker's recent exercises (AC5): the stats are already most recently done first. */
export function recentExerciseIds(stats: readonly Pick<ExerciseStats, 'exerciseId'>[]): string[] {
  return stats.slice(0, WORKOUT_LIMITS.recentExercisesMax).map((s) => s.exerciseId);
}

/**
 * Whether records and volume are shown for an exercise (spec 009 Safety): with `ed_soft_stop`, not for
 * bodyweight exercises (reps-only and time), to avoid feeding compulsive exercise.
 */
export function showsRecordsFor(tracking: ExerciseTracking, flags: readonly SafetyFlag[]): boolean {
  if (!flags.includes('ed_soft_stop')) return true;
  return tracking === 'weight_reps' || tracking === 'distance_duration';
}

/**
 * The "Récord" mark of a saved workout (AC20, AC21): its sets that first reached an all-time best which
 * still stands (strictly greater than before, AC14). Each best counts once: in the first set that
 * reached it, and not when an earlier workout of the same day already did (a tie is not a record). The
 * first session of an exercise is not a record (AC10), so the exercise must appear in an earlier
 * workout of the log.
 */
export function workoutRecordCount(
  workout: Workout,
  log: readonly Workout[],
  stats: readonly ExerciseStats[],
  flags: readonly SafetyFlag[],
): number {
  if (workout.kind !== 'gym') return 0;
  const byId = new Map(stats.map((s) => [s.exerciseId, s]));
  const start = Date.parse(workout.startedAt);
  const earlier = log.filter((w) => w.id !== workout.id && Date.parse(w.startedAt) < start);
  let count = 0;
  for (const exercise of workout.exercises) {
    const id = exercise.exerciseId;
    if (id === null || !showsRecordsFor(exercise.tracking, flags)) continue;
    const exerciseStats = byId.get(id);
    if (!exerciseStats) continue;
    const before = earlier.flatMap((w) =>
      w.exercises
        .filter((e) => e.exerciseId === id && e.sets.length > 0)
        .map((e) => ({ localDate: w.localDate, sets: e.sets })),
    );
    if (!before.length) continue;
    const reachedEarlierToday = (kind: BestKind, value: number) =>
      before.some(
        (s) =>
          s.localDate === workout.localDate &&
          s.sets.some((set) => (setScores(set, exercise.tracking)[kind] ?? -1) >= value),
      );
    const credited = new Set<BestKind>();
    for (const set of exercise.sets) {
      let isRecord = false;
      for (const [kind, value] of Object.entries(setScores(set, exercise.tracking)) as [
        BestKind,
        number,
      ][]) {
        const best = exerciseStats.bests[kind];
        if (credited.has(kind) || best === null) continue;
        if (best.localDate !== workout.localDate || best.value !== value) continue;
        if (reachedEarlierToday(kind, value)) continue;
        credited.add(kind);
        isRecord = true;
      }
      if (isRecord) count++;
    }
  }
  return count;
}

/** Whether a saved workout can be written again as it is (AC19): every exercise still exists. */
export function canRewriteWorkout(workout: Pick<Workout, 'exercises'>): boolean {
  return workout.exercises.every((e) => e.exerciseId !== null);
}

/**
 * A saved workout as a `PUT` again (AC19: edit its day, duration, effort or name; and the undo of a
 * delete). Null when an exercise no longer exists (`canRewriteWorkout`): a `PUT` replaces the whole
 * workout, so leaving it out would erase its sets (spec 009 Safety).
 */
export function workoutToRequest(
  workout: Workout,
  placement: { recordedAt: string; today: string; locale: Locale },
  changes: Partial<
    Pick<WorkoutUpsertRequest, 'localDate' | 'startedAt' | 'minutes' | 'sessionRpe' | 'name'>
  > = {},
): WorkoutUpsertRequest | null {
  const shared = {
    name: workout.name,
    minutes: workout.minutes,
    localDate: workout.localDate,
    startedAt: workout.startedAt,
    sessionRpe: workout.sessionRpe,
    ...placement,
    ...changes,
  };
  if (workout.kind !== 'gym') {
    return { kind: workout.kind, activity: workout.activity, inputMethod: 'activity', ...shared };
  }
  if (!canRewriteWorkout(workout)) return null;
  const exercises = workout.exercises
    .filter((e) => e.sets.length > 0)
    .map((e) => ({
      exerciseId: e.exerciseId!,
      sets: e.sets.map((s) => ({
        reps: s.reps,
        weightKg: s.weightKg,
        durationS: s.durationS,
        distanceM: s.distanceM,
        restS: s.restS,
      })),
    }));
  if (!exercises.length) return null;
  const inputMethod = workout.inputMethod === 'activity' ? 'manual' : workout.inputMethod;
  return { kind: 'gym', exercises, inputMethod, ...shared };
}
