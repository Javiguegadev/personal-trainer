import {
  ProgramUpsertRequestSchema,
  type EquipmentAccess,
  type ExerciseTracking,
  type PlannedActivity,
  type TrainingExperience,
  type TrainingFocus,
} from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { programToRequest } from './program';
import {
  ROUTINE_TEMPLATES,
  chooseRoutineTemplate,
  emptyRoutine,
  exerciseSeconds,
  WARM_UP_MINUTES,
  routineDays,
  routineExerciseKeys,
  routineSafety,
  routineTarget,
  starterRoutine,
  trimToMinutes,
  type RoutineCatalogEntry,
} from './routine';

const DURATION_KEYS = new Set(['plancha']);
const REPS_KEYS = new Set([
  'sentadilla-sin-peso',
  'zancadas-caminando',
  'puente-gluteo-una-pierna',
  'puente-gluteo',
  'flexiones',
  'flexiones-declinadas',
  'flexiones-inclinadas',
  'remo-invertido',
  'crunch',
]);
const tracking = (key: string): ExerciseTracking =>
  DURATION_KEYS.has(key) ? 'duration' : REPS_KEYS.has(key) ? 'reps' : 'weight_reps';

const KEYS = routineExerciseKeys();
const idOf = (key: string) =>
  `00000000-0000-4000-9000-${String(KEYS.indexOf(key) + 1).padStart(12, '0')}`;

/** A stand-in catalog with every key of the templates (the real one is checked in @pt/db). */
const catalogByKey = new Map<string, RoutineCatalogEntry>(
  routineExerciseKeys().map((key) => [
    key,
    { id: idOf(key), nameEs: `es ${key}`, nameEn: `en ${key}`, tracking: tracking(key) },
  ]),
);

function ids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

const names = {
  program: (key: string) => `Rutina ${key}`,
  session: (key: string) => `Sesión ${key}`,
};

const build = (
  input: Partial<{
    days: number;
    minutes: number;
    experience: TrainingExperience;
    equipment: EquipmentAccess;
    focus: TrainingFocus;
    flags: readonly ('teen_limited' | 'pregnancy' | 'ed_soft_stop')[];
  }> = {},
) =>
  starterRoutine(
    {
      days: 3,
      minutes: 60,
      experience: 'beginner',
      equipment: 'full_gym',
      focus: 'hypertrophy',
      flags: [],
      ...input,
    },
    { catalogByKey, locale: 'es', newId: ids(), names },
  );

const EXPERIENCES = ['beginner', 'intermediate', 'advanced'] as const;
const EQUIPMENT = ['full_gym', 'home_dumbbells', 'bodyweight'] as const;
const FOCUSES = ['hypertrophy', 'strength', 'sport_performance', 'general_fitness'] as const;

