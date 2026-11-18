import type { ExerciseStats, Workout, WorkoutSet } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { NO_BESTS } from './bests';
import { EMPTY_SET } from './sets';
import {
  canCompleteSet,
  editWorkout,
  elapsedMinutes,
  hasCompletedSet,
  isStaleSession,
  liveSetRecords,
  newLiveExercise,
  repeatWorkout,
  restRemaining,
  sessionReducer,
  sessionSummary,
  sessionToRequest,
  staleEndTime,
  startSession,
  type LiveSession,
  type SessionAction,
} from './session';

const T0 = '2026-11-18T18:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const wset = (values: Partial<WorkoutSet>, setNumber = 1): WorkoutSet => ({
  ...EMPTY_SET,
  restS: null,
  setNumber,
  ...values,
});

const benchStats: ExerciseStats = {
  exerciseId: 'bench',
  last: {
    workoutId: 'w0',
    localDate: '2026-10-12',
    sets: [
      wset({ reps: 8, weightKg: 60, restS: 120 }, 1),
      wset({ reps: 8, weightKg: 60 }, 2),
      wset({ reps: 7, weightKg: 60 }, 3),
    ],
  },
  bests: {
    ...NO_BESTS,
    heaviestKg: { value: 60, localDate: '2026-10-12' },
    oneRepMaxKg: { value: 76, localDate: '2026-10-12' },
  },
  lastDoneAt: '2026-10-12T18:00:00.000Z',
};

const bench = { id: 'bench', label: 'Press de banca', tracking: 'weight_reps' as const };
const plank = { id: 'plank', label: 'Plancha', tracking: 'duration' as const };

function liveWithBench(): LiveSession {
  const newId = ids();
  const session = startSession({ id: 'w1', localDate: '2026-11-18', startedAt: T0, mode: 'live' });
  return sessionReducer(session, {
    type: 'addExercises',
    exercises: [newLiveExercise({ exercise: bench, stats: benchStats, newId })],
  });
}

const run = (session: LiveSession, ...actions: SessionAction[]) =>
  actions.reduce(sessionReducer, session);

describe('starting and adding exercises (AC6, AC7)', () => {
  it('prefills as many sets as last time with last time values, and the last rest', () => {
    const exercise = liveWithBench().exercises[0]!;
    expect(exercise.sets).toHaveLength(3);
    expect(exercise.sets[2]?.placeholder).toEqual({ ...EMPTY_SET, reps: 7, weightKg: 60 });
    expect(exercise.sets[0]?.values).toEqual(EMPTY_SET);
    expect(exercise.restS).toBe(120);
    expect(exercise.last?.localDate).toBe('2026-10-12');
  });

  it('gives 3 empty sets and 90 s of rest to an exercise never done', () => {
    const exercise = newLiveExercise({ exercise: plank, stats: null, newId: ids() });
    expect(exercise.sets.map((s) => s.placeholder)).toEqual([null, null, null]);
    expect(exercise.restS).toBe(90);
    expect(exercise.last).toBeNull();
  });

  it('reorders and removes exercises', () => {
    const newId = ids();
    let session = liveWithBench();
    session = sessionReducer(session, {
      type: 'addExercises',
      exercises: [newLiveExercise({ exercise: plank, stats: null, newId: () => `p-${newId()}` })],
    });
    const [first, second] = session.exercises;
    session = sessionReducer(session, { type: 'moveExercise', uid: second!.uid, offset: -1 });
    expect(session.exercises.map((e) => e.exerciseId)).toEqual(['plank', 'bench']);
    expect(sessionReducer(session, { type: 'moveExercise', uid: second!.uid, offset: -1 })).toBe(
      session,
    );
    session = sessionReducer(session, { type: 'removeExercise', uid: first!.uid });
    expect(session.exercises.map((e) => e.exerciseId)).toEqual(['plank']);
  });
});

