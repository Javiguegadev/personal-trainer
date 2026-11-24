import {
  WORKOUT_LIMITS,
  type ExerciseStats,
  type ExerciseTracking,
  type GymWorkoutRequest,
  type Locale,
  type PersonalBests,
  type SetValues,
  type Workout,
  type WorkoutDraftActivity,
  type WorkoutDraftUnresolved,
} from '@pt/contracts';
import { NO_BESTS, addToBests, lastRest, newBests, type NewRecord } from './bests';
import { restoreSessionVolume, type SessionReadiness } from '../checkin/adjust';
import { EMPTY_SET, setForTracking, setMatchesTracking, withPlaceholder } from './sets';

/**
 * The live session (spec 009 AC6–AC13): a pure reducer, persisted on the device by the app, so a
 * session survives a closed app or a restart (AC11). Nothing reaches the API until "Terminar": then
 * `sessionToRequest` gives one idempotent `PUT`. The same state edits a past session (AC17, AC19).
 * Times are ISO strings passed in by the caller: the reducer never reads the clock.
 */

export interface LiveSet {
  id: string;
  /** What the user typed; null fields show the placeholder. */
  values: SetValues;
  /** Last time's values (AC7), used when the set is completed without changes (AC8). */
  placeholder: SetValues | null;
  completedAt: string | null;
  /** Rest after this set (AC9). */
  restS: number | null;
  /**
   * A set of a sentence draft (spec 012 AC8, AC10): `incomplete` lacks a value its tracking needs
   * ("Completa esta serie"), `review` had a value out of range ("Revisa"). Cleared when completed.
   */
  mark?: 'incomplete' | 'review' | null;
}

export interface LiveExercise {
  /** Id of the card in this session (the same exercise may appear twice). */
  uid: string;
  exerciseId: string;
  label: string;
  tracking: ExerciseTracking;
  /** Rest the next timer of this exercise starts with (AC9). */
  restS: number;
  /** Bests before this session, to detect records offline (AC10). */
  bestsBefore: PersonalBests;
  /** "Última vez" line (AC7). */
  last: { localDate: string; sets: SetValues[] } | null;
  sets: LiveSet[];
}

export interface RestTimer {
  exerciseUid: string;
  setId: string;
  startedAt: string;
  durationS: number;
}

/** What the editor shows of a sentence draft besides its exercises (spec 012). */
export interface TextDraftState {
  /** Exercises the catalog lacks (AC7): never saved until resolved. */
  unresolved: WorkoutDraftUnresolved[];
  /** Other activities said, each with "Registrar" (AC6). */
  extraActivities: WorkoutDraftActivity[];
  painMentioned: boolean;
  ignored: number;
  /** The day said was dropped: the day chip shows "Revisa el día" until the day changes (AC4). */
  dayDropped: boolean;
  /** The routine session the draft matched (AC13); `programSessionId` holds it while the chip is on. */
  routineSessionId: string | null;
}

/** `live`: in the gym, with the rest timer. `manual`: a past session (AC17). `edit`: a saved one (AC19). */
export type SessionMode = 'live' | 'manual' | 'edit';

export interface LiveSession {
  version: 1;
  /** The workout id, generated on the device. */
  id: string;
  mode: SessionMode;
  /** `text`: a draft of the sentence shortcut (spec 012). */
  inputMethod: 'live' | 'manual' | 'repeat' | 'program' | 'text';
  /** The routine session it was started from (spec 010 AC18); absent in sessions saved before it. */
  programSessionId?: string | null;
  /** The planned session it does (spec 013 AC15); absent in sessions saved before it. */
  plannedWorkoutId?: string | null;
  localDate: string;
  startedAt: string;
  name: string | null;
  /** Kept from the saved workout in `edit` mode; asked at the end otherwise (AC12). */
  minutes: number | null;
  sessionRpe: number | null;
  exercises: LiveExercise[];
  rest: RestTimer | null;
  /** The readiness adjustment made at start (spec 011 AC7); absent or null when there is none. */
  readiness?: SessionReadiness | null;
  /** A draft of the sentence shortcut (spec 012); absent in every other session. */
  textDraft?: TextDraftState | null;
}

