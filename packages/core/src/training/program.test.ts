import {
  ProgramUpsertRequestSchema,
  type ExerciseStats,
  type ProgramExercise,
  type ProgramSession,
} from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { NO_BESTS } from './bests';
import {
  canSaveProgram,
  nextProgramSession,
  programExerciseFor,
  programReducer,
  programToDraft,
  programToRequest,
  sessionFromProgram,
} from './program';
import type { ProgramDraft } from './routine';
import { EMPTY_SET } from './sets';
import { sessionToRequest } from './session';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = () => {
  let n = 100;
  return () => uuid(++n);
};

const bench: ProgramExercise = {
  exerciseId: uuid(1),
  label: 'Press de banca',
  tracking: 'weight_reps',
  sets: 3,
  repsMin: 8,
  repsMax: 12,
  durationS: null,
  restS: 120,
};
const plank: ProgramExercise = {
  exerciseId: uuid(2),
  label: 'Plancha',
  tracking: 'duration',
  sets: 2,
  repsMin: null,
  repsMax: null,
  durationS: 30,
  restS: null,
};
const pushups: ProgramExercise = {
  ...bench,
  exerciseId: uuid(3),
  label: 'Flexiones',
  tracking: 'reps',
};

const A: ProgramSession = { id: uuid(11), name: 'Rutina A', exercises: [bench, plank] };
const B: ProgramSession = { id: uuid(12), name: 'Rutina B', exercises: [pushups] };
const C: ProgramSession = { id: uuid(13), name: 'Rutina C', exercises: [bench] };
const program = { sessions: [A, B, C] };

const workout = (programSessionId: string | null, localDate: string, time = '18:00') => ({
  programSessionId,
  localDate,
  startedAt: `${localDate}T${time}:00+01:00`,
});

describe('nextProgramSession (spec 010 AC19)', () => {
  it('starts with the first session', () => {
    expect(nextProgramSession(program, [])).toBe(A);
  });

  it('follows the session of the latest routine workout', () => {
    expect(nextProgramSession(program, [workout(A.id, '2026-11-16')])).toBe(B);
    expect(
      nextProgramSession(program, [
        workout(A.id, '2026-11-16'),
        workout(B.id, '2026-11-18', '07:00'),
        workout(A.id, '2026-11-17'),
      ]),
    ).toBe(C);
  });

  it('does not move with a free session or an activity in between', () => {
    expect(
      nextProgramSession(program, [workout(A.id, '2026-11-16'), workout(null, '2026-11-18')]),
    ).toBe(B);
  });

  it('goes back to the first after the last', () => {
    expect(nextProgramSession(program, [workout(C.id, '2026-11-16')])).toBe(A);
  });

  it('follows the last remaining routine workout when one is deleted', () => {
    const log = [workout(A.id, '2026-11-16'), workout(B.id, '2026-11-18')];
    expect(nextProgramSession(program, log)).toBe(C);
    expect(nextProgramSession(program, log.slice(0, 1))).toBe(B);
  });

  it('orders by date first, then by start time', () => {
    expect(
      nextProgramSession(program, [
        workout(B.id, '2026-11-17', '20:00'),
        workout(A.id, '2026-11-18', '06:00'),
      ]),
    ).toBe(B);
    expect(
      nextProgramSession(program, [
        workout(B.id, '2026-11-18', '20:00'),
        workout(A.id, '2026-11-18', '06:00'),
      ]),
    ).toBe(C);
  });

  it('ignores sessions of another routine, and has nothing for a routine without sessions', () => {
    expect(nextProgramSession(program, [workout(uuid(99), '2026-11-18')])).toBe(A);
    expect(nextProgramSession({ sessions: [] }, [])).toBeNull();
  });
});

const set = (reps: number, weightKg: number, setNumber: number) => ({
  ...EMPTY_SET,
  reps,
  weightKg,
  restS: null,
  setNumber,
});
const benchStats: ExerciseStats = {
  exerciseId: bench.exerciseId!,
  last: { workoutId: uuid(50), localDate: '2026-11-10', sets: [set(10, 60, 1), set(8, 62.5, 2)] },
  bests: NO_BESTS,
  lastDoneAt: '2026-11-10T18:00:00+01:00',
};