describe('sets (AC8)', () => {
  it('completes a set with the placeholder when nothing was typed', () => {
    const session = liveWithBench();
    const { uid, sets } = session.exercises[0]!;
    const next = sessionReducer(session, {
      type: 'completeSet',
      uid,
      setId: sets[0]!.id,
      at: at(5),
    });
    expect(next.exercises[0]?.sets[0]).toMatchObject({
      values: { ...EMPTY_SET, reps: 8, weightKg: 60 },
      completedAt: at(5),
    });
  });

  it('uses typed values over the placeholder', () => {
    const session = liveWithBench();
    const { uid, sets } = session.exercises[0]!;
    const next = run(
      session,
      { type: 'updateSet', uid, setId: sets[0]!.id, values: { weightKg: 62.5 } },
      { type: 'completeSet', uid, setId: sets[0]!.id, at: at(5) },
    );
    expect(next.exercises[0]?.sets[0]?.values).toEqual({ ...EMPTY_SET, reps: 8, weightKg: 62.5 });
  });

  it('cannot complete a set without the values its tracking needs', () => {
    const plankIds = ids();
    const exercise = newLiveExercise({
      exercise: plank,
      stats: null,
      newId: () => `p-${plankIds()}`,
    });
    expect(canCompleteSet(exercise.sets[0]!, 'duration')).toBe(false);
    const session = sessionReducer(liveWithBench(), {
      type: 'addExercises',
      exercises: [exercise],
    });
    const next = sessionReducer(session, {
      type: 'completeSet',
      uid: exercise.uid,
      setId: exercise.sets[0]!.id,
      at: at(1),
    });
    expect(next).toBe(session);
  });

  it('adds a set copying the last one, un-completes and removes sets', () => {
    const session = liveWithBench();
    const { uid, sets } = session.exercises[0]!;
    let next = run(
      session,
      { type: 'addSet', uid, setId: 's4' },
      { type: 'completeSet', uid, setId: 's4', at: at(9) },
    );
    expect(next.exercises[0]?.sets[3]?.values).toEqual({ ...EMPTY_SET, reps: 7, weightKg: 60 });
    next = sessionReducer(next, { type: 'uncompleteSet', uid, setId: 's4' });
    expect(next.exercises[0]?.sets[3]?.completedAt).toBeNull();
    expect(next.rest).toBeNull();
    next = sessionReducer(next, { type: 'removeSet', uid, setId: sets[0]!.id });
    expect(next.exercises[0]?.sets).toHaveLength(3);
  });
});

describe('rest timer (AC9)', () => {
  const completed = () => {
    const session = liveWithBench();
    const { uid, sets } = session.exercises[0]!;
    return sessionReducer(session, { type: 'completeSet', uid, setId: sets[0]!.id, at: at(5) });
  };

  it('starts with the exercise rest and counts from timestamps', () => {
    const session = completed();
    expect(session.rest?.durationS).toBe(120);
    expect(restRemaining(session.rest, at(5))).toBe(120);
    expect(restRemaining(session.rest, at(6))).toBe(60);
    expect(restRemaining(session.rest, at(30))).toBe(0);
    expect(restRemaining(null, at(6))).toBe(0);
  });

  it('adjusts by 15 s, keeps it for the next set and the log, and skips', () => {
    let session = run(
      completed(),
      { type: 'adjustRest', deltaS: 15 },
      { type: 'adjustRest', deltaS: 15 },
    );
    expect(session.rest?.durationS).toBe(150);
    expect(session.exercises[0]?.restS).toBe(150);
    expect(session.exercises[0]?.sets[0]?.restS).toBe(150);
    session = sessionReducer(session, { type: 'adjustRest', deltaS: -1000 });
    expect(session.rest?.durationS).toBe(0);
    expect(sessionReducer(session, { type: 'skipRest' }).rest).toBeNull();
  });

  it('has no timer when logging a past session (AC17)', () => {
    const session = { ...liveWithBench(), mode: 'manual' as const };
    const { uid, sets } = session.exercises[0]!;
    const next = sessionReducer(session, {
      type: 'completeSet',
      uid,
      setId: sets[0]!.id,
      at: at(5),
    });
    expect(next.rest).toBeNull();
    expect(next.exercises[0]?.sets[0]?.restS).toBeNull();
  });
});

