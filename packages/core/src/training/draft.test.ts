import type {
  Exercise,
  ExerciseStats,
  ExerciseTracking,
  ProgramSession,
  WorkoutDraft,
  WorkoutReading,
  WorkoutReadingActivity,
  WorkoutReadingExercise,
  WorkoutReadingSetGroup,
  WorkoutSet,
} from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { NO_BESTS } from './bests';
import { draftToSession, liveExerciseFromDraft, matchRoutineSession, workoutDraft } from './draft';
import { liveSetRecords, sessionReducer, sessionToRequest } from './session';
import { EMPTY_SET } from './sets';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function exercise(n: number, nameEs: string, tracking: ExerciseTracking): Exercise {
  return {
    id: uuid(n),
    key: nameEs.toLowerCase().replaceAll(' ', '-'),
    origin: 'catalog',
    nameEs,
    nameEn: `${nameEs} (en)`,
    synonymsEs: [],
    synonymsEn: [],
    tracking,
    category: 'strength',
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: [],
    popularity: 0,
    source: null,
  };
}

const BENCH = exercise(1, 'Press de banca', 'weight_reps');
const ROW = exercise(2, 'Remo con barra', 'weight_reps');
const SQUAT = exercise(3, 'Sentadilla', 'weight_reps');
const PULLUP = exercise(4, 'Dominadas', 'reps');
const PLANK = exercise(5, 'Plancha', 'duration');
const ERG = exercise(6, 'Remo ergómetro', 'distance_duration');

/** The refs the API handed out in this request. */
const REFS = new Map<string, Exercise>([
  ['e1', BENCH],
  ['e2', ROW],
  ['e3', SQUAT],
  ['e4', PULLUP],
  ['e5', PLANK],
  ['e6', ERG],
]);

const TODAY = '2026-11-24';
const SCREEN_DAY = '2026-11-22';

const group = (over: Partial<WorkoutReadingSetGroup>): WorkoutReadingSetGroup => ({
  count: 1,
  reps: null,
  weight: null,
  weightUnit: 'kg',
  durationS: null,
  distanceM: null,
  ...over,
});

const said = (
  mention: string,
  exerciseRef: string | null,
  ...setGroups: WorkoutReadingSetGroup[]
): WorkoutReadingExercise => ({ mention, exerciseRef, setGroups });

const activity = (over: Partial<WorkoutReadingActivity>): WorkoutReadingActivity => ({
  mention: 'pádel',
  activity: 'padel',
  minutes: null,
  sessionRpe: null,
  distanceSaid: false,
  ...over,
});

function reading(over: Partial<WorkoutReading>): WorkoutReading {
  return {
    status: 'ok',
    gym: null,
    activities: [],
    daysAgo: null,
    startTime: null,
    painMentioned: false,
    ...over,
  };
}

const gym = (...exercises: WorkoutReadingExercise[]) =>
  reading({ gym: { exercises, minutes: null, sessionRpe: null } });

function draftOf(r: WorkoutReading): WorkoutDraft {
  const result = workoutDraft(r, REFS, TODAY, SCREEN_DAY);
  if (result.status !== 'ok') throw new Error(`expected a draft, got ${result.reason}`);
  return result.draft;
}

const values = (over: Partial<typeof EMPTY_SET>) => ({ ...EMPTY_SET, ...over });

