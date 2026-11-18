import type { Workout, WorkoutUpsertRequest } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { EMPTY_SET } from './sets';
import {
  activityChoices,
  checkWorkoutRange,
  checkWorkoutWrite,
  repeatShortcuts,
  workoutFromRequest,
  workoutSetCount,
  workoutsOfDay,
  type LoggableExercise,
} from './write';

const now = new Date('2026-11-18T12:00:00Z');

describe('checkWorkoutWrite', () => {
  const write = {
    localDate: '2026-11-18',
    today: '2026-11-18',
    recordedAt: '2026-11-18T12:00:00Z',
  };

  it('accepts today and past days within a year', () => {
    expect(checkWorkoutWrite(write, now)).toBeNull();
    expect(checkWorkoutWrite({ ...write, localDate: '2025-11-17' }, now)).toBeNull();
  });

  it('rejects a future day, a day older than a year, a far device clock and a wrong today', () => {
    expect(checkWorkoutWrite({ ...write, localDate: '2026-11-19' }, now)).toEqual({
      localDate: 'in_future',
    });
    expect(checkWorkoutWrite({ ...write, localDate: '2025-11-16' }, now)).toEqual({
      localDate: 'too_old',
    });
    expect(checkWorkoutWrite({ ...write, recordedAt: '2026-11-20T12:00:00Z' }, now)).toEqual({
      recordedAt: 'in_future',
    });
    expect(
      checkWorkoutWrite({ ...write, today: '2026-11-25', localDate: '2026-11-25' }, now),
    ).not.toBeNull();
  });
});

describe('checkWorkoutRange', () => {
  it('allows at most 62 days', () => {
    expect(checkWorkoutRange('2026-09-17', '2026-11-18')).toBeNull();
    expect(checkWorkoutRange('2026-09-16', '2026-11-18')).toEqual({ to: 'too_big' });
    expect(checkWorkoutRange('2026-11-19', '2026-11-18')).toEqual({ from: 'after_to' });
  });
});

const exercises = new Map<string, LoggableExercise>([
  [
    'bench',
    { id: 'bench', nameEs: 'Press de banca', nameEn: 'Bench press', tracking: 'weight_reps' },
  ],
  ['plank', { id: 'plank', nameEs: 'Plancha', nameEn: 'Plank', tracking: 'duration' }],
]);

const placement = {
  localDate: '2026-11-18',
  startedAt: '2026-11-18T18:00:00Z',
  sessionRpe: 7,
  recordedAt: '2026-11-18T19:00:00Z',
  today: '2026-11-18',
  locale: 'es' as const,
};

const gym: WorkoutUpsertRequest = {
  kind: 'gym',
  name: null,
  minutes: 50,
  inputMethod: 'live',
  exercises: [
    {
      exerciseId: 'bench',
      sets: [{ ...EMPTY_SET, reps: 8, weightKg: 60, durationS: 30, restS: 90 }],
    },
    {
      exerciseId: 'plank',
      sets: [
        { ...EMPTY_SET, durationS: 60, restS: null },
        { ...EMPTY_SET, durationS: 45, restS: null },
      ],
    },
  ],
  ...placement,
};

describe('workoutFromRequest (AC12, AC16, AC23)', () => {
  it('snapshots names in the locale, numbers the sets and drops stray fields', () => {
    const workout = workoutFromRequest('w1', gym, exercises) as Workout;
    expect(workout.kind).toBe('gym');
    expect(workout.exercises[0]).toEqual({
      exerciseId: 'bench',
      label: 'Press de banca',
      tracking: 'weight_reps',
      sets: [{ ...EMPTY_SET, reps: 8, weightKg: 60, restS: 90, setNumber: 1 }],
    });
    expect(workout.exercises[1]?.sets.map((s) => s.setNumber)).toEqual([1, 2]);
    const en = workoutFromRequest('w1', { ...gym, locale: 'en' }, exercises) as Workout;
    expect(en.exercises[0]?.label).toBe('Bench press');
  });

  it('rejects an unknown exercise and a set without its values', () => {
    expect(
      workoutFromRequest(
        'w1',
        { ...gym, exercises: [{ exerciseId: 'x', sets: gym.exercises[0]!.sets }] },
        exercises,
      ),
    ).toEqual({ error: 'exercise_not_found', exerciseId: 'x' });
    expect(
      workoutFromRequest(
        'w1',
        {
          ...gym,
          exercises: [{ exerciseId: 'plank', sets: [{ ...EMPTY_SET, reps: 8, restS: null }] }],
        },
        exercises,
      ),
    ).toEqual({ error: 'set_mismatch', exerciseId: 'plank', setNumber: 1 });
  });

  it('stores an activity without exercises', () => {
    const workout = workoutFromRequest(
      'w2',
      {
        kind: 'sport',
        activity: 'football',
        name: null,
        minutes: 90,
        inputMethod: 'activity',
        ...placement,
      },
      exercises,
    );
    expect(workout).toMatchObject({
      kind: 'sport',
      activity: 'football',
      minutes: 90,
      exercises: [],
    });
  });
});

describe('activityChoices (AC16)', () => {
  it('lists the profile activities first, without strength or duplicates, then the defaults', () => {
    const choices = activityChoices([
      { kind: 'sport', label: 'Fútbol 7' },
      { kind: 'strength', label: 'Gimnasio' },
      { kind: 'cardio', label: null },
      { kind: 'sport', label: ' fútbol 7 ' },
    ]);
    expect(choices[0]).toEqual({ kind: 'sport', activity: null, name: 'Fútbol 7' });
    expect(choices.slice(1).map((c) => c.activity)).toEqual([
      'football',
      'padel',
      'running',
      'cycling',
      'swimming',
      'walking',
      'group_class',
      'other',
    ]);
    expect(choices.find((c) => c.activity === 'running')?.kind).toBe('cardio');
  });
});

const workout = (
  id: string,
  startedAt: string,
  exerciseIds: string[],
  kind: Workout['kind'] = 'gym',
): Workout => ({
  id,
  localDate: startedAt.slice(0, 10),
  kind,
  activity: null,
  name: null,
  startedAt,
  minutes: 45,
  sessionRpe: null,
  inputMethod: 'live',
  recordedAt: startedAt,
  exercises: exerciseIds.map((exerciseId) => ({
    exerciseId,
    label: exerciseId,
    tracking: 'reps' as const,
    sets: [{ ...EMPTY_SET, reps: 10, restS: null, setNumber: 1 }],
  })),
});

describe('history helpers (AC18, AC20, AC21)', () => {
  const log = [
    workout('a', '2026-11-10T18:00:00Z', ['bench', 'row']),
    workout('b', '2026-11-12T18:00:00Z', ['squat']),
    workout('c', '2026-11-14T18:00:00Z', ['bench', 'row']),
    workout('d', '2026-11-15T10:00:00Z', [], 'sport'),
    workout('e', '2026-11-16T18:00:00Z', ['deadlift']),
    workout('f', '2026-11-17T18:00:00Z', ['curl']),
  ];

  it('gives the last 3 distinct gym sessions, newest first', () => {
    expect(repeatShortcuts(log).map((w) => w.id)).toEqual(['f', 'e', 'c']);
  });

  it('gives the workouts of a day in order and counts sets', () => {
    expect(workoutsOfDay(log, '2026-11-15').map((w) => w.id)).toEqual(['d']);
    expect(workoutSetCount(log[0]!)).toBe(2);
  });
});
