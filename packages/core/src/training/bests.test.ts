import type { Workout, WorkoutSet } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import {
  NO_BESTS,
  addToBests,
  buildExerciseStats,
  exerciseHistory,
  estimatedOneRepMax,
  lastRest,
  newBests,
  oneRepMaxSeries,
  personalBests,
  statsWithWorkout,
} from './bests';

const set = (values: Partial<WorkoutSet>, setNumber = 1): WorkoutSet => ({
  reps: null,
  weightKg: null,
  durationS: null,
  distanceM: null,
  restS: null,
  setNumber,
  ...values,
});

describe('estimatedOneRepMax (AC14)', () => {
  it('uses Epley for 1–12 reps, rounded to 0.5 kg', () => {
    expect(estimatedOneRepMax(100, 1)).toBe(100);
    expect(estimatedOneRepMax(60, 8)).toBe(76);
    expect(estimatedOneRepMax(62.5, 5)).toBe(73);
    expect(estimatedOneRepMax(100, 12)).toBe(140);
  });

  it('is null above 12 reps, below 1 or without weight', () => {
    expect(estimatedOneRepMax(60, 13)).toBeNull();
    expect(estimatedOneRepMax(60, 0)).toBeNull();
    expect(estimatedOneRepMax(0, 5)).toBeNull();
  });
});

describe('personalBests (AC14)', () => {
  it('keeps the heaviest weight and the best 1RM with the date they were first reached', () => {
    const bests = personalBests(
      [
        {
          localDate: '2026-11-10',
          sets: [set({ weightKg: 60, reps: 8 }), set({ weightKg: 65, reps: 3 })],
        },
        { localDate: '2026-11-03', sets: [set({ weightKg: 65, reps: 5 })] },
        { localDate: '2026-11-12', sets: [set({ weightKg: 50, reps: 20 })] },
      ],
      'weight_reps',
    );
    expect(bests.heaviestKg).toEqual({ value: 65, localDate: '2026-11-03' });
    expect(bests.oneRepMaxKg).toEqual({ value: 76, localDate: '2026-11-03' });
    expect(bests.mostReps).toBeNull();
  });

  it('tracks reps, time and distance by tracking', () => {
    expect(
      personalBests(
        [{ localDate: '2026-11-01', sets: [set({ reps: 12 }), set({ reps: 15 })] }],
        'reps',
      ).mostReps,
    ).toEqual({ value: 15, localDate: '2026-11-01' });
    expect(
      personalBests([{ localDate: '2026-11-01', sets: [set({ durationS: 90 })] }], 'duration')
        .longestS?.value,
    ).toBe(90);
    expect(
      personalBests(
        [{ localDate: '2026-11-01', sets: [set({ distanceM: 5000, durationS: 1500 })] }],
        'distance_duration',
      ),
    ).toEqual({ ...NO_BESTS, longestM: { value: 5000, localDate: '2026-11-01' } });
  });
});

describe('newBests (AC10, AC14)', () => {
  const bests = addToBests(NO_BESTS, set({ weightKg: 60, reps: 8 }), 'weight_reps', '2026-11-01');

  it('reports what a set strictly beats', () => {
    expect(newBests(set({ weightKg: 62.5, reps: 8 }), 'weight_reps', bests)).toEqual([
      { kind: 'heaviestKg', value: 62.5 },
      { kind: 'oneRepMaxKg', value: 79 },
    ]);
    expect(newBests(set({ weightKg: 55, reps: 12 }), 'weight_reps', bests)).toEqual([
      { kind: 'oneRepMaxKg', value: 77 },
    ]);
  });

  it('does not report an equal value after rounding', () => {
    expect(newBests(set({ weightKg: 60, reps: 8 }), 'weight_reps', bests)).toEqual([]);
    expect(newBests(set({ weightKg: 60.1, reps: 8 }), 'weight_reps', bests)).toEqual([
      { kind: 'heaviestKg', value: 60.1 },
    ]);
  });

  it('gives no badge without a previous best', () => {
    expect(newBests(set({ weightKg: 100, reps: 5 }), 'weight_reps', NO_BESTS)).toEqual([]);
  });
});