describe('workoutDraft: the reading (spec 012 AC3, AC8)', () => {
  it('expands set groups into sets, in the order said, with the words they came from', () => {
    const draft = draftOf(
      gym(
        said('press banca 4x8 con 60', 'e1', group({ count: 4, reps: 8, weight: 60 })),
        said(
          'remo 8 con 60, 6 con 65 y 4 con 70',
          'e2',
          group({ reps: 8, weight: 60 }),
          group({ reps: 6, weight: 65 }),
          group({ reps: 4, weight: 70 }),
        ),
      ),
    );
    expect(draft.exercises.map((e) => [e.exercise.id, e.mention])).toEqual([
      [BENCH.id, 'press banca 4x8 con 60'],
      [ROW.id, 'remo 8 con 60, 6 con 65 y 4 con 70'],
    ]);
    expect(draft.exercises[0]?.sets).toEqual(
      Array(4).fill({ values: values({ reps: 8, weightKg: 60 }), clamped: false }),
    );
    expect(draft.exercises[1]?.sets.map((s) => s.values.weightKg)).toEqual([60, 65, 70]);
    expect(draft.unresolved).toEqual([]);
    expect(draft.activity).toBeNull();
  });

  it('leaves a value that was not said null, never invented', () => {
    const draft = draftOf(gym(said('sentadilla 3x10', 'e3', group({ count: 3, reps: 10 }))));
    expect(draft.exercises[0]?.sets).toEqual(
      Array(3).fill({ values: values({ reps: 10 }), clamped: false }),
    );
  });

  it('keeps an exercise said without sets, with no sets', () => {
    const draft = draftOf(gym(said('y sentadilla', 'e3')));
    expect(draft.exercises[0]?.sets).toEqual([]);
  });

  it('drops the values the tracking does not use, but keeps extra weight on a reps exercise', () => {
    const draft = draftOf(
      gym(
        said('plancha 3 x 45 segundos', 'e5', group({ count: 3, durationS: 45, weight: 10 })),
        said('dominadas 3x6 con 10 kg de lastre', 'e4', group({ count: 3, reps: 6, weight: 10 })),
        said('remo 2000 m en 8:30', 'e6', group({ distanceM: 2000, durationS: 510, reps: 1 })),
      ),
    );
    expect(draft.exercises.map((e) => e.sets[0]?.values)).toEqual([
      values({ durationS: 45 }),
      values({ reps: 6, weightKg: 10 }),
      values({ distanceM: 2000, durationS: 510 }),
    ]);
  });

  it('converts pounds to kg with 2 decimals', () => {
    const draft = draftOf(
      gym(said('bench 135 lbs x 5', 'e1', group({ reps: 5, weight: 135, weightUnit: 'lb' }))),
    );
    expect(draft.exercises[0]?.sets[0]?.values.weightKg).toBe(61.23);
  });

  it('clamps a value outside the limits and marks it, rounding to whole reps and seconds', () => {
    const draft = draftOf(
      gym(
        said('sentadilla 3x10 con 600', 'e3', group({ count: 3, reps: 10, weight: 600 })),
        said('press 150 reps con 60', 'e1', group({ reps: 150, weight: 60 })),
        said('press 8,4 reps', 'e1', group({ reps: 8.4, weight: 60.004 })),
        // The weight is dropped by the tracking: nothing left to review.
        said('plancha 30 s con 900', 'e5', group({ durationS: 30, weight: 900 })),
      ),
    );
    expect(draft.exercises[0]?.sets[0]).toEqual({
      values: values({ reps: 10, weightKg: 500 }),
      clamped: true,
    });
    expect(draft.exercises[1]?.sets[0]).toEqual({
      values: values({ reps: 100, weightKg: 60 }),
      clamped: true,
    });
    expect(draft.exercises[2]?.sets[0]).toEqual({
      values: values({ reps: 8, weightKg: 60 }),
      clamped: false,
    });
    expect(draft.exercises[3]?.sets[0]).toEqual({
      values: values({ durationS: 30 }),
      clamped: false,
    });
  });

  it('turns zero or negative values into "not said"', () => {
    const draft = draftOf(gym(said('press 0 con -5', 'e1', group({ reps: 0, weight: -5 }))));
    expect(draft.exercises[0]?.sets[0]?.values).toEqual(EMPTY_SET);
  });

  it('cuts at 20 sets per exercise and reads an odd count as at least one set', () => {
    const draft = draftOf(
      gym(
        said('press 25x5', 'e1', group({ count: 25, reps: 5, weight: 40 })),
        said('remo', 'e2', group({ count: 0, reps: 10, weight: 40 })),
        said('sentadilla', 'e3', group({ count: 2.6, reps: 5, weight: 80 })),
      ),
    );
    expect(draft.exercises.map((e) => e.sets.length)).toEqual([20, 1, 3]);
  });

  it('keeps two mentions of the same exercise as two exercises', () => {
    const draft = draftOf(
      gym(
        said('press banca 3x8 con 60', 'e1', group({ count: 3, reps: 8, weight: 60 })),
        said('y al final press banca 2x12 con 40', 'e1', group({ count: 2, reps: 12, weight: 40 })),
      ),
    );
    expect(draft.exercises.map((e) => e.exercise.id)).toEqual([BENCH.id, BENCH.id]);
  });

  it('trims a mention and caps it at 80 characters', () => {
    const long = `  ${'press banca muy largo '.repeat(10)}  `;
    const draft = draftOf(gym(said(long, 'e1', group({ reps: 8, weight: 60 }))));
    expect(draft.exercises[0]?.mention).toBe(long.trim().slice(0, 80));
  });

  it('keeps at most 30 exercises, unresolved ones included', () => {
    const many = Array.from({ length: 34 }, (_, i) =>
      said(`ejercicio ${i}`, i % 2 ? 'e1' : null, group({ reps: 8, weight: 20 })),
    );
    const draft = draftOf(gym(...many));
    expect(draft.exercises.length + draft.unresolved.length).toBe(30);
  });
});