describe('sessionFromProgram (spec 010 AC18)', () => {
  const start = (session: ProgramSession, stats = new Map<string, ExerciseStats>()) =>
    sessionFromProgram(session, {
      id: uuid(70),
      localDate: '2026-11-20',
      startedAt: '2026-11-20T18:00:00+01:00',
      stats,
      newId: ids(),
    });

  it('starts a live session with the exercises in order and their number of sets', () => {
    const live = start(A);
    expect(live).toMatchObject({
      mode: 'live',
      inputMethod: 'program',
      programSessionId: A.id,
      name: 'Rutina A',
      localDate: '2026-11-20',
    });
    expect(live.exercises.map((e) => [e.label, e.sets.length])).toEqual([
      ['Press de banca', 3],
      ['Plancha', 2],
    ]);
  });

  it('prefills last time values set by set, repeating the last one', () => {
    const live = start(A, new Map([[bench.exerciseId!, benchStats]]));
    expect(live.exercises[0]!.sets.map((s) => s.placeholder)).toEqual([
      { ...EMPTY_SET, reps: 10, weightKg: 60 },
      { ...EMPTY_SET, reps: 8, weightKg: 62.5 },
      { ...EMPTY_SET, reps: 8, weightKg: 62.5 },
    ]);
  });

  it('otherwise uses the top of the rep range and no weight, or the routine time', () => {
    const live = start(A);
    expect(live.exercises[0]!.sets[0]!.placeholder).toEqual({ ...EMPTY_SET, reps: 12 });
    expect(live.exercises[1]!.sets[0]!.placeholder).toEqual({ ...EMPTY_SET, durationS: 30 });
  });

  it("uses the routine's rest, or the usual one when it has none", () => {
    const live = start(A);
    expect(live.exercises[0]!.restS).toBe(120);
    expect(live.exercises[1]!.restS).toBe(90);
  });

  it('skips exercises that left the catalog', () => {
    const live = start({ ...A, exercises: [{ ...bench, exerciseId: null }, plank] });
    expect(live.exercises.map((e) => e.label)).toEqual(['Plancha']);
  });

  it('saves the workout with the session id and the input method program', () => {
    const live = start(B);
    const done = {
      ...live,
      exercises: live.exercises.map((e) => ({
        ...e,
        sets: e.sets.map((s) => ({ ...s, values: s.placeholder!, completedAt: live.startedAt })),
      })),
    };
    const request = sessionToRequest(done, {
      minutes: 50,
      sessionRpe: null,
      name: done.name,
      recordedAt: '2026-11-20T19:00:00+01:00',
      today: '2026-11-20',
      locale: 'es',
    });
    expect(request).toMatchObject({ inputMethod: 'program', programSessionId: B.id });
  });
});

const draft: ProgramDraft = {
  id: uuid(20),
  name: 'Rutina',
  origin: 'template',
  templateKey: 'full-body-ab',
  sessions: [A, B],
};

