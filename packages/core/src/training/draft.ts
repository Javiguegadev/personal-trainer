import {
  WORKOUT_DRAFT_LIMITS,
  WORKOUT_LIMITS,
  type Exercise,
  type ExerciseStats,
  type ExerciseTracking,
  type Locale,
  type Program,
  type ProgramSession,
  type SetValues,
  type WorkoutDraft,
  type WorkoutDraftActivity,
  type WorkoutDraftResponse,
  type WorkoutDraftSet,
  type WorkoutReading,
  type WorkoutReadingActivity,
  type WorkoutReadingSetGroup,
} from '@pt/contracts';
import { addDays } from '../dates';
import { lbToKg, roundTo } from '../units';
import { newLiveExercise, startSession, type LiveExercise, type LiveSession } from './session';
import { isWeightJump, setForTracking, setMatchesTracking } from './sets';
import { labelFor } from './write';

/**
 * The workout sentence shortcut (spec 012). The model read the sentence and chose exercise refs; this
 * keeps only the refs the API handed out in that request, checks every value against the exercise's
 * tracking and the limits of spec 009, and turns the reading into an editable draft. Nothing here is
 * saved: the user saves the draft as an ordinary workout.
 */

const START_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A whole number within the limits, or null when it was not said or is not a usable number. */
function intIn(value: number | null, min: number, max: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  return n >= min && n <= max ? n : null;
}

interface Checked {
  value: number | null;
  clamped: boolean;
}

/** A positive value said for a set: rounded, then clamped to the limits (AC8). Zero is "not said". */
function setValue(value: number | null, max: number, decimals: number): Checked {
  if (value === null || !Number.isFinite(value)) return { value: null, clamped: false };
  const rounded = roundTo(value, decimals);
  if (rounded <= 0) return { value: null, clamped: false };
  return { value: clamp(rounded, 0, max), clamped: rounded > max };
}

/**
 * The values of one set group, checked: pounds become kg with 2 decimals, whole reps, seconds and
 * metres, clamped to the limits; with a tracking, only the values it uses (extra weight on a reps
 * exercise kept), and `clamped` only counts the values kept.
 */
function checkGroup(group: WorkoutReadingSetGroup, tracking: ExerciseTracking | null) {
  const kg =
    group.weight === null ? null : group.weightUnit === 'lb' ? lbToKg(group.weight) : group.weight;
  const checked: Record<keyof SetValues, Checked> = {
    reps: setValue(group.reps, WORKOUT_LIMITS.repsMax, 0),
    weightKg: setValue(kg, WORKOUT_LIMITS.weightKgMax, 2),
    durationS: setValue(group.durationS, WORKOUT_LIMITS.durationSMax, 0),
    distanceM: setValue(group.distanceM, WORKOUT_LIMITS.distanceMMax, 0),
  };
  const all: SetValues = {
    reps: checked.reps.value,
    weightKg: checked.weightKg.value,
    durationS: checked.durationS.value,
    distanceM: checked.distanceM.value,
  };
  const values = tracking ? setForTracking(all, tracking) : all;
  const clamped = (Object.keys(checked) as (keyof SetValues)[]).some(
    (field) => checked[field].clamped && values[field] !== null,
  );
  return { values, clamped };
}

/** Set groups expanded into sets ("4x8" is 4 sets), at most 20 (AC8). */
function expandSets(
  groups: readonly WorkoutReadingSetGroup[],
  tracking: ExerciseTracking | null,
): WorkoutDraftSet[] {
  const sets: WorkoutDraftSet[] = [];
  for (const group of groups) {
    const count = Number.isFinite(group.count) ? Math.max(1, Math.round(group.count)) : 1;
    const set = checkGroup(group, tracking);
    for (let i = 0; i < count && sets.length < WORKOUT_LIMITS.setsPerExerciseMax; i++) {
      sets.push({ values: { ...set.values }, clamped: set.clamped });
    }
  }
  return sets;
}

const mentionOf = (words: string) => words.trim().slice(0, WORKOUT_DRAFT_LIMITS.mentionMax);