describe('workoutDraft: exercises it cannot match (AC7, AC8)', () => {
  it('turns a ref it did not hand out, or no ref, into an unresolved mention in its place', () => {
    const draft = draftOf(
      gym(
        said('press banca 3x8 con 60', 'e1', group({ count: 3, reps: 8, weight: 60 })),
        said('press Larsen 3x8 con 50', null, group({ count: 3, reps: 8, weight: 50 })),
        said('remo 3x10 con 50', 'e2', group({ count: 3, reps: 10, weight: 50 })),
        said('jefferson curl 2x10', 'e999', group({ count: 2, reps: 10 })),
      ),
    );
    expect(draft.exercises.map((e) => e.exercise.id)).toEqual([BENCH.id, ROW.id]);
    expect(draft.unresolved).toEqual([
      {
        mention: 'press Larsen 3x8 con 50',
        sets: Array(3).fill({ values: values({ reps: 8, weightKg: 50 }), clamped: false }),
        position: 1,
      },
      {
        mention: 'jefferson curl 2x10',
        sets: Array(2).fill({ values: values({ reps: 10 }), clamped: false }),
        position: 2,
      },
    ]);
  });

  it('skips an unmatched mention without words', () => {
    const draft = draftOf(
      gym(said('   ', null, group({ reps: 8 })), said('remo 3x10', 'e2', group({ count: 3 }))),
    );
    expect(draft.unresolved).toEqual([]);
    expect(draft.exercises).toHaveLength(1);
  });
});

describe('workoutDraft: day, time, duration and effort (AC4)', () => {
  it('sets the day said, counted back from today, not from the screen day', () => {
    const draft = draftOf({ ...gym(said('remo', 'e2')), daysAgo: 1 });
    expect(draft.localDate).toBe('2026-11-23');
    expect(draft.dayDropped).toBe(false);
  });

  it('keeps the screen day when no day was said', () => {
    expect(draftOf(gym(said('remo', 'e2'))).localDate).toBe(SCREEN_DAY);
  });

  it.each([7, 30, -1, 1.5])(
    'drops a day outside today and the 6 days before (daysAgo %d)',
    (daysAgo) => {
      const draft = draftOf({ ...gym(said('remo', 'e2')), daysAgo });
      expect(draft.localDate).toBe(SCREEN_DAY);
      expect(draft.dayDropped).toBe(true);
    },
  );

  it('keeps a valid start time and drops anything else', () => {
    expect(draftOf({ ...gym(said('remo', 'e2')), startTime: '19:00' }).startTime).toBe('19:00');
    expect(draftOf({ ...gym(said('remo', 'e2')), startTime: '7pm' }).startTime).toBeNull();
    expect(draftOf({ ...gym(said('remo', 'e2')), startTime: '25:10' }).startTime).toBeNull();
  });

  it('keeps the duration and a numeric RPE, and drops values out of range', () => {
    const r = (minutes: number | null, sessionRpe: number | null) =>
      draftOf(reading({ gym: { exercises: [said('remo', 'e2')], minutes, sessionRpe } }));
    expect([r(60, 8).minutes, r(60, 8).sessionRpe]).toEqual([60, 8]);
    expect([r(null, null).minutes, r(null, null).sessionRpe]).toEqual([null, null]);
    expect([r(0, 0).minutes, r(0, 0).sessionRpe]).toEqual([null, null]);
    expect([r(700, 11).minutes, r(700, 11).sessionRpe]).toEqual([null, null]);
    expect([r(44.6, 7.6).minutes, r(44.6, 7.6).sessionRpe]).toEqual([45, 8]);
  });
});