describe('buildExerciseStats (AC7, AC14)', () => {
  const row = (workoutId: string, localDate: string, startedAt: string, s: WorkoutSet) => ({
    workoutId,
    localDate,
    startedAt,
    exerciseId: 'bench',
    tracking: 'weight_reps' as const,
    set: s,
  });
  const stats = buildExerciseStats([
    row('w1', '2026-11-01', '2026-11-01T18:00:00Z', set({ weightKg: 60, reps: 8, restS: 90 }, 1)),
    row(
      'w2',
      '2026-11-08',
      '2026-11-08T18:00:00Z',
      set({ weightKg: 62.5, reps: 6, restS: 120 }, 2),
    ),
    row(
      'w2',
      '2026-11-08',
      '2026-11-08T18:00:00Z',
      set({ weightKg: 62.5, reps: 8, restS: null }, 1),
    ),
    {
      ...row('w2', '2026-11-08', '2026-11-08T18:00:00Z', set({ reps: 10 }, 1)),
      exerciseId: 'dips',
      tracking: 'reps' as const,
    },
  ]);

  it('gives the last session in set order, the bests and the last time done', () => {
    const bench = stats.find((s) => s.exerciseId === 'bench')!;
    expect(bench.last.workoutId).toBe('w2');
    expect(bench.last.sets.map((s) => s.setNumber)).toEqual([1, 2]);
    expect(bench.bests.heaviestKg).toEqual({ value: 62.5, localDate: '2026-11-08' });
    expect(bench.lastDoneAt).toBe('2026-11-08T18:00:00Z');
    expect(lastRest(bench)).toBe(120);
    expect(lastRest(null)).toBeNull();
  });

  it('lists every exercise once', () => {
    expect(stats.map((s) => s.exerciseId).sort()).toEqual(['bench', 'dips']);
  });
});

describe('oneRepMaxSeries (AC15)', () => {
  it('gives the best estimate of each session, oldest first', () => {
    expect(
      oneRepMaxSeries([
        {
          localDate: '2026-11-08',
          sets: [set({ weightKg: 60, reps: 8 }), set({ weightKg: 70, reps: 1 })],
        },
        { localDate: '2026-11-01', sets: [set({ weightKg: 55, reps: 8 })] },
        { localDate: '2026-11-05', sets: [set({ weightKg: 20, reps: 20 })] },
      ]),
    ).toEqual([
      { localDate: '2026-11-01', value: 69.5 },
      { localDate: '2026-11-08', value: 76 },
    ]);
  });
});

describe('exerciseHistory (AC15)', () => {
  const row = (workoutId: string, day: string, s: WorkoutSet) => ({
    workoutId,
    localDate: day,
    startedAt: `${day}T18:00:00.000Z`,
    exerciseId: 'bench',
    tracking: 'weight_reps' as const,
    set: s,
  });
  const rows = [
    row('w1', '2026-11-01', set({ weightKg: 70, reps: 5 }, 1)),
    row('w2', '2026-11-08', set({ weightKg: 60, reps: 8 }, 2)),
    row('w2', '2026-11-08', set({ weightKg: 60, reps: 8 }, 1)),
    row('w3', '2026-11-15', set({ weightKg: 62.5, reps: 8 }, 1)),
  ];

  it('lists sessions newest first with their sets in order, at most `limit`', () => {
    const history = exerciseHistory('bench', rows, 2);
    expect(history.exerciseId).toBe('bench');
    expect(history.sessions.map((s) => s.workoutId)).toEqual(['w3', 'w2']);
    expect(history.sessions[1]!.sets.map((s) => s.setNumber)).toEqual([1, 2]);
  });

  it('computes the bests over the whole history, not only the sessions returned', () => {
    expect(exerciseHistory('bench', rows, 1).bests.heaviestKg).toEqual({
      value: 70,
      localDate: '2026-11-01',
    });
  });

  it('is empty for an exercise never done', () => {
    expect(exerciseHistory('bench', [], 10)).toEqual({
      exerciseId: 'bench',
      sessions: [],
      bests: NO_BESTS,
    });
  });
});