function draftActivity(said: WorkoutReadingActivity): WorkoutDraftActivity {
  return {
    activity: said.activity,
    mention: mentionOf(said.mention),
    minutes: intIn(said.minutes, WORKOUT_LIMITS.activityMinutesMin, WORKOUT_LIMITS.minutesMax),
    sessionRpe: intIn(said.sessionRpe, WORKOUT_LIMITS.rpeMin, WORKOUT_LIMITS.rpeMax),
    distanceDropped: said.distanceSaid,
  };
}

/**
 * The editable draft of a sentence (AC3–AC9, AC15). `refs` are the exercises the API showed the model
 * in this request (`e12`, `u3` → exercise); any other ref becomes an unresolved mention. `today` is
 * the user's date: the day said ("ayer") counts back from it and must be today or one of the 6 days
 * before, else the draft keeps `localDate`, the day of the screen, and marks the day.
 */
export function workoutDraft(
  reading: WorkoutReading,
  refs: ReadonlyMap<string, Exercise>,
  today: string,
  localDate: string,
): WorkoutDraftResponse {
  if (reading.status !== 'ok') return { status: 'unreadable', reason: reading.status };

  const exercises: WorkoutDraft['exercises'] = [];
  const unresolved: WorkoutDraft['unresolved'] = [];
  for (const said of reading.gym?.exercises ?? []) {
    if (exercises.length + unresolved.length >= WORKOUT_DRAFT_LIMITS.exercisesMax) break;
    const mention = mentionOf(said.mention);
    const exercise = said.exerciseRef === null ? undefined : refs.get(said.exerciseRef);
    if (exercise) {
      exercises.push({
        exercise,
        mention: mention || exercise.nameEs,
        sets: expandSets(said.setGroups, exercise.tracking),
      });
    } else if (mention) {
      unresolved.push({
        mention,
        sets: expandSets(said.setGroups, null),
        position: exercises.length,
      });
    }
  }

  const activities = reading.activities.map(draftActivity);
  const isGym = exercises.length + unresolved.length > 0;
  const [first, ...others] = activities;
  if (!isGym && !first) return { status: 'unreadable', reason: 'unclear' };
  const extras = isGym ? activities : others;

  const daysAgo = reading.daysAgo;
  const dayFits =
    daysAgo !== null &&
    Number.isInteger(daysAgo) &&
    daysAgo >= 0 &&
    daysAgo <= WORKOUT_LIMITS.pastDaysUi;
  const startTime = reading.startTime?.trim() ?? null;

  return {
    status: 'ok',
    draft: {
      localDate: dayFits ? addDays(today, -daysAgo) : localDate,
      startTime: startTime && START_TIME.test(startTime) ? startTime : null,
      dayDropped: daysAgo !== null && !dayFits,
      minutes: isGym
        ? intIn(reading.gym?.minutes ?? null, WORKOUT_LIMITS.minutesMin, WORKOUT_LIMITS.minutesMax)
        : null,
      sessionRpe: isGym
        ? intIn(reading.gym?.sessionRpe ?? null, WORKOUT_LIMITS.rpeMin, WORKOUT_LIMITS.rpeMax)
        : null,
      exercises,
      unresolved,
      activity: isGym ? null : (first ?? null),
      extraActivities: extras.slice(0, WORKOUT_DRAFT_LIMITS.extraActivitiesMax),
      painMentioned: reading.painMentioned,
      ignored: Math.max(0, extras.length - WORKOUT_DRAFT_LIMITS.extraActivitiesMax),
    },
  };
}

/**
 * The card of an exercise of the draft (AC10, AC11), also for a mention the user resolved (AC7). A set
 * with every value its tracking needs is completed at `completedAt`; a set missing one is left
 * uncompleted and marked, with last time's set as its placeholder; a clamped set, or one more than
 * 50 % above the heaviest weight, is left uncompleted so ✓ checks it as a typed one. An exercise said
 * without sets gets the sets of last time, uncompleted, as when added from the picker.
 */