describe('workoutDraft: activities (AC5, AC6)', () => {
  it('gives an activity with its type, minutes and RPE when the sentence has no gym session', () => {
    const draft = draftOf(
      reading({ activities: [activity({ minutes: 90, sessionRpe: 7 })], daysAgo: 0 }),
    );
    expect(draft.activity).toEqual({
      activity: 'padel',
      mention: 'pádel',
      minutes: 90,
      sessionRpe: 7,
      distanceDropped: false,
    });
    expect(draft.exercises).toEqual([]);
    expect(draft.minutes).toBeNull();
    expect(draft.localDate).toBe(TODAY);
  });

  it('drops minutes outside 5–600 and says when a distance was dropped', () => {
    const draft = draftOf(
      reading({
        activities: [
          activity({ mention: 'corrí 5 km', activity: 'running', minutes: 3, distanceSaid: true }),
        ],
      }),
    );
    expect(draft.activity).toMatchObject({ minutes: null, distanceDropped: true });
  });

  it('keeps the gym session as the draft and lists at most 2 other activities', () => {
    const draft = draftOf(
      reading({
        gym: { exercises: [said('remo', 'e2')], minutes: null, sessionRpe: null },
        activities: [
          activity({ minutes: 60 }),
          activity({ mention: 'fútbol', activity: 'football' }),
          activity({ mention: 'natación', activity: 'swimming' }),
        ],
      }),
    );
    expect(draft.activity).toBeNull();
    expect(draft.extraActivities.map((a) => [a.activity, a.minutes])).toEqual([
      ['padel', 60],
      ['football', null],
    ]);
    expect(draft.ignored).toBe(1);
  });

  it('takes the first of two activities as the draft and the other as a line', () => {
    const draft = draftOf(
      reading({
        activities: [
          activity({ mention: 'spinning de 45', activity: 'group_class', minutes: 45 }),
          activity({ minutes: 60 }),
        ],
      }),
    );
    expect(draft.activity?.activity).toBe('group_class');
    expect(draft.extraActivities.map((a) => a.activity)).toEqual(['padel']);
    expect(draft.ignored).toBe(0);
  });

  it('counts a gym session with only unresolved exercises as the gym session', () => {
    const draft = draftOf(
      reading({
        gym: { exercises: [said('press Larsen', null)], minutes: null, sessionRpe: null },
        activities: [activity({})],
      }),
    );
    expect(draft.activity).toBeNull();
    expect(draft.unresolved).toHaveLength(1);
    expect(draft.extraActivities).toHaveLength(1);
  });
});

describe('workoutDraft: no workout (AC9) and pain (AC15)', () => {
  it.each(['not_workout', 'unclear'] as const)('passes on %s', (status) => {
    expect(workoutDraft(reading({ status }), REFS, TODAY, SCREEN_DAY)).toEqual({
      status: 'unreadable',
      reason: status,
    });
  });

  it('answers unclear when an ok reading holds nothing usable', () => {
    const empty = reading({ gym: { exercises: [], minutes: 60, sessionRpe: null } });
    expect(workoutDraft(empty, REFS, TODAY, SCREEN_DAY)).toEqual({
      status: 'unreadable',
      reason: 'unclear',
    });
  });

  it('passes on the pain flag', () => {
    expect(draftOf({ ...gym(said('remo', 'e2')), painMentioned: true }).painMentioned).toBe(true);
  });
});

