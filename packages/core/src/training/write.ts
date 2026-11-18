import {
  ACTIVITY_TYPES,
  ActivityTypeSchema,
  WORKOUT_LIMITS,
  type ActivityKindForLog,
  type ActivityType,
  type CustomExerciseUpsertRequest,
  type Exercise,
  type ExerciseTracking,
  type Locale,
  type PlannedActivity,
  type Workout,
  type WorkoutLogResponse,
  type WorkoutUpsertRequest,
} from '@pt/contracts';
import { addDays, daysBetween } from '../dates';
import { checkClientDates } from '../profile/evaluate';
import { setForTracking, setMatchesTracking } from './sets';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Request-level checks of a workout write that need the server clock (spec 009, same rules as the food
 * log): `today` within ±1 day of the server, no future day, at most a year back, and a device clock at
 * most one day ahead. Returns the field errors, or null.
 */
export function checkWorkoutWrite(
  write: { localDate: string; today: string; recordedAt: string },
  now: Date,
): Record<string, string> | null {
  const invalid = checkClientDates({ today: write.today }, now);
  if (invalid) return invalid;
  if (write.localDate > write.today) return { localDate: 'in_future' };
  if (write.localDate < addDays(write.today, -WORKOUT_LIMITS.historyDays)) {
    return { localDate: 'too_old' };
  }
  if (Date.parse(write.recordedAt) > now.getTime() + DAY_MS) return { recordedAt: 'in_future' };
  return null;
}

/** `GET /me/workouts?from&to`: at most 62 days. */
export function checkWorkoutRange(from: string, to: string): Record<string, string> | null {
  if (from > to) return { from: 'after_to' };
  if (daysBetween(from, to) > WORKOUT_LIMITS.listDaysMax) return { to: 'too_big' };
  return null;
}

/** What the API knows of an exercise the user may log: the catalog and their own ones. */
export interface LoggableExercise {
  id: string;
  nameEs: string;
  nameEn: string;
  tracking: ExerciseTracking;
}

export type WorkoutWriteError =
  | { error: 'exercise_not_found'; exerciseId: string }
  | { error: 'set_mismatch'; exerciseId: string; setNumber: number };

/**
 * The stored workout for a write (AC12, AC16, AC23). Exercise names are snapshots in the user's
 * locale; a set must have the values its exercise's tracking needs, and only those are kept.
 */
export function workoutFromRequest(
  id: string,
  request: WorkoutUpsertRequest,
  exercises: ReadonlyMap<string, LoggableExercise>,
): Workout | WorkoutWriteError {
  const base = {
    id,
    localDate: request.localDate,
    name: request.name,
    startedAt: request.startedAt,
    minutes: request.minutes,
    sessionRpe: request.sessionRpe,
    inputMethod: request.inputMethod,
    recordedAt: request.recordedAt,
  };
  if (request.kind !== 'gym') {
    return { ...base, kind: request.kind, activity: request.activity, exercises: [] };
  }
  const out: Workout['exercises'] = [];
  for (const entry of request.exercises) {
    const exercise = exercises.get(entry.exerciseId);
    if (!exercise) return { error: 'exercise_not_found', exerciseId: entry.exerciseId };
    const sets: Workout['exercises'][number]['sets'] = [];
    for (const [index, set] of entry.sets.entries()) {
      if (!setMatchesTracking(set, exercise.tracking)) {
        return { error: 'set_mismatch', exerciseId: entry.exerciseId, setNumber: index + 1 };
      }
      sets.push({
        ...setForTracking(set, exercise.tracking),
        restS: set.restS,
        setNumber: index + 1,
      });
    }
    out.push({
      exerciseId: exercise.id,
      label: labelFor(exercise, request.locale),
      tracking: exercise.tracking,
      sets,
    });
  }
  return { ...base, kind: 'gym', activity: null, exercises: out };
}

const labelFor = (exercise: LoggableExercise, locale: Locale) =>
  locale === 'en' ? exercise.nameEn : exercise.nameEs;

/**
 * A custom exercise as the catalog lists it (spec 009 Assumptions): the same name in both locales, no
 * synonyms, private to its owner. Distance exercises are cardio; the rest are strength.
 */
export function customExercise(id: string, request: CustomExerciseUpsertRequest): Exercise {
  return {
    id,
    key: null,
    origin: 'user',
    nameEs: request.name,
    nameEn: request.name,
    synonymsEs: [],
    synonymsEn: [],
    tracking: request.tracking,
    category: request.tracking === 'distance_duration' ? 'cardio' : 'strength',
    primaryMuscles: request.primaryMuscle ? [request.primaryMuscle] : [],
    secondaryMuscles: [],
    equipment: [],
    popularity: 0,
    source: null,
  };
}

/** One chip of the activity sheet (AC16). */
export interface ActivityChoice {
  kind: ActivityKindForLog;
  /** A chip of AC16, or null for a profile activity whose name is kept as the workout name. */
  activity: ActivityType | null;
  /** The profile activity's name ("Fútbol 7"); null for a default chip (the UI translates it). */
  name: string | null;
}

/**
 * The chips of AC16: the activities of the profile first (strength is a gym session, not an activity),
 * then the default types not already covered by a profile activity of the same name.
 */
export function activityChoices(
  planned: readonly Pick<PlannedActivity, 'kind' | 'label'>[],
): ActivityChoice[] {
  const fromProfile: ActivityChoice[] = [];
  const seen = new Set<string>();
  for (const activity of planned) {
    if (activity.kind === 'strength' || !activity.label) continue;
    const key = activity.label.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fromProfile.push({ kind: activity.kind, activity: null, name: activity.label.trim() });
  }
  const defaults = ActivityTypeSchema.options.map((activity): ActivityChoice => ({
    kind: ACTIVITY_TYPES[activity],
    activity,
    name: null,
  }));
  return [...fromProfile, ...defaults];
}

/** Workouts of one day, oldest first (AC21). */
export function workoutsOfDay(log: WorkoutLogResponse['workouts'], localDate: string): Workout[] {
  return log
    .filter((w) => w.localDate === localDate)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/**
 * The "Repetir" shortcuts (AC18, AC20): the last gym sessions with distinct exercise lists, newest
 * first.
 */
export function repeatShortcuts(log: readonly Workout[]): Workout[] {
  const seen = new Set<string>();
  const shortcuts: Workout[] = [];
  for (const workout of [...log].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    if (workout.kind !== 'gym' || !workout.exercises.some((e) => e.exerciseId)) continue;
    const signature = workout.exercises.map((e) => e.exerciseId ?? e.label).join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    shortcuts.push(workout);
    if (shortcuts.length === WORKOUT_LIMITS.repeatShortcuts) break;
  }
  return shortcuts;
}

/** The completed sets of a gym session (AC20: "5 ejercicios · 18 series"). */
export function workoutSetCount(workout: Pick<Workout, 'exercises'>): number {
  return workout.exercises.reduce((sum, e) => sum + e.sets.length, 0);
}