describe('records (AC10)', () => {
  it('flags a set that beats the bests before the session or an earlier set of it', () => {
    const session = liveWithBench();
    const { uid, sets } = session.exercises[0]!;
    const next = run(
      session,
      { type: 'updateSet', uid, setId: sets[0]!.id, values: { weightKg: 62.5 } },
      { type: 'completeSet', uid, setId: sets[0]!.id, at: at(5) },
      { type: 'updateSet', uid, setId: sets[1]!.id, values: { weightKg: 62.5 } },
      { type: 'completeSet', uid, setId: sets[1]!.id, at: at(8) },
    );
    const exercise = next.exercises[0]!;
    expect(liveSetRecords(exercise, sets[0]!.id, next.localDate)).toEqual([
      { kind: 'heaviestKg', value: 62.5 },
      { kind: 'oneRepMaxKg', value: 79 },
    ]);
    expect(liveSetRecords(exercise, sets[1]!.id, next.localDate)).toEqual([]);
    expect(liveSetRecords(exercise, sets[2]!.id, next.localDate)).toEqual([]);
  });

  it('shows no badge in the first session of an exercise', () => {
    const exercise = newLiveExercise({ exercise: bench, stats: null, newId: ids() });
    let session = sessionReducer(liveWithBench(), { type: 'addExercises', exercises: [exercise] });
    for (const [i, kg] of [40, 50].entries()) {
      session = run(
        session,
        {
          type: 'updateSet',
          uid: exercise.uid,
          setId: exercise.sets[i]!.id,
          values: { weightKg: kg, reps: 8 },
        },
        { type: 'completeSet', uid: exercise.uid, setId: exercise.sets[i]!.id, at: at(i) },
      );
    }
    const card = session.exercises[1]!;
    expect(liveSetRecords(card, card.sets[1]!.id, session.localDate)).toEqual([]);
  });
});

describe('finishing (AC12)', () => {
  const finished = () => {
    const session = liveWithBench();
    const { uid, sets } = session.exercises[0]!;
    return run(
      sessionReducer(session, {
        type: 'addExercises',
        exercises: [newLiveExercise({ exercise: plank, stats: null, newId: () => 'plank-x' })],
      }),
      { type: 'completeSet', uid, setId: sets[0]!.id, at: at(5) },
      { type: 'updateSet', uid, setId: sets[1]!.id, values: { weightKg: 62.5 } },
      { type: 'completeSet', uid, setId: sets[1]!.id, at: at(9) },
    );
  };

  it('summarizes minutes, sets, volume and records', () => {
    expect(sessionSummary(finished(), at(55))).toEqual({
      minutes: 55,
      exercises: 1,
      sets: 2,
      volumeKg: 980,
      records: 1,
    });
  });

  it('sends only completed sets and leaves out exercises without one', () => {
    const request = sessionToRequest(finished(), {
      minutes: 55,
      sessionRpe: 7,
      name: '  Pecho ',
      recordedAt: at(56),
      today: '2026-11-18',
      locale: 'es',
    });
    expect(request).toMatchObject({
      kind: 'gym',
      name: 'Pecho',
      minutes: 55,
      inputMethod: 'live',
      startedAt: T0,
      exercises: [
        {
          exerciseId: 'bench',
          sets: [
            { ...EMPTY_SET, reps: 8, weightKg: 60, restS: 120 },
            { ...EMPTY_SET, reps: 8, weightKg: 62.5, restS: 120 },
          ],
        },
      ],
    });
    expect(hasCompletedSet(finished())).toBe(true);
    const empty = startSession({ id: 'w', localDate: '2026-11-18', startedAt: T0, mode: 'live' });
    expect(hasCompletedSet(empty)).toBe(false);
    expect(
      sessionToRequest(empty, {
        minutes: 1,
        sessionRpe: null,
        name: null,
        recordedAt: T0,
        today: '2026-11-18',
        locale: 'es',
      }),
    ).toBeNull();
  });

  it('falls back to the span of the sets when the clock changed', () => {
    const session = finished();
    expect(elapsedMinutes(session, at(-30))).toBe(4);
    expect(elapsedMinutes(session, at(2000))).toBe(4);
    const empty = startSession({ id: 'w', localDate: '2026-11-18', startedAt: T0, mode: 'live' });
    expect(elapsedMinutes(empty, at(-30))).toBeNull();
    expect(elapsedMinutes(empty, at(0.2))).toBe(1);
  });
});

