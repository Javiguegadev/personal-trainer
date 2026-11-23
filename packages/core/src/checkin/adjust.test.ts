import type { SetValues, StressLevel } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { sessionFromProgram } from '../training/program';
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
    for (const readiness of [NORMAL, UNKNOWN]) {
      const evaluated = adjustSessionForReadiness(session, readiness, TODAY);
      expect(evaluated.exercises).toBe(session.exercises);
      // Marked as evaluated, so a later readiness cannot cut it (AC10).
      expect(evaluated.readiness).toBeNull();
    }
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
  it('does not cut a session started on a normal day when a low check-in arrives later', () => {
    const started = adjustSessionForReadiness(routineSession([3, 3, 3, 3, 3]), NORMAL, TODAY);
    expect(adjustSessionForReadiness(started, LOW, TODAY)).toBe(started);
    // The next session started today uses the new readiness.
    expect(
      setCounts(adjustSessionForReadiness(routineSession([3, 3, 3, 3, 3]), LOW, TODAY)),
    ).toEqual([2, 2, 2, 2]);
  });

  it('cuts a session only once', () => {
    const once = adjustSessionForReadiness(routineSession([4, 4, 4, 4, 5]), LOW, TODAY);
    expect(adjustSessionForReadiness(once, LOW, TODAY)).toBe(once);
    expect(adjustSessionForReadiness(once, REDUCED, TODAY)).toBe(once);
  });

  it('never cuts a session with a completed set, even one started before spec 011', () => {
    const session = routineSession([4, 4, 4, 4, 5]);
    const first = session.exercises[0]!;
    const done = sessionReducer(session, {
      type: 'completeSet',
      uid: first.uid,
      setId: first.sets[0]!.id,
      at: '2026-11-23T17:05:00.000Z',
    });
    expect(adjustSessionForReadiness(done, LOW, TODAY)).toBe(done);
  });
});

describe('restoreSessionVolume limits (domain review of spec 011)', () => {
  it('does not double an exercise the user added again from the picker', () => {
    const adjusted = adjustSessionForReadiness(routineSession([3, 3, 3, 3, 3]), LOW, TODAY);
    const dropped = adjusted.readiness!.removedExercise!.exercise;
    const again = newLiveExercise({
      exercise: { id: dropped.exerciseId, label: dropped.label, tracking: dropped.tracking },
      stats: null,
      newId,
    });
    const live = sessionReducer(adjusted, { type: 'addExercises', exercises: [again] });
    const restored = restoreSessionVolume(live);
    expect(restored.exercises.filter((e) => e.exerciseId === dropped.exerciseId)).toHaveLength(1);
  });

  it('keeps the sets of an exercise within the workout limit', () => {
    const adjusted = adjustSessionForReadiness(routineSession([3, 3, 3, 3]), REDUCED, TODAY);
    const first = adjusted.exercises[0]!;
    let live = adjusted;
    for (let i = first.sets.length; i < 20; i++) {
      live = sessionReducer(live, { type: 'addSet', uid: first.uid, setId: `extra-${i}` });
    }
    expect(live.exercises[0]!.sets).toHaveLength(20);
    expect(restoreSessionVolume(live).exercises[0]!.sets).toHaveLength(20);
  });
});

describe('the adjustment only ever removes (spec 011 Safety "Never more", "Minimum session")', () => {
  it('keeps every exercise at min(sets, 2) or more and the session at min(exercises, 4) or more', () => {
    const levels = [LOW, REDUCED, NORMAL, UNKNOWN];
    for (let count = 0; count <= 8; count++) {
      for (let sets = 1; sets <= 6; sets++) {
        const counts = Array.from({ length: count }, (_, i) => ((sets + i) % 6) + 1);
        for (const readiness of levels) {
          const before = routineSession(counts);
          const after = adjustSessionForReadiness(before, readiness, TODAY);
          const total = (s: LiveSession) => setCounts(s).reduce((a, b) => a + b, 0);
          expect(total(after)).toBeLessThanOrEqual(total(before));
          expect(after.exercises.length).toBeGreaterThanOrEqual(Math.min(count, 4));
          after.exercises.forEach((exercise, i) => {
            expect(exercise.sets.length).toBeGreaterThanOrEqual(Math.min(counts[i]!, 2));
          });
          // "Entrenar normal" gives back exactly the session it started from.
          expect(restoreSessionVolume(after).exercises).toEqual(before.exercises);
        }
      }
    }
  });

  it('handles a routine session without exercises', () => {
    const empty = routineSession([]);
    const adjusted = adjustSessionForReadiness(empty, LOW, TODAY);
    expect(adjusted.exercises).toEqual([]);
    expect(canTrainNormally(adjusted)).toBe(false);
  });

  it('works on the session sessionFromProgram builds, without the exercises that left the catalog', () => {
    const program = {
      id: 'session-a',
      name: 'Rutina A',
      exercises: [0, 1, 2, 3, 4].map((i) => ({
        exerciseId: i === 2 ? null : `exercise-${i}`,
        label: `Ejercicio ${i}`,
        tracking: 'weight_reps' as const,
        sets: 3,
        repsMin: 8,
        repsMax: 12,
        restS: null,
        weightKg: null,
        durationS: null,
      })),
    };
    const live = sessionFromProgram(program as never, {
      id: newId(),
      localDate: TODAY,
      startedAt: STARTED,
      stats: new Map(),
      newId,
    });
    expect(live.exercises).toHaveLength(4);
    // Four exercises left: a low day removes a set from each and keeps them all.
    expect(setCounts(adjustSessionForReadiness(live, LOW, TODAY))).toEqual([2, 2, 2, 2]);
  });
});
