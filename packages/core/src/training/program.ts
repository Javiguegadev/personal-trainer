import {
  PROGRAM_LIMITS,
  type ExerciseStats,
  type ExerciseTracking,
  type Locale,
  type Program,
  type ProgramExercise,
  type ProgramSession,
  type ProgramUpsertRequest,
  type SetValues,
  type Workout,
} from '@pt/contracts';
import type { ProgramDraft } from './routine';
import { newLiveExercise, startSession, type LiveSession } from './session';
import { EMPTY_SET, setForTracking } from './sets';

/**
 * A saved routine at work (spec 010 AC16–AC19): the editor's reducer, the rotation of its sessions and
 * the live session a routine session starts. Pure; ids and times are passed in.
 */

/** The `PUT /me/program/:id` body (AC16). Exercises whose catalog entry is gone are left out. */
export function programToRequest(
  draft: ProgramDraft,
  write: { recordedAt: string; locale: Locale },
): ProgramUpsertRequest {
  return {
    name: draft.name.trim(),
    origin: draft.origin,
    templateKey: draft.templateKey,
    sessions: draft.sessions.map((session) => ({
      id: session.id,
      name: session.name.trim(),
      exercises: session.exercises.flatMap((e) =>
        e.exerciseId === null
          ? []
          : [
              {
                exerciseId: e.exerciseId,
                sets: e.sets,
                repsMin: e.repsMin,
                repsMax: e.repsMax,
                durationS: e.durationS,
                restS: e.restS,
              },
            ],
      ),
    })),
    recordedAt: write.recordedAt,
    locale: write.locale,
  };
}

/** The editable copy of a saved routine. */
export function programToDraft(program: Program): ProgramDraft {
  return {
    id: program.id,
    name: program.name,
    origin: program.origin,
    templateKey: program.templateKey,
    sessions: program.sessions.map((s) => ({
      ...s,
      exercises: s.exercises.map((e) => ({ ...e })),
    })),
  };
}

type RotationWorkout = Pick<Workout, 'programSessionId' | 'localDate' | 'startedAt'>;

const newestFirst = (a: RotationWorkout, b: RotationWorkout) =>
  b.localDate.localeCompare(a.localDate) || Date.parse(b.startedAt) - Date.parse(a.startedAt);

/**
 * The session that comes next (AC19): the one after the session of the latest workout started from
 * this routine, back to the first after the last. Free sessions and activities do not move it, and a
 * deleted workout is simply not in the list. Null for a routine without sessions.
 */
export function nextProgramSession(
  program: Pick<Program, 'sessions'>,
  workouts: readonly RotationWorkout[],
): ProgramSession | null {
  const { sessions } = program;
  if (sessions.length === 0) return null;
  const ids = sessions.map((s) => s.id);
  const last = workouts
    .filter((w) => w.programSessionId !== null && ids.includes(w.programSessionId))
    .sort(newestFirst)[0];
  if (!last) return sessions[0]!;
  return sessions[(ids.indexOf(last.programSessionId!) + 1) % sessions.length]!;
}

/** The value a set starts with when the exercise was never done (AC18). */
function routinePlaceholder(exercise: ProgramExercise): SetValues {
  switch (exercise.tracking) {
    case 'weight_reps':
    case 'reps':
      return { ...EMPTY_SET, reps: exercise.repsMax };
    case 'duration':
      return { ...EMPTY_SET, durationS: exercise.durationS };
    case 'distance_duration':
      return { ...EMPTY_SET, durationS: exercise.durationS };
  }
}

/**
 * "Empezar" on a routine session (AC18): a live session with its exercises in order and its number of
 * sets. Each set starts with last time's values for that exercise (set by set, the last one repeated),
 * or with the top of the rep range and no weight (the routine's time for time exercises). The workout
 * stores the session's id and the input method `program`.
 */
export function sessionFromProgram(
  session: ProgramSession,
  input: {
    id: string;
    localDate: string;
    startedAt: string;
    stats: ReadonlyMap<string, ExerciseStats>;
    newId: () => string;
    mode?: 'live' | 'manual';
  },
): LiveSession {
  const base = startSession({ ...input, mode: input.mode ?? 'live' });
  return {
    ...base,
    inputMethod: 'program',
    programSessionId: session.id,
    name: session.name,
    exercises: session.exercises.flatMap((e) => {
      if (e.exerciseId === null) return [];
      const stats = input.stats.get(e.exerciseId) ?? null;
      const lastSets = (stats?.last.sets ?? []).map((s) => setForTracking(s, e.tracking));
      const placeholders = Array.from(
        { length: e.sets },
        (_, i) => lastSets[i] ?? lastSets.at(-1) ?? routinePlaceholder(e),
      );
      const live = newLiveExercise({
        exercise: { id: e.exerciseId, label: e.label, tracking: e.tracking },
        stats,
        newId: input.newId,
        placeholders,
      });
      return [e.restS === null ? live : { ...live, restS: e.restS }];
    }),
  };
}

