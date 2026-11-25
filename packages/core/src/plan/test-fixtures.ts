/**
 * Shared fixtures for the planner tests (spec 013). Not exported from the package: only `*.test.ts`
 * files import it.
 */
import {
  CATALOG_FOOD_FIELDS,
  type Food,
  type MealItem,
  type PlannedActivity,
  type PlannedMealItem,
  type PlannedWorkout,
  type Program,
  type ProgramSession,
  type Workout,
} from '@pt/contracts';
import { applyDaysToActivity } from '../week/typical';

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A fresh id generator: uuid(start), uuid(start + 1)… */
export function idSequence(start = 9000): () => string {
  let next = start;
  return () => uuid(next++);
}

/** Wednesday 25 November 2026: the current week starts on Monday 23. */
export const TODAY = '2026-11-25';
export const RECORDED = '2026-11-25T09:00:00.000Z';
export const LATER = '2026-11-25T09:05:00.000Z';

export const SERVING = uuid(700);
export const RICE: Food = {
  id: uuid(600),
  key: 'd-arroz',
  name: 'Arroz blanco cocido',
  per100g: { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, fiberG: 0.4 },
  servings: [{ id: SERVING, label: '1 plato', grams: 200 }],
  source: 'bedca',
  ...CATALOG_FOOD_FIELDS,
};

export function plannedItem(over: Partial<PlannedMealItem> = {}): PlannedMealItem {
  return {
    id: uuid(1),
    localDate: '2026-11-27',
    mealType: 'dinner',
    foodId: RICE.id,
    servingId: null,
    servings: null,
    servingLabel: null,
    grams: 200,
    unit: 'g',
    label: RICE.name,
    nutrients: { kcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, fiberG: 0.8 },
    recordedAt: RECORDED,
    ...over,
  };
}

export function loggedItem(over: Partial<MealItem> = {}): MealItem {
  return {
    ...plannedItem(),
    id: uuid(100),
    localDate: TODAY,
    inputMethod: 'search',
    plannedItemId: null,
    ...over,
  };
}

const exercise = (n: number, sets: number) => ({
  exerciseId: uuid(800 + n),
  label: `Ejercicio ${n}`,
  tracking: 'weight_reps' as const,
  sets,
  repsMin: 8,
  repsMax: 12,
  durationS: null,
  restS: null,
});

export const SESSION_A: ProgramSession = {
  id: uuid(201),
  name: 'Rutina A',
  exercises: [exercise(1, 3), exercise(2, 3), exercise(3, 3), exercise(4, 3), exercise(5, 2)],
};
export const SESSION_B: ProgramSession = {
  id: uuid(202),
  name: 'Rutina B',
  exercises: [exercise(6, 4), exercise(7, 3), exercise(8, 3), exercise(9, 3)],
};
export const SESSION_C: ProgramSession = {
  id: uuid(203),
  name: 'Rutina C',
  exercises: [exercise(10, 3), exercise(11, 3), exercise(12, 3), exercise(13, 3)],
};
export const PROGRAM: Program = {
  id: uuid(200),
  name: 'Full body',
  origin: 'template',
  templateKey: 'full-body-abc',
  sessions: [SESSION_A, SESSION_B, SESSION_C],
  recordedAt: '2026-11-01T09:00:00.000Z',
};
/** A session of a routine the user deleted (spec 010 AC20): its row is still there. */
export const OLD_SESSION_ID = uuid(299);

export function plannedSession(over: Partial<PlannedWorkout> = {}): PlannedWorkout {
  return {
    id: uuid(300),
    localDate: TODAY,
    startMinute: 1110,
    kind: 'gym',
    activity: null,
    name: SESSION_A.name,
    minutes: 60,
    isMatch: false,
    programSessionId: SESSION_A.id,
    repeatWorkoutId: null,
    recordedAt: RECORDED,
    ...over,
  };
}

export function plannedActivity(over: Partial<PlannedWorkout> = {}): PlannedWorkout {
  return plannedSession({
    id: uuid(350),
    kind: 'sport',
    activity: null,
    name: 'Fútbol',
    minutes: 90,
    programSessionId: null,
    startMinute: 1140,
    ...over,
  });
}

export function workout(over: Partial<Workout> = {}): Workout {
  return {
    id: uuid(400),
    localDate: '2026-11-23',
    kind: 'gym',
    activity: null,
    name: SESSION_A.name,
    startedAt: '2026-11-23T17:30:00.000Z',
    minutes: 55,
    sessionRpe: null,
    inputMethod: 'program',
    programSessionId: SESSION_A.id,
    plannedWorkoutId: null,
    exercises: [],
    recordedAt: '2026-11-23T18:30:00.000Z',
    ...over,
  };
}

/** Gym on Monday, Wednesday and Friday at 18:30, 60 minutes. */
export const GYM_MWF: PlannedActivity = applyDaysToActivity(
  {
    kind: 'strength',
    label: null,
    sessionsPerWeek: 3,
    minutesPerSession: 60,
    intensity: 'moderate',
    days: [],
  },
  [1, 3, 5].map((weekday) => ({ weekday, startMinute: 1110, isMatch: false })),
);

/** Football ("Fútbol", hard): training on Thursday, a match on Sunday at 11:00. */
export const FOOTBALL: PlannedActivity = applyDaysToActivity(
  {
    kind: 'sport',
    label: 'Fútbol',
    sessionsPerWeek: 2,
    minutesPerSession: 90,
    intensity: 'hard',
    days: [],
  },
  [
    { weekday: 4, startMinute: 1200, isMatch: false },
    { weekday: 7, startMinute: 660, isMatch: true },
  ],
);

/** Work from 9:00 to 17:00, Monday to Friday. */
export const OFFICE = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 540,
  endMinute: 1020,
}));