describe('programReducer (spec 010 AC16)', () => {
  it('renames the routine and its sessions within the limits', () => {
    let next = programReducer(draft, { type: 'rename', name: 'Mi rutina' });
    next = programReducer(next, { type: 'renameSession', sessionId: B.id, name: 'Pierna' });
    expect(next.name).toBe('Mi rutina');
    expect(next.sessions.map((s) => s.name)).toEqual(['Rutina A', 'Pierna']);
    expect(programReducer(draft, { type: 'rename', name: 'x'.repeat(80) }).name).toHaveLength(60);
  });

  it('adds, removes and reorders exercises', () => {
    let next = programReducer(draft, {
      type: 'addExercises',
      sessionId: A.id,
      exercises: [programExerciseFor({ id: uuid(4), label: 'Remo', tracking: 'weight_reps' })],
    });
    expect(next.sessions[0]!.exercises.map((e) => e.label)).toEqual([
      'Press de banca',
      'Plancha',
      'Remo',
    ]);
    next = programReducer(next, { type: 'moveExercise', sessionId: A.id, index: 2, offset: -1 });
    expect(next.sessions[0]!.exercises.map((e) => e.label)).toEqual([
      'Press de banca',
      'Remo',
      'Plancha',
    ]);
    expect(
      programReducer(next, { type: 'moveExercise', sessionId: A.id, index: 0, offset: -1 }),
    ).toEqual(next);
    next = programReducer(next, { type: 'removeExercise', sessionId: A.id, index: 0 });
    expect(next.sessions[0]!.exercises.map((e) => e.label)).toEqual(['Remo', 'Plancha']);
    expect(next.sessions[1]).toBe(B);
  });

  it('keeps sets in 1–10 and the rep range valid', () => {
    const update = (patch: Parameters<typeof programReducer>[1] & { type: 'updateExercise' }) =>
      programReducer(draft, patch).sessions[0]!.exercises[0]!;
    const at = { type: 'updateExercise', sessionId: A.id, index: 0 } as const;
    expect(update({ ...at, patch: { sets: 12 } }).sets).toBe(10);
    expect(update({ ...at, patch: { sets: 0 } }).sets).toBe(1);
    expect(update({ ...at, patch: { repsMin: 15 } })).toMatchObject({ repsMin: 15, repsMax: 15 });
    expect(update({ ...at, patch: { repsMax: 6 } })).toMatchObject({ repsMin: 6, repsMax: 6 });
    expect(update({ ...at, patch: { repsMin: 6, repsMax: 10 } })).toMatchObject({
      repsMin: 6,
      repsMax: 10,
    });
  });

  it('adds and removes sessions, keeping at least one and at most seven', () => {
    let next = programReducer(draft, { type: 'addSession', id: uuid(14), name: 'Rutina C' });
    expect(next.sessions).toHaveLength(3);
    next = programReducer(next, { type: 'removeSession', sessionId: A.id });
    expect(next.sessions.map((s) => s.id)).toEqual([B.id, uuid(14)]);
    const one = { ...draft, sessions: [A] };
    expect(programReducer(one, { type: 'removeSession', sessionId: A.id })).toBe(one);
  });

  it('gives a new exercise 3 × 8–12, or 3 × 30 s for a time exercise', () => {
    expect(
      programExerciseFor({ id: uuid(5), label: 'Plancha', tracking: 'duration' }),
    ).toMatchObject({ sets: 3, repsMin: null, repsMax: null, durationS: 30 });
  });
});

describe('programToRequest and canSaveProgram (spec 010 AC16)', () => {
  it('sends a valid request that keeps the session ids', () => {
    const request = programToRequest(
      { ...draft, sessions: [{ ...A, exercises: [{ ...bench, exerciseId: null }, plank] }, B] },
      { recordedAt: '2026-11-20T10:00:00.000Z', locale: 'es' },
    );
    expect(ProgramUpsertRequestSchema.safeParse(request).success).toBe(true);
    expect(request.sessions.map((s) => s.id)).toEqual([A.id, B.id]);
    expect(request.sessions[0]!.exercises).toEqual([
      { exerciseId: uuid(2), sets: 2, repsMin: null, repsMax: null, durationS: 30, restS: null },
    ]);
  });

  it('round-trips a saved routine through the editor', () => {
    const saved = { ...draft, recordedAt: '2026-11-20T10:00:00.000Z' };
    expect(programToDraft(saved)).toEqual(draft);
  });

  it('needs a name, named sessions and one exercise', () => {
    expect(canSaveProgram(draft)).toBe(true);
    expect(canSaveProgram({ ...draft, name: ' ' })).toBe(false);
    expect(canSaveProgram({ ...draft, sessions: [{ ...A, name: '' }] })).toBe(false);
    expect(canSaveProgram({ ...draft, sessions: [{ ...A, exercises: [] }] })).toBe(false);
  });
});
