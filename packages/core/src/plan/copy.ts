import {
  MEAL_TYPES,
  PLAN_LIMITS,
  type MealItem,
  type MealType,
  type PlannedMealItem,
  type PlannedWorkout,
  type Program,
  type Workout,
} from '@pt/contracts';
import { addDays, localMinuteOf } from '../dates';
import { mergePlanChanges, type PlanChanges } from './changes';
import { canPlan } from './horizon';
import { mealItemToPlanned } from './items';
import {
  isStaleRoutineLink,
  pendingPlannedItems,
  pendingPlannedWorkouts,
  sortPlannedSessions,
} from './status';

/**
 * "Copiar día" and "Copiar semana" (spec 013 AC19–AC21). The copy is what the source day shows (its
 * logged items plus its pending planned items, its workouts plus its pending planned sessions) as new
 * planned rows; it replaces the plan of the chosen kinds on the target days and never touches the logs.
 */

/** What is copied: some meal types (empty for none) and the sessions or not. */
export interface CopyWhat {
  meals: readonly MealType[];
  sessions: boolean;
}

export interface CopyInput {
  today: string;
  what: CopyWhat;
  /** The log items and workouts around the source and target days. */
  logged: readonly MealItem[];
  workouts: readonly Workout[];
  /** The plan around the source and target days. */
  plan: { mealItems: readonly PlannedMealItem[]; workouts: readonly PlannedWorkout[] };
  /** The current routine: a workout of one of its sessions becomes that session. */
  program: Pick<Program, 'sessions'> | null;
  /** One new client id per copied row. */
  newId: () => string;
  recordedAt: string;
  /** For the start time of a copied workout; the device's zone when omitted (tests pass one). */
  timeZone?: string;
}

export interface PlanCopy {
  changes: PlanChanges;
  /** Removes the copies and restores what they replaced (AC20); stamp it at undo time. */
  undo: PlanChanges;
  /** The target days whose plan of the chosen kinds is replaced, for the confirmation (AC20). */
  replacedDays: string[];
  /** A day limit (150 items, 4 sessions) cut the copy. */
  capped: boolean;
}

/** A planned row's content, before it gets its id, day and time of write. */
type MealTemplate = Omit<PlannedMealItem, 'id' | 'localDate' | 'recordedAt'>;
type SessionTemplate = Omit<PlannedWorkout, 'id' | 'localDate' | 'recordedAt'>;

const byRecordedAt = (a: { recordedAt: string }, b: { recordedAt: string }) =>
  a.recordedAt.localeCompare(b.recordedAt);

function mealTemplates(input: CopyInput, from: string): MealTemplate[] {
  const chosen = new Set(input.what.meals);
  const logged = input.logged.filter((i) => i.localDate === from && chosen.has(i.mealType));
  const planned = pendingPlannedItems(
    input.plan.mealItems.filter((p) => p.localDate === from && chosen.has(p.mealType)),
    input.logged,
  );
  return MEAL_TYPES.flatMap((meal) => [
    ...logged
      .filter((i) => i.mealType === meal)
      .sort(byRecordedAt)
      .map(mealItemToPlanned),
    ...planned.filter((p) => p.mealType === meal).sort(byRecordedAt),
  ]).map((row) => ({
    mealType: row.mealType,
    foodId: row.foodId,
    servingId: row.servingId,
    servings: row.servings,
    servingLabel: row.servingLabel,
    grams: row.grams,
    unit: row.unit,
    label: row.label,
    nutrients: row.nutrients,
  }));
}

/**
 * A logged workout as a plan (AC19): a workout of a routine session that still exists becomes that
 * session, another gym workout becomes "Repetir" that workout, an activity stays an activity with its
 * minutes and start time.
 */
function workoutTemplate(
  workout: Workout,
  program: Pick<Program, 'sessions'> | null,
  timeZone: string | undefined,
): SessionTemplate {
  const base = {
    startMinute: localMinuteOf(workout.startedAt, timeZone),
    // A workout's minutes already meet the planned limits of its kind.
    minutes: workout.minutes,
    isMatch: false,
  };
  if (workout.kind !== 'gym') {
    return {
      ...base,
      kind: workout.kind,
      activity: workout.activity,
      name: workout.name,
      programSessionId: null,
      repeatWorkoutId: null,
    };
  }
  const session = program?.sessions.find((s) => s.id === workout.programSessionId);
  return session
    ? {
        ...base,
        kind: 'gym',
        activity: null,
        name: session.name,
        programSessionId: session.id,
        repeatWorkoutId: null,
      }
    : {
        ...base,
        kind: 'gym',
        activity: null,
        name: workout.name,
        programSessionId: null,
        repeatWorkoutId: workout.id,
      };
}