describe('stale session (AC13)', () => {
  it('asks after 6 hours, proposing the last completed set as the end', () => {
    const session = liveWithBench();
    const { uid, sets } = session.exercises[0]!;
    const done = sessionReducer(session, {
      type: 'completeSet',
      uid,
      setId: sets[0]!.id,
      at: at(40),
    });
    expect(isStaleSession(done, at(6 * 60))).toBe(false);
    expect(isStaleSession(done, at(6 * 60 + 1))).toBe(true);
    expect(isStaleSession({ ...done, mode: 'manual' }, at(1000))).toBe(false);
    expect(staleEndTime(done)).toBe(at(40));
    expect(staleEndTime(session)).toBe(T0);
  });
});

const savedWorkout: Workout = {
  id: 'w-old',
  localDate: '2026-11-10',
  kind: 'gym',
  activity: null,
  name: 'Pierna',
  startedAt: '2026-11-10T18:00:00.000Z',
  minutes: 50,
  sessionRpe: 8,
  inputMethod: 'live',
  recordedAt: '2026-11-10T19:00:00.000Z',
  exercises: [
    {
      exerciseId: 'bench',
      label: 'Press de banca',
      tracking: 'weight_reps',
      sets: [wset({ reps: 10, weightKg: 50, restS: 90 }, 1), wset({ reps: 10, weightKg: 50 }, 2)],
    },
    { exerciseId: null, label: 'Borrado', tracking: 'reps', sets: [wset({ reps: 5 })] },
  ],
};

describe('repeat (AC18) and edit (AC19)', () => {
  it('repeats with the same exercises and sets, prefilled with that session', () => {
    const session = repeatWorkout(savedWorkout, {
      id: 'w-new',
      localDate: '2026-11-18',
      startedAt: T0,
      stats: new Map([['bench', benchStats]]),
      newId: ids(),
    });
    expect(session).toMatchObject({
      id: 'w-new',
      inputMethod: 'repeat',
      mode: 'live',
      name: 'Pierna',
    });
    expect(session.exercises).toHaveLength(1);
    expect(session.exercises[0]?.sets.map((s) => s.placeholder?.weightKg)).toEqual([50, 50]);
    expect(session.exercises[0]?.bestsBefore).toEqual(benchStats.bests);
  });

  it('opens a saved session with its sets completed and its minutes kept', () => {
    const session = editWorkout(savedWorkout, { stats: new Map(), newId: ids() });
    expect(session).toMatchObject({ id: 'w-old', mode: 'edit', minutes: 50, sessionRpe: 8 });
    expect(session.exercises[0]?.sets.every((s) => s.completedAt !== null)).toBe(true);
    expect(sessionSummary(session, at(0)).minutes).toBe(50);
    const request = sessionToRequest(session, {
      minutes: 50,
      sessionRpe: 8,
      name: 'Pierna',
      recordedAt: at(1),
      today: '2026-11-18',
      locale: 'es',
    });
    expect(request?.localDate).toBe('2026-11-10');
    expect(request?.exercises[0]?.sets).toEqual([
      { ...EMPTY_SET, reps: 10, weightKg: 50, restS: 90 },
      { ...EMPTY_SET, reps: 10, weightKg: 50, restS: null },
    ]);
  });
});