// ── Editor (AC16) ────────────────────────────────────────────────────────────────────────────────

/** An exercise added from the picker: 3 × 8–12, or 3 × 30 s for a time exercise. */
export function programExerciseFor(exercise: {
  id: string;
  label: string;
  tracking: ExerciseTracking;
}): ProgramExercise {
  const timed = exercise.tracking === 'duration';
  const reps = exercise.tracking === 'weight_reps' || exercise.tracking === 'reps';
  return {
    exerciseId: exercise.id,
    label: exercise.label,
    tracking: exercise.tracking,
    sets: 3,
    repsMin: reps ? 8 : null,
    repsMax: reps ? 12 : null,
    durationS: timed ? 30 : null,
    restS: null,
  };
}

export type ProgramTargetPatch = Partial<
  Pick<ProgramExercise, 'sets' | 'repsMin' | 'repsMax' | 'durationS'>
>;

export type ProgramAction =
  | { type: 'rename'; name: string }
  | { type: 'renameSession'; sessionId: string; name: string }
  | { type: 'addSession'; id: string; name: string }
  | { type: 'removeSession'; sessionId: string }
  | { type: 'addExercises'; sessionId: string; exercises: ProgramExercise[] }
  | { type: 'removeExercise'; sessionId: string; index: number }
  | { type: 'moveExercise'; sessionId: string; index: number; offset: -1 | 1 }
  | { type: 'updateExercise'; sessionId: string; index: number; patch: ProgramTargetPatch };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Sets 1–10 and a valid rep range: a min above the max moves the max up, and the other way round. */
function applyPatch(exercise: ProgramExercise, patch: ProgramTargetPatch): ProgramExercise {
  const next = { ...exercise, ...patch };
  next.sets = clamp(Math.round(next.sets), PROGRAM_LIMITS.setsMin, PROGRAM_LIMITS.setsMax);
  if (next.repsMin !== null && next.repsMax !== null && next.repsMin > next.repsMax) {
    if (patch.repsMin !== undefined) next.repsMax = next.repsMin;
    else next.repsMin = next.repsMax;
  }
  return next;
}

const mapSession = (
  draft: ProgramDraft,
  sessionId: string,
  update: (session: ProgramSession) => ProgramSession,
): ProgramDraft => ({
  ...draft,
  sessions: draft.sessions.map((s) => (s.id === sessionId ? update(s) : s)),
});

export function programReducer(draft: ProgramDraft, action: ProgramAction): ProgramDraft {
  switch (action.type) {
    case 'rename':
      return { ...draft, name: action.name.slice(0, PROGRAM_LIMITS.nameMax) };
    case 'renameSession':
      return mapSession(draft, action.sessionId, (s) => ({
        ...s,
        name: action.name.slice(0, PROGRAM_LIMITS.sessionNameMax),
      }));
    case 'addSession':
      if (draft.sessions.length >= PROGRAM_LIMITS.sessionsMax) return draft;
      return {
        ...draft,
        sessions: [...draft.sessions, { id: action.id, name: action.name, exercises: [] }],
      };
    case 'removeSession':
      if (draft.sessions.length <= PROGRAM_LIMITS.sessionsMin) return draft;
      return { ...draft, sessions: draft.sessions.filter((s) => s.id !== action.sessionId) };
    case 'addExercises':
      return mapSession(draft, action.sessionId, (s) => ({
        ...s,
        exercises: [...s.exercises, ...action.exercises].slice(
          0,
          PROGRAM_LIMITS.exercisesPerSessionMax,
        ),
      }));
    case 'removeExercise':
      return mapSession(draft, action.sessionId, (s) => ({
        ...s,
        exercises: s.exercises.filter((_, i) => i !== action.index),
      }));
    case 'moveExercise':
      return mapSession(draft, action.sessionId, (s) => {
        const to = action.index + action.offset;
        if (action.index < 0 || to < 0 || to >= s.exercises.length) return s;
        const exercises = [...s.exercises];
        [exercises[action.index], exercises[to]] = [exercises[to]!, exercises[action.index]!];
        return { ...s, exercises };
      });
    case 'updateExercise':
      return mapSession(draft, action.sessionId, (s) => ({
        ...s,
        exercises: s.exercises.map((e, i) =>
          i === action.index ? applyPatch(e, action.patch) : e,
        ),
      }));
  }
}

/** Whether "Guardar rutina" can send it: a name, named sessions, and at least one exercise. */
export function canSaveProgram(draft: ProgramDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.sessions.length >= PROGRAM_LIMITS.sessionsMin &&
    draft.sessions.every((s) => s.name.trim().length > 0) &&
    draft.sessions.some((s) => s.exercises.some((e) => e.exerciseId !== null))
  );
}