describe('chooseRoutineTemplate (spec 010 AC15)', () => {
  const choose = (
    days: number,
    experience: TrainingExperience,
    focus: TrainingFocus = 'hypertrophy',
  ) => chooseRoutineTemplate({ days, experience, focus, equipment: 'full_gym' });

  it('follows the days and the experience', () => {
    expect(choose(1, 'advanced')).toBe('full-body');
    expect(choose(2, 'advanced')).toBe('full-body-ab');
    expect(choose(3, 'beginner')).toBe('full-body-ab');
    expect(choose(3, 'intermediate')).toBe('full-body-abc');
    expect(choose(4, 'beginner')).toBe('upper-lower');
    expect(choose(4, 'advanced')).toBe('upper-lower');
    expect(choose(5, 'intermediate')).toBe('push-pull-legs');
    expect(choose(6, 'advanced')).toBe('push-pull-legs');
    expect(choose(5, 'beginner')).toBe('upper-lower');
    expect(choose(6, 'beginner')).toBe('upper-lower');
  });

  it('never gives sport performance more than 3 distinct sessions', () => {
    for (const experience of EXPERIENCES) {
      for (const days of [1, 2, 3, 4, 5, 6, 7]) {
        const key = choose(days, experience, 'sport_performance');
        expect(ROUTINE_TEMPLATES[key].length).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('routineTarget (spec 010 AC15, Safety)', () => {
  const target = (
    focus: TrainingFocus,
    compound: boolean,
    experience: TrainingExperience = 'intermediate',
    teen = false,
  ) => routineTarget({ focus, compound, experience, teen, tracking: 'weight_reps' });

  it('uses the rep ranges of each focus', () => {
    expect(target('strength', true)).toMatchObject({ repsMin: 4, repsMax: 6 });
    expect(target('strength', true, 'advanced')).toMatchObject({ repsMin: 4, repsMax: 6 });
    expect(target('strength', false)).toMatchObject({ repsMin: 6, repsMax: 10 });
    expect(target('hypertrophy', true)).toMatchObject({ repsMin: 8, repsMax: 12 });
    expect(target('general_fitness', true)).toMatchObject({ repsMin: 10, repsMax: 15 });
    expect(target('sport_performance', false)).toMatchObject({ repsMin: 10, repsMax: 15 });
  });

  it('gives beginners 6–10 reps on compound lifts with the strength focus', () => {
    expect(target('strength', true, 'beginner')).toMatchObject({ repsMin: 6, repsMax: 10 });
  });

  it('gives 16–17-year-olds 6–10 reps on compound lifts', () => {
    expect(target('strength', true, 'intermediate', true)).toMatchObject({
      repsMin: 6,
      repsMax: 10,
    });
  });

  it('keeps beginners at 2–3 sets and general fitness and sport at 3 at most', () => {
    expect(target('hypertrophy', true, 'beginner').sets).toBe(3);
    expect(target('hypertrophy', false, 'beginner').sets).toBe(2);
    expect(target('hypertrophy', true, 'advanced').sets).toBe(4);
    expect(target('general_fitness', true, 'advanced').sets).toBe(3);
    expect(target('sport_performance', true, 'advanced').sets).toBe(3);
  });

  it('gives a time to time exercises', () => {
    expect(
      routineTarget({
        focus: 'strength',
        compound: false,
        experience: 'beginner',
        teen: false,
        tracking: 'duration',
      }),
    ).toEqual({ sets: 2, repsMin: null, repsMax: null, durationS: 30, restS: 60 });
  });

  it('never prescribes fewer than 4 reps for anyone', () => {
    for (const focus of FOCUSES) {
      for (const experience of EXPERIENCES) {
        for (const teen of [false, true]) {
          for (const compound of [false, true]) {
            const { repsMin } = target(focus, compound, experience, teen);
            expect(repsMin).toBeGreaterThanOrEqual(4);
          }
        }
      }
    }
  });
});

describe('trimToMinutes (spec 010 AC15)', () => {
  // Each set: 45 s of work + 120 s of rest = 165 s.
  const six = [4, 3, 3, 3, 2, 2].map((sets, i) => ({ i, sets, restS: 120, durationS: null }));

  it('counts each set as its work (45 s, or its time) plus its rest', () => {
    expect(exerciseSeconds({ sets: 3, restS: 180, durationS: null })).toBe(675);
    expect(exerciseSeconds({ sets: 2, restS: 60, durationS: 30 })).toBe(180);
    expect(exerciseSeconds({ sets: 1, restS: null, durationS: null })).toBe(135); // default rest
  });

  it('keeps everything that fits after 5 min of warm-up', () => {
    // 17 sets × 165 s = 46.75 min, + 5 ≤ 60.
    expect(trimToMinutes(six, 60)).toEqual(six);
  });

  it('drops exercises from the end, then lowers sets from the last one back', () => {
    // 45 min − 5 = 2400 s: 15 sets (2475 s) is too long, 13 sets (2145 s) fits.
    expect(trimToMinutes(six, 45).map((e) => e.sets)).toEqual([4, 3, 3, 3]);
    // 40 min − 5 = 2100 s: 4 exercises, then one set less on the last (12 sets, 1980 s).
    expect(trimToMinutes(six, 40).map((e) => e.sets)).toEqual([4, 3, 3, 2]);
  });

  it('keeps 4 exercises with 2 sets at 30 min or less', () => {
    expect(trimToMinutes(six, 30).map((e) => e.sets)).toEqual([2, 2, 2, 2]);
    expect(trimToMinutes(six, 20).map((e) => e.i)).toEqual([0, 1, 2, 3]);
  });
});

describe('starterRoutine (spec 010 AC15)', () => {
  it('builds full body A/B for 3 beginner days at the gym, in the user locale', () => {
    const routine = build();
    expect(routine).toMatchObject({
      name: 'Rutina full-body-ab',
      origin: 'template',
      templateKey: 'full-body-ab',
    });
    expect(routine!.sessions.map((s) => s.name)).toEqual([
      'Sesión full_body_a',
      'Sesión full_body_b',
    ]);
    expect(routine!.sessions[0]!.exercises[0]).toEqual({
      exerciseId: idOf('sentadilla'),
      label: 'es sentadilla',
      tracking: 'weight_reps',
      sets: 3,
      repsMin: 8,
      repsMax: 12,
      durationS: null,
      restS: 120,
    });
  });

  it('uses the exercises of the equipment', () => {
    const home = build({ equipment: 'home_dumbbells' })!.sessions[0]!.exercises;
    expect(home[0]!.exerciseId).toBe(idOf('sentadilla-goblet'));
    const body = build({ equipment: 'bodyweight' })!.sessions[0]!.exercises;
    expect(body.map((e) => e.exerciseId)).toContain(idOf('flexiones'));
  });

  it('gives every combination valid sessions with at least 4 exercises and no repeats', () => {
    for (const experience of EXPERIENCES) {
      for (const equipment of EQUIPMENT) {
        for (const focus of FOCUSES) {
          for (const days of [1, 2, 3, 4, 5, 6, 7]) {
            for (const minutes of [20, 30, 45, 60, 90]) {
              for (const teen of [false, true]) {
                const flags = teen ? (['teen_limited'] as const) : [];
                const routine = build({ days, minutes, experience, equipment, focus, flags })!;
                const label = `${experience} ${equipment} ${focus} ${days} d ${minutes} min`;
                // The routine is never more frequent than the declared days (ed_soft_stop).
                expect(routine.sessions.length, label).toBeLessThanOrEqual(days);
                if (teen) expect(routine.sessions.length, label).toBeLessThanOrEqual(4);
                for (const session of routine.sessions) {
                  const keys = session.exercises.map((e) => e.exerciseId);
                  expect(keys.length, label).toBeGreaterThanOrEqual(4);
                  expect(new Set(keys).size, label).toBe(keys.length);
                  // Never longer than the declared minutes above 30 (ed_soft_stop).
                  const seconds = session.exercises.reduce((sum, e) => sum + exerciseSeconds(e), 0);
                  if (minutes > 30) {
                    expect(seconds / 60 + WARM_UP_MINUTES, label).toBeLessThanOrEqual(minutes);
                  }
                }
                const request = programToRequest(routine, {
                  recordedAt: '2026-11-20T10:00:00.000Z',
                  locale: 'es',
                });
                expect(ProgramUpsertRequestSchema.safeParse(request).success, label).toBe(true);
              }
            }
          }
        }
      }
    }
  });

  it('gives every bodyweight session a pull, no bench dips, and easier push-ups to beginners', () => {
    for (const experience of EXPERIENCES) {
      for (const days of [1, 2, 3, 4, 5, 6]) {
        const routine = build({ days, minutes: 90, experience, equipment: 'bodyweight' })!;
        for (const session of routine.sessions) {
          const keys = session.exercises.map((e) => e.exerciseId);
          expect(keys).toContain(idOf('remo-invertido'));
          expect(keys).not.toContain(idOf('fondos-banco'));
          if (experience === 'beginner') expect(keys).not.toContain(idOf('flexiones-declinadas'));
        }
      }
    }
    const beginnerB = build({ equipment: 'bodyweight' })!.sessions[1]!.exercises;
    expect(beginnerB.map((e) => e.exerciseId)).toContain(idOf('flexiones-inclinadas'));
  });

  it('skips exercises missing from the catalog', () => {
    const small = new Map([...catalogByKey].filter(([key]) => key !== 'sentadilla'));
    const routine = starterRoutine(
      {
        days: 1,
        minutes: 60,
        experience: 'beginner',
        equipment: 'full_gym',
        focus: 'hypertrophy',
        flags: [],
      },
      { catalogByKey: small, locale: 'en', newId: ids(), names },
    )!;
    expect(routine.sessions[0]!.exercises[0]).toMatchObject({
      exerciseId: idOf('press-banca'),
      label: 'en press-banca',
    });
  });

  it('builds no template with pregnancy (Safety)', () => {
    expect(build({ flags: ['pregnancy'] })).toBeNull();
    expect(routineSafety(['pregnancy'])).toEqual({ buildsTemplate: false, showsPainLine: false });
    expect(routineSafety(['injury']).showsPainLine).toBe(true);
    expect(routineSafety(['medical_condition']).showsPainLine).toBe(true);
    const empty = emptyRoutine({ newId: ids(), name: 'Mi rutina', sessionName: 'Sesión A' });
    expect(empty).toMatchObject({ origin: 'user', templateKey: null });
    expect(empty.sessions).toEqual([{ id: expect.any(String), name: 'Sesión A', exercises: [] }]);
  });
});

describe('routineDays (spec 010 AC13, AC14)', () => {
  const activity = (kind: PlannedActivity['kind'], sessionsPerWeek: number, minutes: number) => ({
    kind,
    label: null,
    sessionsPerWeek,
    minutesPerSession: minutes,
    intensity: 'moderate' as const,
    days: [],
  });

  it('takes the gym days and minutes from the strength activities', () => {
    expect(routineDays([activity('strength', 3, 60), activity('sport', 2, 90)])).toEqual({
      days: 3,
      minutes: 60,
    });
    expect(routineDays([activity('strength', 5, 60), activity('strength', 4, 45)])).toEqual({
      days: 7,
      minutes: 45,
    });
  });

  it('is null without a strength activity', () => {
    expect(routineDays([activity('sport', 2, 90)])).toBeNull();
    expect(routineDays([])).toBeNull();
  });
});