describe('statsWithWorkout (AC10, AC22: the offline stats after a save)', () => {
  const workout = (
    id: string,
    day: string,
    exercises: { exerciseId: string | null; sets: WorkoutSet[] }[],
  ): Workout => ({
    id,
    localDate: day,
    kind: 'gym',
    activity: null,
    name: null,
    startedAt: `${day}T18:00:00.000Z`,
    minutes: 60,
    sessionRpe: null,
    inputMethod: 'live',
    programSessionId: null,
    exercises: exercises.map((e) => ({ ...e, label: 'x', tracking: 'weight_reps' as const })),
    recordedAt: `${day}T19:00:00.000Z`,
  });
  const before = buildExerciseStats([
    {
      workoutId: 'w1',
      localDate: '2026-11-01',
      startedAt: '2026-11-01T18:00:00.000Z',
      exerciseId: 'bench',
      tracking: 'weight_reps',
      set: set({ weightKg: 70, reps: 5, restS: 120 }),
    },
  ]);

  it('makes a newer session the last one and raises only the bests it beats', () => {
    const next = statsWithWorkout(
      before,
      workout('w2', '2026-11-08', [
        {
          exerciseId: 'bench',
          sets: [set({ weightKg: 72.5, reps: 3 }), set({ weightKg: 60, reps: 8 }, 2)],
        },
      ]),
    );
    expect(next).toHaveLength(1);
    expect(next[0]!.last.workoutId).toBe('w2');
    expect(next[0]!.lastDoneAt).toBe('2026-11-08T18:00:00.000Z');
    expect(next[0]!.bests.heaviestKg).toEqual({ value: 72.5, localDate: '2026-11-08' });
    // 70 × 5 → 81.5 still beats 72.5 × 3 → 79.5 and 60 × 8 → 76.
    expect(next[0]!.bests.oneRepMaxKg).toEqual(before[0]!.bests.oneRepMaxKg);
  });

  it('keeps the last session when an older one is logged afterwards', () => {
    const next = statsWithWorkout(
      before,
      workout('w0', '2026-10-25', [
        { exerciseId: 'bench', sets: [set({ weightKg: 75, reps: 1 })] },
      ]),
    );
    expect(next[0]!.last.workoutId).toBe('w1');
    expect(next[0]!.bests.heaviestKg).toEqual({ value: 75, localDate: '2026-10-25' });
  });

  it('adds an exercise done for the first time, most recently done first', () => {
    const next = statsWithWorkout(
      before,
      workout('w2', '2026-11-08', [
        { exerciseId: 'row', sets: [set({ weightKg: 50, reps: 10 })] },
        { exerciseId: null, sets: [set({ weightKg: 10, reps: 10 })] },
      ]),
    );
    expect(next.map((s) => s.exerciseId)).toEqual(['row', 'bench']);
    expect(next[0]!.bests.heaviestKg).toEqual({ value: 50, localDate: '2026-11-08' });
  });

  it('replaces the last session when that same workout is edited', () => {
    const edited = workout('w1', '2026-11-01', [
      { exerciseId: 'bench', sets: [set({ weightKg: 70, reps: 6 })] },
    ]);
    const next = statsWithWorkout(before, edited);
    expect(next[0]!.last.sets).toEqual(edited.exercises[0]!.sets);
  });

  it('leaves the stats alone for an activity', () => {
    const activity = { ...workout('w2', '2026-11-08', []), kind: 'sport' as const };
    expect(statsWithWorkout(before, activity)).toEqual(before);
  });
});