// ── On screen ────────────────────────────────────────────────────────────────────────────────────

const STARTED = '2026-11-23T18:00:00.000Z';

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const wset = (over: Partial<WorkoutSet>, setNumber = 1): WorkoutSet => ({
  ...EMPTY_SET,
  restS: null,
  setNumber,
  ...over,
});

const benchStats: ExerciseStats = {
  exerciseId: BENCH.id,
  last: {
    workoutId: 'w0',
    localDate: '2026-11-16',
    sets: [wset({ reps: 8, weightKg: 60, restS: 120 }), wset({ reps: 6, weightKg: 65 }, 2)],
  },
  bests: {
    ...NO_BESTS,
    heaviestKg: { value: 65, localDate: '2026-11-16' },
    oneRepMaxKg: { value: 76, localDate: '2026-11-16' },
    mostReps: { value: 8, localDate: '2026-11-16' },
  },
  lastDoneAt: '2026-11-16T18:00:00.000Z',
};
const squatStats: ExerciseStats = {
  ...benchStats,
  exerciseId: SQUAT.id,
  last: { ...benchStats.last, sets: [wset({ reps: 5, weightKg: 100 })] },
  bests: { ...NO_BESTS, heaviestKg: { value: 100, localDate: '2026-11-16' } },
};
const STATS = new Map([
  [BENCH.id, benchStats],
  [SQUAT.id, squatStats],
]);

const toSession = (
  draft: WorkoutDraft,
  routine?: Parameters<typeof draftToSession>[1]['routine'],
) =>
  draftToSession(draft, {
    id: 'w1',
    startedAt: STARTED,
    stats: STATS,
    newId: ids(),
    locale: 'es',
    routine,
  });

