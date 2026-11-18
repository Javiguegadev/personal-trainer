import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_TYPES,
  ActivityTypeSchema,
  CustomExerciseUpsertRequestSchema,
  ExerciseHistoryQuerySchema,
  WORKOUT_LIMITS,
  WorkoutUpsertRequestSchema,
  type WorkoutUpsertRequest,
} from './training';

const placement = {
  localDate: '2026-11-18',
  startedAt: '2026-11-18T18:00:00+01:00',
  sessionRpe: 7,
  recordedAt: '2026-11-18T19:05:00+01:00',
  today: '2026-11-18',
  locale: 'es',
} as const;

const gym: WorkoutUpsertRequest = {
  kind: 'gym',
  name: 'Pierna',
  minutes: 55,
  inputMethod: 'live',
  exercises: [
    {
      exerciseId: '00000000-0000-4000-8000-000000000001',
      sets: [{ reps: 8, weightKg: 60, durationS: null, distanceM: null, restS: 90 }],
    },
  ],
  ...placement,
};

const activity: WorkoutUpsertRequest = {
  kind: 'sport',
  activity: 'football',
  name: null,
  minutes: 90,
  inputMethod: 'activity',
  ...placement,
};

describe('WorkoutUpsertRequestSchema', () => {
  it('accepts a gym session and an activity', () => {
    expect(WorkoutUpsertRequestSchema.parse(gym)).toEqual(gym);
    expect(WorkoutUpsertRequestSchema.parse(activity)).toEqual(activity);
  });

  it('rejects a gym session without exercises or with an empty exercise', () => {
    expect(WorkoutUpsertRequestSchema.safeParse({ ...gym, exercises: [] }).success).toBe(false);
    const empty = { ...gym, exercises: [{ exerciseId: gym.exercises[0]?.exerciseId, sets: [] }] };
    expect(WorkoutUpsertRequestSchema.safeParse(empty).success).toBe(false);
  });

  it.each([
    ['reps', 0],
    ['reps', 101],
    ['reps', 2.5],
    ['weightKg', -1],
    ['weightKg', 500.5],
    ['durationS', 10_801],
    ['distanceM', 100_001],
    ['restS', 901],
  ] as const)('rejects a set with %s = %d', (field, value) => {
    const set = {
      reps: 8,
      weightKg: 60,
      durationS: null,
      distanceM: null,
      restS: null,
      [field]: value,
    };
    const request = {
      ...gym,
      exercises: [{ exerciseId: gym.exercises[0]?.exerciseId, sets: [set] }],
    };
    expect(WorkoutUpsertRequestSchema.safeParse(request).success).toBe(false);
  });

  it('caps sets per exercise and exercises per session', () => {
    const set = { reps: 8, weightKg: 60, durationS: null, distanceM: null, restS: null };
    const id = '00000000-0000-4000-8000-000000000001';
    const manySets = [
      { exerciseId: id, sets: Array(WORKOUT_LIMITS.setsPerExerciseMax + 1).fill(set) },
    ];
    expect(WorkoutUpsertRequestSchema.safeParse({ ...gym, exercises: manySets }).success).toBe(
      false,
    );
    const manyExercises = Array(WORKOUT_LIMITS.exercisesPerSessionMax + 1).fill({
      exerciseId: id,
      sets: [set],
    });
    expect(WorkoutUpsertRequestSchema.safeParse({ ...gym, exercises: manyExercises }).success).toBe(
      false,
    );
  });

  it.each([
    [{ ...gym, minutes: 0 }],
    [{ ...gym, minutes: 601 }],
    [{ ...activity, minutes: 4 }],
    [{ ...gym, sessionRpe: 11 }],
    [{ ...gym, name: 'x'.repeat(61) }],
    [{ ...gym, inputMethod: 'activity' }],
    [{ ...activity, inputMethod: 'live' }],
    [{ ...activity, kind: 'gym' }],
  ])('rejects %j', (request) => {
    expect(WorkoutUpsertRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe('activity types (AC16)', () => {
  it('maps every chip to a kind', () => {
    expect(Object.keys(ACTIVITY_TYPES).sort()).toEqual([...ActivityTypeSchema.options].sort());
  });
});

describe('CustomExerciseUpsertRequestSchema', () => {
  it('trims the name and rejects an empty or long one', () => {
    const request = {
      name: '  Press Landmine ',
      tracking: 'weight_reps',
      primaryMuscle: 'chest',
      recordedAt: '2026-11-18T19:05:00+01:00',
    };
    expect(CustomExerciseUpsertRequestSchema.parse(request).name).toBe('Press Landmine');
    expect(CustomExerciseUpsertRequestSchema.safeParse({ ...request, name: ' ' }).success).toBe(
      false,
    );
    expect(
      CustomExerciseUpsertRequestSchema.safeParse({ ...request, name: 'x'.repeat(61) }).success,
    ).toBe(false);
  });
});

describe('ExerciseHistoryQuerySchema', () => {
  it('defaults and caps the limit', () => {
    expect(ExerciseHistoryQuerySchema.parse({}).limit).toBe(WORKOUT_LIMITS.historySessionsDefault);
    expect(ExerciseHistoryQuerySchema.parse({ limit: '30' }).limit).toBe(30);
    expect(ExerciseHistoryQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});
