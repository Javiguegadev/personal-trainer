import type { ExerciseStats, SafetyFlag, Workout, WorkoutSet } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { NO_BESTS } from './bests';
import { EMPTY_SET } from './sets';
import {
  canRewriteWorkout,
  groupSets,
  recentExerciseIds,
  showsRecordsFor,
  weekStartOf,
  workoutHistoryWeeks,
  workoutRecordCount,
  workoutToRequest,
} from './view';

const set = (values: Partial<WorkoutSet>, setNumber = 1): WorkoutSet => ({
  ...EMPTY_SET,
  restS: null,
  setNumber,
  ...values,
});

const PRESS = '00000000-0000-4000-8000-000000000001';
const PLANK = '00000000-0000-4000-8000-000000000002';

const gym = (
  id: string,
  localDate: string,
  exercises: Workout['exercises'],
  hour = 18,
): Workout => ({
  id,
  localDate,
  kind: 'gym',
  activity: null,
  name: null,
  startedAt: `${localDate}T${String(hour).padStart(2, '0')}:00:00.000Z`,
  minutes: 60,
  sessionRpe: null,
  inputMethod: 'live',
  exercises,
  recordedAt: `${localDate}T20:00:00.000Z`,
});

const press = (weightKg: number, reps = 8): Workout['exercises'][number] => ({
  exerciseId: PRESS,
  label: 'Press de banca',
  tracking: 'weight_reps',
  sets: [set({ weightKg, reps })],
});

describe('groupSets', () => {
  it('groups consecutive equal sets (AC7: "3 × 8 · 60 kg")', () => {
    const sets = [
      { ...EMPTY_SET, reps: 8, weightKg: 60 },
      { ...EMPTY_SET, reps: 8, weightKg: 60 },
      { ...EMPTY_SET, reps: 6, weightKg: 65 },
      { ...EMPTY_SET, reps: 8, weightKg: 60 },
    ];
    expect(groupSets(sets)).toEqual([
      { count: 2, values: sets[0] },
      { count: 1, values: sets[2] },
      { count: 1, values: sets[3] },
    ]);
  });

  it('is empty for no sets', () => {
    expect(groupSets([])).toEqual([]);
  });
});

describe('weekStartOf', () => {
  it('returns the Monday of the week', () => {
    expect(weekStartOf('2026-11-18')).toBe('2026-11-16'); // Wednesday
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16'); // Monday
    expect(weekStartOf('2026-11-22')).toBe('2026-11-16'); // Sunday
  });
});

describe('workoutHistoryWeeks', () => {
  it('groups the last 30 days by week, newest first, and says whether older ones exist (AC20)', () => {
    const log = [
      gym('a', '2026-11-18', [press(60)]),
      gym('b', '2026-11-16', [press(60)]),
      gym('c', '2026-11-12', [press(60)]),
      gym('d', '2026-10-10', [press(60)]),
    ];
    const { weeks, hasOlder } = workoutHistoryWeeks(log, '2026-11-18', 30);
    expect(weeks.map((w) => [w.weekStart, w.workouts.map((x) => x.id)])).toEqual([
      ['2026-11-16', ['a', 'b']],
      ['2026-11-09', ['c']],
    ]);
    expect(hasOlder).toBe(true);
  });

  it('shows every workout with a longer range', () => {
    const log = [gym('a', '2026-11-18', [press(60)]), gym('d', '2026-10-10', [press(60)])];
    const { weeks, hasOlder } = workoutHistoryWeeks(log, '2026-11-18', 60);
    expect(weeks).toHaveLength(2);
    expect(hasOlder).toBe(false);
  });
});

describe('recentExerciseIds', () => {
  it('keeps the order of the stats (most recently done first), at most 20 (AC5)', () => {
    const stats = Array.from({ length: 25 }, (_, i) => ({
      exerciseId: `id-${i}`,
    })) as unknown as ExerciseStats[];
    const ids = recentExerciseIds(stats);
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe('id-0');
  });
});

describe('showsRecordsFor', () => {
  const none: SafetyFlag[] = [];
  it('shows records for every tracking by default', () => {
    expect(showsRecordsFor('reps', none)).toBe(true);
    expect(showsRecordsFor('duration', none)).toBe(true);
  });
  it('hides bodyweight records (reps-only and time) with ed_soft_stop (Safety)', () => {
    const flags: SafetyFlag[] = ['ed_soft_stop'];
    expect(showsRecordsFor('reps', flags)).toBe(false);
    expect(showsRecordsFor('duration', flags)).toBe(false);
    expect(showsRecordsFor('weight_reps', flags)).toBe(true);
    expect(showsRecordsFor('distance_duration', flags)).toBe(true);
  });
});