export type SessionAction =
  | { type: 'addExercises'; exercises: LiveExercise[] }
  | { type: 'removeExercise'; uid: string }
  | { type: 'moveExercise'; uid: string; offset: -1 | 1 }
  | { type: 'addSet'; uid: string; setId: string }
  | { type: 'updateSet'; uid: string; setId: string; values: Partial<SetValues> }
  | { type: 'completeSet'; uid: string; setId: string; at: string }
  | { type: 'uncompleteSet'; uid: string; setId: string }
  | { type: 'removeSet'; uid: string; setId: string }
  | { type: 'adjustRest'; deltaS: number }
  | { type: 'skipRest' }
  | { type: 'setStart'; localDate: string; startedAt: string }
  | { type: 'setName'; name: string | null }
  /** "Entrenar normal" (spec 011 AC8). */
  | { type: 'trainNormally' }
  /** "Cambiar ejercicio" (spec 012 AC12): the sets move to the exercise picked. */
  | {
      type: 'replaceExercise';
      uid: string;
      exercise: { id: string; label: string; tracking: ExerciseTracking };
      stats: ExerciseStats | null;
    }
  /** An unresolved mention of a draft, resolved with `liveExerciseFromDraft` (spec 012 AC7). */
  | { type: 'resolveMention'; index: number; exercise: LiveExercise }
  | { type: 'removeMention'; index: number }
  | { type: 'removeExtraActivity'; index: number }
  /** "Cuenta como Rutina A" (spec 012 AC13). */
  | { type: 'setRoutineLink'; on: boolean };

export function startSession(input: {
  id: string;
  localDate: string;
  startedAt: string;
  mode: 'live' | 'manual';
}): LiveSession {
  return {
    version: 1,
    id: input.id,
    mode: input.mode,
    inputMethod: input.mode,
    localDate: input.localDate,
    startedAt: input.startedAt,
    name: null,
    minutes: null,
    sessionRpe: null,
    exercises: [],
    rest: null,
  };
}

/**
 * A card for an exercise added to a session (AC7): as many sets as last time (3 if never done), each
 * with last time's values as placeholders. `placeholders` replaces them when a past session is
 * repeated (AC18).
 */
export function newLiveExercise(input: {
  exercise: { id: string; label: string; tracking: ExerciseTracking };
  stats: ExerciseStats | null;
  newId: () => string;
  placeholders?: readonly SetValues[];
}): LiveExercise {
  const lastSets = input.stats?.last.sets ?? [];
  const placeholders: (SetValues | null)[] = input.placeholders?.length
    ? [...input.placeholders]
    : lastSets.length
      ? lastSets.map((s) => setForTracking(s, input.exercise.tracking))
      : Array<null>(WORKOUT_LIMITS.defaultSets).fill(null);
  return {
    uid: input.newId(),
    ...exerciseShell(input.exercise, input.stats),
    sets: placeholders.slice(0, WORKOUT_LIMITS.setsPerExerciseMax).map((placeholder) => ({
      id: input.newId(),
      values: EMPTY_SET,
      placeholder,
      completedAt: null,
      restS: null,
    })),
  };
}

/** What a card knows of its exercise, apart from the sets: names, rest, bests, last time. */
function exerciseShell(
  exercise: { id: string; label: string; tracking: ExerciseTracking },
  stats: ExerciseStats | null,
): Omit<LiveExercise, 'uid' | 'sets'> {
  return {
    exerciseId: exercise.id,
    label: exercise.label,
    tracking: exercise.tracking,
    restS: lastRest(stats) ?? WORKOUT_LIMITS.defaultRestS,
    bestsBefore: stats?.bests ?? NO_BESTS,
    last: stats
      ? {
          localDate: stats.last.localDate,
          sets: stats.last.sets.map((s) => setForTracking(s, exercise.tracking)),
        }
      : null,
  };
}

