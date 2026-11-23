import type { SetValues, StressLevel } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import {
  newLiveExercise,
  sessionReducer,
  sessionToRequest,
  startSession,
  type LiveSession,
} from '../training/session';
import { EMPTY_SET } from '../training/sets';
import { adjustSessionForReadiness, canTrainNormally, restoreSessionVolume } from './adjust';
import { dayReadiness } from './readiness';

const TODAY = '2026-11-23';
const STARTED = '2026-11-23T17:00:00.000Z';

let counter = 0;
const newId = () => `id-${++counter}`;

const kg = (weightKg: number, reps: number): SetValues => ({ ...EMPTY_SET, weightKg, reps });

/** A routine session (spec 010 AC18) with one exercise per entry, each with that many sets. */
function routineSession(setCounts: number[], overrides: Partial<LiveSession> = {}): LiveSession {
  const base = startSession({ id: newId(), localDate: TODAY, startedAt: STARTED, mode: 'live' });
  return {
    ...base,
    inputMethod: 'program',
    programSessionId: 'session-a',
    name: 'Rutina A',
    exercises: setCounts.map((sets, i) =>
      newLiveExercise({
        exercise: { id: `exercise-${i}`, label: `Ejercicio ${i}`, tracking: 'weight_reps' },
        stats: null,
        newId,
        placeholders: Array.from({ length: sets }, (_, s) => kg(40 + s, 10 - s)),
      }),
    ),
    ...overrides,
  };
}

const readiness = (sleepMinutes: number | null, stress: StressLevel | null = null) =>
  dayReadiness({ sleepMinutes, stress }, null);
const LOW = readiness(270);
const REDUCED = readiness(330);
const NORMAL = readiness(450, 'normal');
const UNKNOWN = readiness(null);

const setCounts = (session: LiveSession) => session.exercises.map((e) => e.sets.length);

describe('adjustSessionForReadiness (spec 011 AC7)', () => {
  it('removes one set from every exercise with 3 or more sets on a reduced day', () => {
    const adjusted = adjustSessionForReadiness(routineSession([3, 4, 2, 1, 3]), REDUCED, TODAY);
    expect(setCounts(adjusted)).toEqual([2, 3, 2, 1, 2]);
    expect(adjusted.readiness).toMatchObject({ level: 'reduced', headline: 'short_sleep' });
  });

  it('also removes the last exercise on a low day when the session has more than 4', () => {
    const adjusted = adjustSessionForReadiness(routineSession([3, 3, 3, 3, 4]), LOW, TODAY);
    expect(setCounts(adjusted)).toEqual([2, 2, 2, 2]);
    expect(adjusted.exercises.map((e) => e.exerciseId)).toEqual([
      'exercise-0',
      'exercise-1',
      'exercise-2',
      'exercise-3',
    ]);
  });

  it('never leaves a session under 4 exercises or an exercise under 2 sets', () => {
    const adjusted = adjustSessionForReadiness(routineSession([2, 3, 2, 4]), LOW, TODAY);
    expect(setCounts(adjusted)).toEqual([2, 2, 2, 3]);
  });

  it('keeps the prefilled reps and weights of the sets that remain', () => {
    const session = routineSession([4]);
    const adjusted = adjustSessionForReadiness(session, REDUCED, TODAY);
    expect(adjusted.exercises[0]!.sets).toEqual(session.exercises[0]!.sets.slice(0, 3));
  });

  it('changes nothing on a normal or unknown day', () => {
    const session = routineSession([4, 4, 4, 4, 4]);
    expect(adjustSessionForReadiness(session, NORMAL, TODAY)).toBe(session);
    expect(adjustSessionForReadiness(session, UNKNOWN, TODAY)).toBe(session);
  });

  it('never adjusts a past session or one on another day', () => {
    const manual = routineSession([4, 4, 4, 4, 4], { mode: 'manual' });
    expect(adjustSessionForReadiness(manual, LOW, TODAY)).toBe(manual);
    const otherDay = routineSession([4, 4, 4, 4, 4], { localDate: '2026-11-22' });
    expect(adjustSessionForReadiness(otherDay, LOW, TODAY)).toBe(otherDay);
  });

  it('keeps a free session as it is but carries the reason line', () => {
    const free = startSession({ id: newId(), localDate: TODAY, startedAt: STARTED, mode: 'live' });
    const adjusted = adjustSessionForReadiness(free, LOW, TODAY);
    expect(adjusted.exercises).toEqual([]);
    expect(adjusted.readiness).toEqual({
      level: 'low',
      headline: 'very_short_sleep',
      removedSets: [],
      removedExercise: null,
    });
    expect(canTrainNormally(adjusted)).toBe(false);
  });

  it('carries the reason line without "Entrenar normal" when the routine has nothing to remove', () => {
    const adjusted = adjustSessionForReadiness(routineSession([2, 2]), REDUCED, TODAY);
    expect(setCounts(adjusted)).toEqual([2, 2]);
    expect(adjusted.readiness?.headline).toBe('short_sleep');
    expect(canTrainNormally(adjusted)).toBe(false);
  });

  it('is not recorded on the stored workout', () => {
    const session = routineSession([3, 3, 3, 3, 3]);
    const adjusted = adjustSessionForReadiness(session, LOW, TODAY);
    const first = adjusted.exercises[0]!;
    const done = sessionReducer(adjusted, {
      type: 'completeSet',
      uid: first.uid,
      setId: first.sets[0]!.id,
      at: '2026-11-23T17:05:00.000Z',
    });
    const finish = {
      minutes: 60,
      sessionRpe: null,
      name: null,
      recordedAt: STARTED,
      today: TODAY,
      locale: 'es' as const,
    };
    const request = sessionToRequest(done, finish);
    expect(request).not.toBeNull();
    expect(JSON.stringify(request)).not.toContain('readiness');
  });
});