describe('workoutRecordCount', () => {
  const statsFor = (bests: ExerciseStats['bests']): ExerciseStats[] => [
    {
      exerciseId: PRESS,
      last: { workoutId: 'x', localDate: '2026-11-18', sets: [] },
      bests,
      lastDoneAt: '2026-11-18T18:00:00.000Z',
    },
  ];

  it('counts the sets that set an all-time best that still stands (AC20, AC21)', () => {
    const earlier = gym('a', '2026-11-10', [press(60)]);
    const today = gym('b', '2026-11-18', [press(65)]);
    const stats = statsFor({
      ...NO_BESTS,
      heaviestKg: { value: 65, localDate: '2026-11-18' },
      oneRepMaxKg: { value: 82.5, localDate: '2026-11-18' },
    });
    expect(workoutRecordCount(today, [today, earlier], stats, [])).toBe(1);
    // The earlier session's bests were beaten since.
    expect(workoutRecordCount(earlier, [today, earlier], stats, [])).toBe(0);
  });

  it('shows no record for the first session of an exercise (AC10)', () => {
    const first = gym('a', '2026-11-18', [press(65)]);
    const stats = statsFor({ ...NO_BESTS, heaviestKg: { value: 65, localDate: '2026-11-18' } });
    expect(workoutRecordCount(first, [first], stats, [])).toBe(0);
  });

  it('leaves out bodyweight exercises with ed_soft_stop', () => {
    const plank = (s: number): Workout['exercises'][number] => ({
      exerciseId: PLANK,
      label: 'Plancha',
      tracking: 'duration',
      sets: [set({ durationS: s })],
    });
    const earlier = gym('a', '2026-11-10', [plank(60)]);
    const today = gym('b', '2026-11-18', [plank(90)]);
    const stats: ExerciseStats[] = [
      {
        exerciseId: PLANK,
        last: { workoutId: 'b', localDate: '2026-11-18', sets: [] },
        bests: { ...NO_BESTS, longestS: { value: 90, localDate: '2026-11-18' } },
        lastDoneAt: today.startedAt,
      },
    ];
    expect(workoutRecordCount(today, [today, earlier], stats, [])).toBe(1);
    expect(workoutRecordCount(today, [today, earlier], stats, ['ed_soft_stop'])).toBe(0);
  });

  it('credits each best once, in the first set that reached it (3 sets of the new weight = 1)', () => {
    const earlier = gym('a', '2026-11-10', [press(60)]);
    const today = gym('b', '2026-11-18', [
      {
        ...press(65),
        sets: [
          set({ weightKg: 65, reps: 8 }, 1),
          set({ weightKg: 65, reps: 8 }, 2),
          set({ weightKg: 65, reps: 8 }, 3),
        ],
      },
    ]);
    const stats = statsFor({
      ...NO_BESTS,
      heaviestKg: { value: 65, localDate: '2026-11-18' },
      oneRepMaxKg: { value: 82.5, localDate: '2026-11-18' },
    });
    expect(workoutRecordCount(today, [today, earlier], stats, [])).toBe(1);
  });

  it('does not count a tie with an earlier workout of the same day', () => {
    const earlier = gym('a', '2026-11-10', [press(60)]);
    const morning = gym('m', '2026-11-18', [press(65)], 8);
    const evening = gym('e', '2026-11-18', [press(65)], 19);
    const log = [evening, morning, earlier];
    const stats = statsFor({
      ...NO_BESTS,
      heaviestKg: { value: 65, localDate: '2026-11-18' },
      oneRepMaxKg: { value: 82.5, localDate: '2026-11-18' },
    });
    expect(workoutRecordCount(morning, log, stats, [])).toBe(1);
    expect(workoutRecordCount(evening, log, stats, [])).toBe(0);
  });

  it('is 0 for an activity', () => {
    const activity: Workout = {
      ...gym('a', '2026-11-18', []),
      kind: 'sport',
      activity: 'football',
    };
    expect(workoutRecordCount(activity, [activity], [], [])).toBe(0);
  });
});

describe('workoutToRequest', () => {
  const placement = {
    recordedAt: '2026-11-18T21:00:00.000Z',
    today: '2026-11-18',
    locale: 'es' as const,
  };

  it('writes a gym session back as it is, with changes (AC19 edit, undo of a delete)', () => {
    const workout = { ...gym('a', '2026-11-17', [press(60)]), name: 'Pecho', sessionRpe: 7 };
    expect(workoutToRequest(workout, placement, { minutes: 50, localDate: '2026-11-16' })).toEqual({
      kind: 'gym',
      name: 'Pecho',
      minutes: 50,
      exercises: [
        {
          exerciseId: PRESS,
          sets: [{ reps: 8, weightKg: 60, durationS: null, distanceM: null, restS: null }],
        },
      ],
      inputMethod: 'live',
      localDate: '2026-11-16',
      startedAt: workout.startedAt,
      sessionRpe: 7,
      ...placement,
    });
  });

  it('writes an activity back', () => {
    const activity: Workout = {
      ...gym('a', '2026-11-18', []),
      kind: 'sport',
      activity: 'football',
      inputMethod: 'activity',
      minutes: 90,
    };
    expect(workoutToRequest(activity, placement)).toEqual({
      kind: 'sport',
      activity: 'football',
      name: null,
      minutes: 90,
      inputMethod: 'activity',
      localDate: '2026-11-18',
      startedAt: activity.startedAt,
      sessionRpe: null,
      ...placement,
    });
  });

  it('refuses a workout with an exercise that no longer exists, so its sets are never erased', () => {
    const gone = { ...press(60), exerciseId: null };
    const workout = gym('a', '2026-11-18', [gone, press(60)]);
    expect(canRewriteWorkout(workout)).toBe(false);
    expect(workoutToRequest(workout, placement)).toBeNull();
    expect(canRewriteWorkout(gym('b', '2026-11-18', [press(60)]))).toBe(true);
  });
});