describe('draftToSession: the session editor (AC10, AC11)', () => {
  it('opens a past session with the draft day, duration and RPE, in the text input method', () => {
    const session = toSession({
      ...draftOf(reading({ gym: { exercises: [said('remo', 'e2')], minutes: 60, sessionRpe: 8 } })),
      localDate: '2026-11-23',
    });
    expect(session).toMatchObject({
      id: 'w1',
      mode: 'manual',
      inputMethod: 'text',
      localDate: '2026-11-23',
      startedAt: STARTED,
      minutes: 60,
      sessionRpe: 8,
      programSessionId: null,
      rest: null,
    });
    expect(session.exercises[0]?.label).toBe('Remo con barra');
  });

  it('completes a set with every value its tracking needs', () => {
    const session = toSession(
      draftOf(gym(said('press 2x8 con 60', 'e1', group({ count: 2, reps: 8, weight: 60 })))),
    );
    const sets = session.exercises[0]!.sets;
    expect(sets.map((s) => [s.values, s.completedAt, s.mark ?? null])).toEqual([
      [values({ reps: 8, weightKg: 60 }), STARTED, null],
      [values({ reps: 8, weightKg: 60 }), STARTED, null],
    ]);
  });

  it('leaves a set missing a value uncompleted, with last time as its placeholder', () => {
    const session = toSession(
      draftOf(gym(said('press 2x10', 'e1', group({ count: 2, reps: 10 })))),
    );
    const sets = session.exercises[0]!.sets;
    expect(sets.map((s) => [s.values, s.placeholder, s.completedAt, s.mark])).toEqual([
      [values({ reps: 10 }), values({ reps: 8, weightKg: 60 }), null, 'incomplete'],
      [values({ reps: 10 }), values({ reps: 6, weightKg: 65 }), null, 'incomplete'],
    ]);
  });

  it('gives an exercise said without sets the sets of last time, uncompleted', () => {
    const session = toSession(draftOf(gym(said('y press banca', 'e1'))));
    const sets = session.exercises[0]!.sets;
    expect(sets).toHaveLength(2);
    expect(sets.every((s) => s.completedAt === null)).toBe(true);
    expect(sets[1]?.placeholder).toEqual(values({ reps: 6, weightKg: 65 }));
  });

  it('leaves a set more than 50 % above the heaviest weight uncompleted (AC11)', () => {
    const session = toSession(
      draftOf(gym(said('sentadilla 5 con 160', 'e3', group({ reps: 5, weight: 160 })))),
    );
    const set = session.exercises[0]!.sets[0]!;
    expect(set.completedAt).toBeNull();
    expect(set.values).toEqual(values({ reps: 5, weightKg: 160 }));
  });

  it('leaves a clamped set uncompleted and marked for review', () => {
    const session = toSession(
      draftOf(gym(said('press 8 con 600', 'e1', group({ reps: 8, weight: 600 })))),
    );
    const set = session.exercises[0]!.sets[0]!;
    expect([set.completedAt, set.mark]).toEqual([null, 'review']);
  });

  it('shows the record badge on a draft set that beats a best (AC11)', () => {
    const session = toSession(
      draftOf(gym(said('press 10 con 62,5', 'e1', group({ reps: 10, weight: 62.5 })))),
    );
    const exercise = session.exercises[0]!;
    const kinds = liveSetRecords(exercise, exercise.sets[0]!.id, session.localDate).map(
      (r) => r.kind,
    );
    expect(kinds).toContain('oneRepMaxKg');
  });

  it('keeps what the editor shows besides the exercises', () => {
    const draft: WorkoutDraft = {
      ...draftOf(
        reading({
          gym: {
            exercises: [said('remo', 'e2'), said('press Larsen 3x8', null, group({ count: 3 }))],
            minutes: null,
            sessionRpe: null,
          },
          activities: [activity({ minutes: 60 })],
          painMentioned: true,
        }),
      ),
      dayDropped: true,
    };
    expect(toSession(draft).textDraft).toEqual({
      unresolved: draft.unresolved,
      extraActivities: draft.extraActivities,
      painMentioned: true,
      ignored: 0,
      dayDropped: true,
      routineSessionId: null,
    });
  });

  it('saves only the completed sets, with the text input method (AC14)', () => {
    const session = toSession(
      draftOf(
        gym(
          said('press 8 con 60', 'e1', group({ reps: 8, weight: 60 })),
          said('sentadilla 3x5', 'e3', group({ count: 3, reps: 5 })),
        ),
      ),
    );
    const request = sessionToRequest(session, {
      minutes: 60,
      sessionRpe: null,
      name: null,
      recordedAt: STARTED,
      today: TODAY,
      locale: 'es',
    });
    expect(request?.inputMethod).toBe('text');
    expect(request?.exercises.map((e) => [e.exerciseId, e.sets.length])).toEqual([[BENCH.id, 1]]);
  });
});

// ── Routine match (AC13) ─────────────────────────────────────────────────────────────────────────

const programExercise = (id: string | null) => ({
  exerciseId: id,
  label: 'x',
  tracking: 'weight_reps' as const,
  sets: 3,
  repsMin: 8,
  repsMax: 12,
  durationS: null,
  restS: null,
});
const routineSession = (n: number, ...exerciseIds: (string | null)[]): ProgramSession => ({
  id: uuid(100 + n),
  name: `Rutina ${n}`,
  exercises: exerciseIds.map(programExercise),
});

const A = routineSession(1, BENCH.id, ROW.id, SQUAT.id, PLANK.id);
const B = routineSession(2, SQUAT.id, PULLUP.id);
const C = routineSession(3, BENCH.id, ROW.id);
const EMPTY = routineSession(4);