export function liveExerciseFromDraft(input: {
  exercise: { id: string; label: string; tracking: ExerciseTracking };
  sets: readonly WorkoutDraftSet[];
  stats: ExerciseStats | null;
  newId: () => string;
  completedAt: string;
}): LiveExercise {
  const base = newLiveExercise({
    exercise: input.exercise,
    stats: input.stats,
    newId: input.newId,
  });
  if (input.sets.length === 0) return base;
  const { tracking } = input.exercise;
  const last = base.last?.sets ?? [];
  const heaviest = input.stats?.bests.heaviestKg?.value ?? null;
  return {
    ...base,
    sets: input.sets.slice(0, WORKOUT_LIMITS.setsPerExerciseMax).map((set, i) => {
      const values = setForTracking(set.values, tracking);
      const complete = setMatchesTracking(values, tracking);
      const done = complete && !set.clamped && !isWeightJump(values.weightKg, heaviest);
      return {
        id: input.newId(),
        values,
        placeholder: last[i] ?? last.at(-1) ?? null,
        completedAt: done ? input.completedAt : null,
        restS: null,
        mark: set.clamped ? 'review' : complete ? null : 'incomplete',
      };
    }),
  };
}

/**
 * The routine session a draft counts as (AC13): one whose exercises the draft holds at least half of,
 * the one with most in common, and on a tie the first from `nextSessionId` on in rotation order.
 */
export function matchRoutineSession(
  exerciseIds: readonly string[],
  program: Pick<Program, 'sessions'>,
  nextSessionId: string | null,
): ProgramSession | null {
  const done = new Set(exerciseIds);
  const start = Math.max(
    0,
    program.sessions.findIndex((s) => s.id === nextSessionId),
  );
  const rotation = [...program.sessions.slice(start), ...program.sessions.slice(0, start)];
  let best: { session: ProgramSession; common: number } | null = null;
  for (const session of rotation) {
    const ids = new Set(session.exercises.flatMap((e) => (e.exerciseId ? [e.exerciseId] : [])));
    if (ids.size === 0) continue;
    const common = [...ids].filter((id) => done.has(id)).length;
    if (common * 2 < ids.size) continue;
    if (!best || common > best.common) best = { session, common };
  }
  return best?.session ?? null;
}

/**
 * The session editor of a gym draft (AC10–AC13): a past session (`manual`) in the `text` input method,
 * on the draft's day. `startedAt` comes from the device, which knows the time zone (the time said,
 * else the default start of a past session). With a routine, a matching session links the draft to it,
 * on by default, so saving moves the rotation.
 */
export function draftToSession(
  draft: WorkoutDraft,
  input: {
    id: string;
    startedAt: string;
    stats: ReadonlyMap<string, ExerciseStats>;
    newId: () => string;
    locale: Locale;
    routine?: { program: Pick<Program, 'sessions'>; nextSessionId: string | null };
  },
): LiveSession {
  const exercises = draft.exercises.map((entry) =>
    liveExerciseFromDraft({
      exercise: {
        id: entry.exercise.id,
        label: labelFor(entry.exercise, input.locale),
        tracking: entry.exercise.tracking,
      },
      sets: entry.sets,
      stats: input.stats.get(entry.exercise.id) ?? null,
      newId: input.newId,
      completedAt: input.startedAt,
    }),
  );
  const routineSessionId = input.routine
    ? (matchRoutineSession(
        exercises.map((e) => e.exerciseId),
        input.routine.program,
        input.routine.nextSessionId,
      )?.id ?? null)
    : null;
  return {
    ...startSession({
      id: input.id,
      localDate: draft.localDate,
      startedAt: input.startedAt,
      mode: 'manual',
    }),
    inputMethod: 'text',
    programSessionId: routineSessionId,
    minutes: draft.minutes,
    sessionRpe: draft.sessionRpe,
    exercises,
    textDraft: {
      unresolved: draft.unresolved,
      extraActivities: draft.extraActivities,
      painMentioned: draft.painMentioned,
      ignored: draft.ignored,
      dayDropped: draft.dayDropped,
      routineSessionId,
    },
  };
}