/**
 * "Cambiar ejercicio" (spec 012 AC12): the card takes the exercise picked, with its rest, bests and
 * last time; each set keeps the values the new tracking uses, and goes back to uncompleted when one it
 * needs is missing. Uncompleted sets take the new exercise's last time as placeholders.
 */
function replaceExercise(
  exercise: LiveExercise,
  to: { id: string; label: string; tracking: ExerciseTracking },
  stats: ExerciseStats | null,
): LiveExercise {
  const shell = exerciseShell(to, stats);
  const last = shell.last?.sets ?? [];
  return {
    ...exercise,
    ...shell,
    sets: exercise.sets.map((set, i) => {
      const values = setForTracking(set.values, to.tracking);
      const keep = set.completedAt !== null && setMatchesTracking(values, to.tracking);
      return {
        ...set,
        values,
        placeholder: last[i] ?? last.at(-1) ?? null,
        completedAt: keep ? set.completedAt : null,
      };
    }),
  };
}

/** Whether ✓ can complete the set: its values, or the placeholder, fit the tracking (AC8). */
export function canCompleteSet(set: LiveSet, tracking: ExerciseTracking): boolean {
  return setMatchesTracking(withPlaceholder(set.values, set.placeholder), tracking);
}

const mapExercise = (
  session: LiveSession,
  uid: string,
  update: (exercise: LiveExercise) => LiveExercise,
): LiveSession => ({
  ...session,
  exercises: session.exercises.map((e) => (e.uid === uid ? update(e) : e)),
});

const mapSet = (exercise: LiveExercise, setId: string, update: (set: LiveSet) => LiveSet) => ({
  ...exercise,
  sets: exercise.sets.map((s) => (s.id === setId ? update(s) : s)),
});

const clampRest = (seconds: number) => Math.min(Math.max(seconds, 0), WORKOUT_LIMITS.restSMax);