describe('matchRoutineSession (AC13)', () => {
  it('matches a session when the draft holds at least half of its exercises', () => {
    expect(matchRoutineSession([BENCH.id, ROW.id], { sessions: [A, EMPTY] }, A.id)?.id).toBe(A.id);
    expect(matchRoutineSession([BENCH.id], { sessions: [A, EMPTY] }, A.id)).toBeNull();
  });

  it('picks the session with most exercises in common', () => {
    const ids = [BENCH.id, ROW.id, SQUAT.id];
    expect(matchRoutineSession(ids, { sessions: [C, A, B] }, C.id)?.id).toBe(A.id);
  });

  it('breaks a tie with the next session of the rotation', () => {
    const ids = [BENCH.id, ROW.id, SQUAT.id, PULLUP.id, ERG.id];
    // A has 3 in common, B 2 and C 2: A wins outright.
    expect(matchRoutineSession(ids, { sessions: [A, B, C] }, B.id)?.id).toBe(A.id);
    const tie = [SQUAT.id, PULLUP.id, BENCH.id, ROW.id];
    // A has 3 in common, so it wins; without A, B and C tie at 2: the rotation decides.
    expect(matchRoutineSession(tie, { sessions: [A, B, C] }, B.id)?.id).toBe(A.id);
    expect(matchRoutineSession(tie, { sessions: [B, C] }, B.id)?.id).toBe(B.id);
    expect(matchRoutineSession(tie, { sessions: [B, C] }, C.id)?.id).toBe(C.id);
    expect(matchRoutineSession(tie, { sessions: [B, C] }, null)?.id).toBe(B.id);
  });

  it('counts each exercise once and ignores removed exercises and empty sessions', () => {
    const withRemoved = routineSession(5, BENCH.id, null, null, null);
    expect(matchRoutineSession([BENCH.id, BENCH.id], { sessions: [withRemoved] }, null)?.id).toBe(
      withRemoved.id,
    );
    expect(matchRoutineSession([], { sessions: [EMPTY] }, null)).toBeNull();
  });

  it('links the draft to the matched session, on by default', () => {
    const draft = draftOf(gym(said('press', 'e1'), said('remo', 'e2')));
    const session = toSession(draft, { program: { sessions: [B, C] }, nextSessionId: B.id });
    expect(session.programSessionId).toBe(C.id);
    expect(session.textDraft?.routineSessionId).toBe(C.id);
    const off = sessionReducer(session, { type: 'setRoutineLink', on: false });
    expect(off.programSessionId).toBeNull();
    expect(sessionReducer(off, { type: 'setRoutineLink', on: true }).programSessionId).toBe(C.id);
  });
});

// ── Editing the draft (AC7, AC12) ────────────────────────────────────────────────────────────────