function sessionTemplates(input: CopyInput, from: string): SessionTemplate[] {
  if (!input.what.sessions) return [];
  const done = input.workouts
    .filter((w) => w.localDate === from)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((w) => workoutTemplate(w, input.program, input.timeZone));
  const pending = pendingPlannedWorkouts(
    input.plan.workouts.filter((p) => p.localDate === from),
    input.workouts,
  ).map((p): SessionTemplate => ({
    startMinute: p.startMinute,
    kind: p.kind,
    activity: p.activity,
    name: p.name,
    minutes: p.minutes,
    isMatch: p.isMatch,
    // A session of a deleted routine is copied as the free gym session it shows as.
    programSessionId: isStaleRoutineLink(p, input.program) ? null : p.programSessionId,
    repeatWorkoutId: p.repeatWorkoutId,
  }));
  return sortPlannedSessions([...done, ...pending]);
}

const deleteOf = (recordedAt: string) => (row: { id: string }) => ({ id: row.id, recordedAt });

/** "Copiar día" (AC19, AC20): the source day onto each target day from today to the horizon. */
export function copyDay(input: CopyInput & { from: string; targets: readonly string[] }): PlanCopy {
  const { from, recordedAt } = input;
  const meals = mealTemplates(input, from);
  const sessions = sessionTemplates(input, from);
  const chosen = new Set(input.what.meals);
  const targets = [...new Set(input.targets)]
    .filter((day) => day !== from && canPlan(day, input.today))
    .sort();

  const copiedMeals: PlannedMealItem[] = [];
  const copiedSessions: PlannedWorkout[] = [];
  const replacedMeals: PlannedMealItem[] = [];
  const replacedSessions: PlannedWorkout[] = [];
  const replacedDays: string[] = [];
  let capped = false;

  for (const day of targets) {
    const ofDay = input.plan.mealItems.filter((p) => p.localDate === day);
    const replacing = ofDay.filter((p) => chosen.has(p.mealType));
    const room = PLAN_LIMITS.itemsPerDayMax - (ofDay.length - replacing.length);
    const dayMeals = meals.slice(0, Math.max(room, 0));
    const daySessions = sessions.slice(0, PLAN_LIMITS.sessionsPerDayMax);
    if (dayMeals.length < meals.length || daySessions.length < sessions.length) capped = true;

    const replacingSessions = input.what.sessions
      ? input.plan.workouts.filter((p) => p.localDate === day)
      : [];
    if (replacing.length > 0 || replacingSessions.length > 0) replacedDays.push(day);
    replacedMeals.push(...replacing);
    replacedSessions.push(...replacingSessions);
    copiedMeals.push(
      ...dayMeals.map((m) => ({ ...m, id: input.newId(), localDate: day, recordedAt })),
    );
    copiedSessions.push(
      ...daySessions.map((s) => ({ ...s, id: input.newId(), localDate: day, recordedAt })),
    );
  }

  return {
    changes: {
      mealItems: { upserts: copiedMeals, deletes: replacedMeals.map(deleteOf(recordedAt)) },
      workouts: { upserts: copiedSessions, deletes: replacedSessions.map(deleteOf(recordedAt)) },
    },
    undo: {
      mealItems: {
        upserts: replacedMeals.map((row) => ({ ...row, recordedAt })),
        deletes: copiedMeals.map(deleteOf(recordedAt)),
      },
      workouts: {
        upserts: replacedSessions.map((row) => ({ ...row, recordedAt })),
        deletes: copiedSessions.map(deleteOf(recordedAt)),
      },
    },
    replacedDays,
    capped,
  };
}

/**
 * "Copiar semana" (AC21): each weekday of `fromWeek` onto the same weekday of `toWeek` (both Mondays),
 * with AC19 and AC20; days of the target week before today are skipped.
 */
export function copyWeek(input: CopyInput & { fromWeek: string; toWeek: string }): PlanCopy {
  const days = Array.from({ length: 7 }, (_, i) =>
    copyDay({
      ...input,
      from: addDays(input.fromWeek, i),
      targets: [addDays(input.toWeek, i)],
    }),
  );
  // Every day touches its own rows, so merging is joining in order.
  return {
    changes: mergePlanChanges(...days.map((d) => d.changes)),
    undo: mergePlanChanges(...days.map((d) => d.undo)),
    replacedDays: days.flatMap((d) => d.replacedDays),
    capped: days.some((d) => d.capped),
  };
}