export function sessionReducer(session: LiveSession, action: SessionAction): LiveSession {
  switch (action.type) {
    case 'addExercises': {
      const room = WORKOUT_LIMITS.exercisesPerSessionMax - session.exercises.length;
      return { ...session, exercises: [...session.exercises, ...action.exercises.slice(0, room)] };
    }
    case 'removeExercise':
      return {
        ...session,
        exercises: session.exercises.filter((e) => e.uid !== action.uid),
        rest: session.rest?.exerciseUid === action.uid ? null : session.rest,
      };
    case 'moveExercise': {
      const from = session.exercises.findIndex((e) => e.uid === action.uid);
      const to = from + action.offset;
      if (from < 0 || to < 0 || to >= session.exercises.length) return session;
      const exercises = [...session.exercises];
      [exercises[from], exercises[to]] = [exercises[to]!, exercises[from]!];
      return { ...session, exercises };
    }
    case 'addSet':
      return mapExercise(session, action.uid, (exercise) => {
        if (exercise.sets.length >= WORKOUT_LIMITS.setsPerExerciseMax) return exercise;
        const last = exercise.sets.at(-1);
        const copy = last ? withPlaceholder(last.values, last.placeholder) : EMPTY_SET;
        return {
          ...exercise,
          sets: [
            ...exercise.sets,
            { id: action.setId, values: copy, placeholder: null, completedAt: null, restS: null },
          ],
        };
      });
    case 'updateSet':
      return mapExercise(session, action.uid, (exercise) =>
        mapSet(exercise, action.setId, (set) => ({
          ...set,
          values: { ...set.values, ...action.values },
        })),
      );
    case 'completeSet': {
      const exercise = session.exercises.find((e) => e.uid === action.uid);
      const set = exercise?.sets.find((s) => s.id === action.setId);
      if (!exercise || !set || !canCompleteSet(set, exercise.tracking)) return session;
      const live = session.mode === 'live';
      const next = mapExercise(session, action.uid, (e) =>
        mapSet(e, action.setId, (s) => ({
          ...s,
          values: setForTracking(withPlaceholder(s.values, s.placeholder), e.tracking),
          completedAt: action.at,
          restS: live ? e.restS : s.restS,
          mark: null,
        })),
      );
      return live
        ? {
            ...next,
            rest: {
              exerciseUid: action.uid,
              setId: action.setId,
              startedAt: action.at,
              durationS: exercise.restS,
            },
          }
        : next;
    }
    case 'uncompleteSet': {
      const next = mapExercise(session, action.uid, (e) =>
        mapSet(e, action.setId, (s) => ({ ...s, completedAt: null })),
      );
      return session.rest?.setId === action.setId ? { ...next, rest: null } : next;
    }
    case 'removeSet': {
      const next = mapExercise(session, action.uid, (e) => ({
        ...e,
        sets: e.sets.filter((s) => s.id !== action.setId),
      }));
      return session.rest?.setId === action.setId ? { ...next, rest: null } : next;
    }
    case 'adjustRest': {
      const rest = session.rest;
      if (!rest) return session;
      const durationS = clampRest(rest.durationS + action.deltaS);
      const next = mapExercise(session, rest.exerciseUid, (e) =>
        mapSet({ ...e, restS: durationS }, rest.setId, (s) => ({ ...s, restS: durationS })),
      );
      return { ...next, rest: { ...rest, durationS } };
    }
    case 'skipRest':
      return { ...session, rest: null };
    case 'setStart':
      return {
        ...session,
        localDate: action.localDate,
        startedAt: action.startedAt,
        ...(session.textDraft ? { textDraft: { ...session.textDraft, dayDropped: false } } : {}),
      };
    case 'setName':
      return { ...session, name: action.name?.trim() || null };
    case 'trainNormally':
      return restoreSessionVolume(session);
    case 'replaceExercise':
      return mapExercise(session, action.uid, (e) =>
        replaceExercise(e, action.exercise, action.stats),
      );
    case 'resolveMention': {
      const draft = session.textDraft;
      const mention = draft?.unresolved[action.index];
      if (!draft || !mention) return session;
      if (session.exercises.length >= WORKOUT_LIMITS.exercisesPerSessionMax) return session;
      const at = Math.min(mention.position, session.exercises.length);
      const exercises = [...session.exercises];
      exercises.splice(at, 0, action.exercise);
      // Mentions said after it move one place down; those said before it keep theirs.
      const unresolved = draft.unresolved.flatMap((u, i) => {
        if (i === action.index) return [];
        return i > action.index && u.position >= mention.position
          ? [{ ...u, position: u.position + 1 }]
          : [u];
      });
      return { ...session, exercises, textDraft: { ...draft, unresolved } };
    }
    case 'removeMention': {
      const draft = session.textDraft;
      if (!draft) return session;
      const unresolved = draft.unresolved.filter((_, i) => i !== action.index);
      return { ...session, textDraft: { ...draft, unresolved } };
    }
    case 'removeExtraActivity': {
      const draft = session.textDraft;
      if (!draft) return session;
      const extraActivities = draft.extraActivities.filter((_, i) => i !== action.index);
      return { ...session, textDraft: { ...draft, extraActivities } };
    }
    case 'setRoutineLink': {
      const linked = session.textDraft?.routineSessionId ?? null;
      if (!linked) return session;
      return { ...session, programSessionId: action.on ? linked : null };
    }
  }
}

/** Seconds left on the rest timer (AC9), from timestamps so it survives the background. */
export function restRemaining(rest: RestTimer | null, now: string): number {
  if (!rest) return 0;
  const end = Date.parse(rest.startedAt) + rest.durationS * 1000;
  return Math.max(0, Math.ceil((end - Date.parse(now)) / 1000));
}