describe('editing a draft', () => {
  const base = () =>
    toSession(
      draftOf(
        reading({
          gym: {
            exercises: [
              said('press 2x8 con 60', 'e1', group({ count: 2, reps: 8, weight: 60 })),
              said('press Larsen 3x8 con 50', null, group({ count: 3, reps: 8, weight: 50 })),
              said('remo 3x10', 'e2', group({ count: 3, reps: 10 })),
              said('jefferson curl 2x10', null, group({ count: 2, reps: 10 })),
            ],
            minutes: null,
            sessionRpe: null,
          },
          activities: [activity({ minutes: 60 })],
        }),
      ),
    );

  it('resolves a mention into its place, with the sets said checked against the tracking', () => {
    const session = base();
    const mention = session.textDraft!.unresolved[0]!;
    const resolved = liveExerciseFromDraft({
      exercise: { id: SQUAT.id, label: 'Sentadilla', tracking: 'weight_reps' },
      sets: mention.sets,
      stats: squatStats,
      newId: ids(),
      completedAt: session.startedAt,
    });
    const next = sessionReducer(session, { type: 'resolveMention', index: 0, exercise: resolved });
    expect(next.exercises.map((e) => e.exerciseId)).toEqual([BENCH.id, SQUAT.id, ROW.id]);
    // 3 × 8 with 50 kg: below 150 kg, so completed.
    expect(next.exercises[1]?.sets.every((s) => s.completedAt === session.startedAt)).toBe(true);
    // The other mention keeps its place after the remo.
    expect(next.textDraft?.unresolved).toEqual([
      { ...session.textDraft!.unresolved[1]!, position: 3 },
    ]);
  });

  it('keeps the order of two mentions said together when the second is resolved first', () => {
    const draft = draftOf(
      gym(said('press', 'e1'), said('uno raro', null), said('otro raro', null), said('remo', 'e2')),
    );
    const session = toSession(draft);
    const resolved = liveExerciseFromDraft({
      exercise: { id: PLANK.id, label: 'Plancha', tracking: 'duration' },
      sets: [],
      stats: null,
      newId: ids(),
      completedAt: session.startedAt,
    });
    const next = sessionReducer(session, { type: 'resolveMention', index: 1, exercise: resolved });
    expect(next.exercises.map((e) => e.exerciseId)).toEqual([BENCH.id, PLANK.id, ROW.id]);
    expect(next.textDraft?.unresolved).toEqual([{ ...draft.unresolved[0]!, position: 1 }]);
  });

  it('removes a mention and an extra activity', () => {
    const session = base();
    const next = sessionReducer(sessionReducer(session, { type: 'removeMention', index: 0 }), {
      type: 'removeExtraActivity',
      index: 0,
    });
    expect(next.textDraft?.unresolved.map((u) => u.mention)).toEqual(['jefferson curl 2x10']);
    expect(next.textDraft?.extraActivities).toEqual([]);
  });

  it('changes an exercise keeping the values its tracking uses (AC12)', () => {
    const session = base();
    const uid = session.exercises[0]!.uid;
    const toPullups = sessionReducer(session, {
      type: 'replaceExercise',
      uid,
      exercise: { id: PULLUP.id, label: 'Dominadas', tracking: 'reps' },
      stats: null,
    });
    const changed = toPullups.exercises[0]!;
    expect(changed.uid).toBe(uid);
    expect([changed.exerciseId, changed.label, changed.tracking]).toEqual([
      PULLUP.id,
      'Dominadas',
      'reps',
    ]);
    expect(changed.sets.map((s) => [s.values, s.completedAt])).toEqual([
      [values({ reps: 8, weightKg: 60 }), STARTED],
      [values({ reps: 8, weightKg: 60 }), STARTED],
    ]);
    expect(changed.bestsBefore).toEqual(NO_BESTS);
    expect(changed.last).toBeNull();
  });

  it('sends a set left without a needed value back to uncompleted, with the new placeholders', () => {
    const session = base();
    const uid = session.exercises[0]!.uid;
    const toPlank = sessionReducer(session, {
      type: 'replaceExercise',
      uid,
      exercise: { id: PLANK.id, label: 'Plancha', tracking: 'duration' },
      stats: null,
    });
    expect(toPlank.exercises[0]?.sets.map((s) => [s.values, s.completedAt])).toEqual([
      [EMPTY_SET, null],
      [EMPTY_SET, null],
    ]);
    const toSquat = sessionReducer(session, {
      type: 'replaceExercise',
      uid: session.exercises[1]!.uid,
      exercise: { id: SQUAT.id, label: 'Sentadilla', tracking: 'weight_reps' },
      stats: squatStats,
    });
    const squat = toSquat.exercises[1]!;
    expect(squat.sets[0]?.placeholder).toEqual(values({ reps: 5, weightKg: 100 }));
    expect(squat.bestsBefore).toEqual(squatStats.bests);
  });

  it('clears the mark of a set when it is completed, and the day mark when the day changes', () => {
    const session = base();
    const remo = session.exercises[1]!;
    const done = sessionReducer(session, {
      type: 'updateSet',
      uid: remo.uid,
      setId: remo.sets[0]!.id,
      values: { weightKg: 50 },
    });
    const completed = sessionReducer(done, {
      type: 'completeSet',
      uid: remo.uid,
      setId: remo.sets[0]!.id,
      at: STARTED,
    });
    expect(completed.exercises[1]?.sets[0]?.mark ?? null).toBeNull();
    const withDayMark = { ...session, textDraft: { ...session.textDraft!, dayDropped: true } };
    const moved = sessionReducer(withDayMark, {
      type: 'setStart',
      localDate: '2026-11-21',
      startedAt: '2026-11-21T18:00:00.000Z',
    });
    expect(moved.textDraft?.dayDropped).toBe(false);
  });

  it('never saves an unresolved mention', () => {
    const request = sessionToRequest(base(), {
      minutes: 60,
      sessionRpe: null,
      name: null,
      recordedAt: STARTED,
      today: TODAY,
      locale: 'es',
    });
    expect(request?.exercises.map((e) => e.exerciseId)).toEqual([BENCH.id]);
  });
});