describe('restoreSessionVolume — "Entrenar normal" (spec 011 AC8)', () => {
  it('puts back the removed sets and exercise and hides the line', () => {
    const session = routineSession([3, 4, 2, 3, 3]);
    const adjusted = adjustSessionForReadiness(session, LOW, TODAY);
    expect(canTrainNormally(adjusted)).toBe(true);
    const restored = restoreSessionVolume(adjusted);
    expect(restored.exercises).toEqual(session.exercises);
    expect(restored.readiness).toBeNull();
    expect(canTrainNormally(restored)).toBe(false);
  });

  it('keeps the sets already completed and the sets and exercises the user added', () => {
    const adjusted = adjustSessionForReadiness(routineSession([3, 3, 3, 3, 3]), LOW, TODAY);
    const first = adjusted.exercises[0]!;
    let live = sessionReducer(adjusted, {
      type: 'completeSet',
      uid: first.uid,
      setId: first.sets[0]!.id,
      at: '2026-11-23T17:05:00.000Z',
    });
    live = sessionReducer(live, { type: 'addSet', uid: first.uid, setId: 'added-set' });
    const extra = newLiveExercise({
      exercise: { id: 'extra', label: 'Extra', tracking: 'reps' },
      stats: null,
      newId,
    });
    live = sessionReducer(live, { type: 'addExercises', exercises: [extra] });

    const restored = sessionReducer(live, { type: 'trainNormally' });
    const restoredFirst = restored.exercises[0]!;
    expect(restoredFirst.sets[0]!.completedAt).toBe('2026-11-23T17:05:00.000Z');
    expect(restoredFirst.sets.map((s) => s.id)).toEqual([
      ...first.sets.map((s) => s.id),
      'added-set',
      ...adjusted.readiness!.removedSets[0]!.sets.map((s) => s.id),
    ]);
    expect(restored.exercises.map((e) => e.exerciseId)).toEqual([
      'exercise-0',
      'exercise-1',
      'exercise-2',
      'exercise-3',
      'exercise-4',
      'extra',
    ]);
  });

  it('skips the sets of an exercise the user removed meanwhile', () => {
    const adjusted = adjustSessionForReadiness(routineSession([3, 3, 3, 3]), REDUCED, TODAY);
    const removed = sessionReducer(adjusted, {
      type: 'removeExercise',
      uid: adjusted.exercises[1]!.uid,
    });
    const restored = restoreSessionVolume(removed);
    expect(setCounts(restored)).toEqual([3, 3, 3]);
  });

  it('does nothing on a session that was not adjusted', () => {
    const session = routineSession([3, 3]);
    expect(restoreSessionVolume(session)).toBe(session);
  });
});

describe('a check-in saved after the session started (spec 011 AC10)', () => {
  it('leaves the started session alone: the adjustment happens only at start', () => {
    const started = adjustSessionForReadiness(routineSession([3, 3, 3, 3, 3]), NORMAL, TODAY);
    // A later check-in gives a low readiness; the running session keeps its exercises and sets…
    const later = LOW;
    expect(later.level).toBe('low');
    expect(setCounts(started)).toEqual([3, 3, 3, 3, 3]);
    expect(started.readiness).toBeUndefined();
    // …while the next session started today uses it.
    expect(
      setCounts(adjustSessionForReadiness(routineSession([3, 3, 3, 3, 3]), later, TODAY)),
    ).toEqual([2, 2, 2, 2]);
  });
});