const completedSets = (exercise: LiveExercise) =>
  exercise.sets.filter((s) => s.completedAt !== null);

/**
 * The records a completed set beats (AC10): against the bests before the session plus the sets of this
 * session completed before it. An exercise never done before shows no badge in its first session.
 */
export function liveSetRecords(
  exercise: LiveExercise,
  setId: string,
  localDate: string,
): NewRecord[] {
  const target = exercise.sets.find((s) => s.id === setId);
  if (!target?.completedAt) return [];
  if (!Object.values(exercise.bestsBefore).some((b) => b !== null)) return [];
  let bests = exercise.bestsBefore;
  for (const set of completedSets(exercise)) {
    if (set.id === setId) break;
    bests = addToBests(bests, set.values, exercise.tracking, localDate);
  }
  return newBests(target.values, exercise.tracking, bests);
}

const MINUTE_MS = 60_000;

/**
 * Minutes of a session ending at `endedAt` (AC12). A changed device clock can give a negative or absurd
 * span: then the span of the completed sets is used, and null means "ask the user".
 */
export function elapsedMinutes(session: LiveSession, endedAt: string): number | null {
  const fits = (minutes: number) =>
    Number.isFinite(minutes) && minutes >= 0 && minutes <= WORKOUT_LIMITS.minutesMax;
  const span = (Date.parse(endedAt) - Date.parse(session.startedAt)) / MINUTE_MS;
  if (fits(span)) return Math.max(WORKOUT_LIMITS.minutesMin, Math.round(span));
  const times = session.exercises
    .flatMap(completedSets)
    .map((s) => Date.parse(s.completedAt!))
    .sort((a, b) => a - b);
  if (times.length >= 2) {
    const sets = (times.at(-1)! - times[0]!) / MINUTE_MS;
    if (fits(sets)) return Math.max(WORKOUT_LIMITS.minutesMin, Math.round(sets));
  }
  return null;
}

export interface SessionSummary {
  minutes: number | null;
  exercises: number;
  sets: number;
  /** Kg × reps of the weight exercises (AC12). */
  volumeKg: number;
  records: number;
}

export function sessionSummary(session: LiveSession, endedAt: string): SessionSummary {
  let sets = 0;
  let volumeKg = 0;
  let records = 0;
  let exercises = 0;
  for (const exercise of session.exercises) {
    const done = completedSets(exercise);
    if (done.length) exercises++;
    sets += done.length;
    for (const set of done) {
      if (exercise.tracking === 'weight_reps') {
        volumeKg += (set.values.weightKg ?? 0) * (set.values.reps ?? 0);
      }
      if (liveSetRecords(exercise, set.id, session.localDate).length) records++;
    }
  }
  return {
    minutes: session.minutes ?? elapsedMinutes(session, endedAt),
    exercises,
    sets,
    volumeKg: Math.round(volumeKg),
    records,
  };
}

export const hasCompletedSet = (session: LiveSession) =>
  session.exercises.some((e) => e.sets.some((s) => s.completedAt !== null));

/**
 * Whether replacing this session loses something (spec 012 AC2): an exercise, or an exercise of a
 * sentence still unresolved. An empty past session is replaced without asking.
 */
export const sessionHasContent = (session: LiveSession) =>
  session.exercises.length > 0 || (session.textDraft?.unresolved.length ?? 0) > 0;

/**
 * The `PUT` of a finished session (AC12): only the completed sets, exercises without one left out.
 * Null when nothing was completed.
 */
export function sessionToRequest(
  session: LiveSession,
  finish: {
    minutes: number;
    sessionRpe: number | null;
    name: string | null;
    recordedAt: string;
    today: string;
    locale: Locale;
  },
): GymWorkoutRequest | null {
  const exercises = session.exercises
    .map((exercise) => ({
      exerciseId: exercise.exerciseId,
      sets: completedSets(exercise).map((set) => ({
        ...setForTracking(set.values, exercise.tracking),
        restS: set.restS,
      })),
    }))
    .filter((e) => e.sets.length > 0);
  if (!exercises.length) return null;
  return {
    kind: 'gym',
    name: finish.name?.trim() || null,
    minutes: finish.minutes,
    exercises,
    inputMethod: session.inputMethod,
    programSessionId: session.programSessionId ?? null,
    plannedWorkoutId: session.plannedWorkoutId ?? null,
    localDate: session.localDate,
    startedAt: session.startedAt,
    sessionRpe: finish.sessionRpe,
    recordedAt: finish.recordedAt,
    today: finish.today,
    locale: finish.locale,
  };
}

/** A session open longer than 6 hours asks whether it finished (AC13). */
export function isStaleSession(session: LiveSession, now: string): boolean {
  if (session.mode !== 'live') return false;
  const hours = (Date.parse(now) - Date.parse(session.startedAt)) / (60 * MINUTE_MS);
  return hours > WORKOUT_LIMITS.staleSessionHours;
}

/** The end time AC13 proposes: the last completed set, or the start of an empty session. */
export function staleEndTime(session: LiveSession): string {
  const times = session.exercises
    .flatMap(completedSets)
    .map((s) => s.completedAt!)
    .sort();
  return times.at(-1) ?? session.startedAt;
}

const statsFor = (stats: ReadonlyMap<string, ExerciseStats>, id: string | null) =>
  (id && stats.get(id)) || null;

/**
 * "Repetir" (AC18): a new live session with the exercises of a past one, in the same order and with
 * the same number of sets, prefilled with that session's values.
 */
export function repeatWorkout(
  workout: Workout,
  input: {
    id: string;
    localDate: string;
    startedAt: string;
    stats: ReadonlyMap<string, ExerciseStats>;
    newId: () => string;
  },
): LiveSession {
  const session = startSession({ ...input, mode: 'live' });
  return {
    ...session,
    inputMethod: 'repeat',
    name: workout.name,
    exercises: workout.exercises
      .filter((e) => e.exerciseId !== null && e.sets.length > 0)
      .map((e) =>
        newLiveExercise({
          exercise: { id: e.exerciseId!, label: e.label, tracking: e.tracking },
          stats: statsFor(input.stats, e.exerciseId),
          newId: input.newId,
          placeholders: e.sets.map((s) => setForTracking(s, e.tracking)),
        }),
      ),
  };
}

/** A saved gym session opened to edit it (AC19): every set completed, nothing timed. */
export function editWorkout(
  workout: Workout,
  input: { stats: ReadonlyMap<string, ExerciseStats>; newId: () => string },
): LiveSession {
  return {
    version: 1,
    id: workout.id,
    mode: 'edit',
    inputMethod: workout.inputMethod === 'activity' ? 'manual' : workout.inputMethod,
    programSessionId: workout.programSessionId,
    plannedWorkoutId: workout.plannedWorkoutId,
    localDate: workout.localDate,
    startedAt: workout.startedAt,
    name: workout.name,
    minutes: workout.minutes,
    sessionRpe: workout.sessionRpe,
    rest: null,
    exercises: workout.exercises
      .filter((e) => e.exerciseId !== null)
      .map((e) => ({
        ...newLiveExercise({
          exercise: { id: e.exerciseId!, label: e.label, tracking: e.tracking },
          stats: statsFor(input.stats, e.exerciseId),
          newId: input.newId,
          placeholders: [EMPTY_SET],
        }),
        sets: e.sets.map((s) => ({
          id: input.newId(),
          values: setForTracking(s, e.tracking),
          placeholder: null,
          completedAt: workout.startedAt,
          restS: s.restS,
        })),
      })),
  };
}
