import {
  WORKOUT_LIMITS,
  type Food,
  type Locale,
  type MealItem,
  type MealItemUpsertRequest,
  type PlannedActivity,
  type PlannedMealItem,
  type PlannedMealItemUpsert,
  type PlannedWorkout,
  type PlannedWorkoutUpsert,
  type ProgramSession,
  type Workout,
} from '@pt/contracts';
import { itemPortion, itemToRequest } from '../food/item-request';
import { mealItemFromRequest } from '../food/write';
import type { ActivityChoice } from '../training/write';

/**
 * Planned rows and their writes (spec 013). A planned item has a log item's shape (ADR 006), so the
 * snapshot is computed by the same code as the food log, and a planned row is written back as an upsert
 * the way a log item is (a catalog food with its portion, anything else from its snapshot).
 */

/** The planned part of a stored log item: what a copy of a logged day plans (AC19). */
export function mealItemToPlanned(item: MealItem): PlannedMealItem {
  return {
    id: item.id,
    localDate: item.localDate,
    mealType: item.mealType,
    foodId: item.foodId,
    servingId: item.servingId,
    servings: item.servings,
    servingLabel: item.servingLabel,
    grams: item.grams,
    unit: item.unit,
    label: item.label,
    nutrients: item.nutrients,
    recordedAt: item.recordedAt,
  };
}

/**
 * The stored planned item of an upsert (AC5): the snapshot of a catalog food is computed from the
 * catalog (`food` in the user's locale, or null when unknown), never from client values; a quick add is
 * kept as typed. The app uses it for the optimistic row, the API for the stored one.
 */
export function plannedMealItemFromUpsert(
  upsert: PlannedMealItemUpsert,
  food: Food | null,
): PlannedMealItem | { error: 'food_not_found' | 'serving_not_found' } {
  const shared = {
    localDate: upsert.localDate,
    mealType: upsert.mealType,
    recordedAt: upsert.recordedAt,
    today: upsert.localDate,
    locale: 'es' as const,
    plannedItemId: null,
  };
  const request: MealItemUpsertRequest =
    upsert.kind === 'food'
      ? {
          kind: 'food',
          foodId: upsert.foodId,
          portion: upsert.portion,
          inputMethod: 'plan',
          ...shared,
        }
      : {
          kind: 'quick_add',
          label: upsert.label,
          kcal: upsert.kcal,
          proteinG: upsert.proteinG,
          carbsG: upsert.carbsG,
          fatG: upsert.fatG,
          inputMethod: 'plan',
          ...shared,
        };
  const stored = mealItemFromRequest(upsert.id, request, food);
  return 'error' in stored ? stored : mealItemToPlanned(stored);
}

/**
 * The upsert that stores a planned row again (AC6, AC20 undo, AC22): moved, copied or restored. A
 * catalog item keeps its portion, so the API computes its snapshot again; a quick add, or an item whose
 * food left the catalog, is written from its snapshot.
 */
export function plannedItemToUpsert(item: PlannedMealItem): PlannedMealItemUpsert {
  const placement = {
    id: item.id,
    localDate: item.localDate,
    mealType: item.mealType,
    recordedAt: item.recordedAt,
  };
  const portion = itemPortion(item);
  if (item.foodId !== null && portion !== null) {
    return { kind: 'food', foodId: item.foodId, portion, ...placement };
  }
  const n = item.nutrients;
  return {
    kind: 'quick_add',
    label: item.label,
    kcal: n.kcal,
    proteinG: n.proteinG,
    carbsG: n.carbsG,
    fatG: n.fatG,
    ...placement,
  };
}

/** The upsert of a planned session or activity (AC10, AC12). */
export function plannedWorkoutToUpsert(workout: PlannedWorkout): PlannedWorkoutUpsert {
  const placement = {
    id: workout.id,
    localDate: workout.localDate,
    startMinute: workout.startMinute,
    recordedAt: workout.recordedAt,
  };
  if (workout.kind === 'gym') {
    return {
      kind: 'gym',
      name: workout.name,
      minutes: workout.minutes,
      programSessionId: workout.programSessionId,
      repeatWorkoutId: workout.repeatWorkoutId,
      ...placement,
    };
  }
  return {
    kind: workout.kind,
    activity: workout.activity,
    name: workout.name,
    // Always set for an activity (the contract requires it); the floor only keeps the type honest.
    minutes: workout.minutes ?? WORKOUT_LIMITS.activityMinutesMin,
    isMatch: workout.kind === 'sport' && workout.isMatch,
    ...placement,
  };
}

/** The stored row of a planned session upsert (AC10): every field, whatever its kind. */
export function plannedWorkoutFromUpsert(upsert: PlannedWorkoutUpsert): PlannedWorkout {
  const placement = {
    id: upsert.id,
    localDate: upsert.localDate,
    startMinute: upsert.startMinute,
    recordedAt: upsert.recordedAt,
  };
  if (upsert.kind === 'gym') {
    return {
      ...placement,
      kind: 'gym',
      activity: null,
      name: upsert.name,
      minutes: upsert.minutes,
      isMatch: false,
      programSessionId: upsert.programSessionId,
      repeatWorkoutId: upsert.repeatWorkoutId,
    };
  }
  return {
    ...placement,
    kind: upsert.kind,
    activity: upsert.activity,
    name: upsert.name,
    minutes: upsert.minutes,
    isMatch: upsert.kind === 'sport' && upsert.isMatch,
    programSessionId: null,
    repeatWorkoutId: null,
  };
}

export interface LogPlannedInput {
  /** Device time of the write. */
  recordedAt: string;
  /** The user's date. */
  today: string;
  locale: Locale;
  /** One new client id per logged item. */
  newId: () => string;
}

export interface LoggedPlannedItem {
  id: string;
  request: MealItemUpsertRequest;
  /** The log item as the Food tab shows it until the API answers (the planned snapshot). */
  preview: MealItem;
}

/**
 * "Registrar lo planificado" (AC8): each pending planned item becomes a new log item of its day and
 * meal, with the same food and portion, the input method `plan` and the link to the planned row. The
 * API computes a catalog item's snapshot again.
 */
export function logPlannedItems(
  items: readonly PlannedMealItem[],
  input: LogPlannedInput,
): LoggedPlannedItem[] {
  return items.map((item) => {
    const id = input.newId();
    const preview: MealItem = {
      ...item,
      id,
      inputMethod: 'plan',
      plannedItemId: item.id,
      recordedAt: input.recordedAt,
    };
    const request = itemToRequest(
      preview,
      {
        localDate: item.localDate,
        mealType: item.mealType,
        recordedAt: input.recordedAt,
        today: input.today,
        locale: input.locale,
        plannedItemId: item.id,
      },
      'plan',
    );
    return { id, request, preview };
  });
}

/** The minutes a planned gym session defaults to (AC10): the strength activity's, or none. */
export function defaultGymMinutes(
  activities: readonly Pick<PlannedActivity, 'kind' | 'minutesPerSession'>[],
): number | null {
  return activities.find((a) => a.kind === 'strength')?.minutesPerSession ?? null;
}

/** A choice of the "Planificar entreno" sheet (AC10). */
export type PlanSessionChoice =
  | { type: 'program'; session: Pick<ProgramSession, 'id' | 'name'> }
  | { type: 'repeat'; workout: Pick<Workout, 'id' | 'name'> }
  | { type: 'free'; name: string | null }
  | { type: 'activity'; choice: ActivityChoice; minutes: number; isMatch: boolean };

export interface PlanSessionPlacement {
  id: string;
  localDate: string;
  /** Optional start time, minutes after midnight (15-minute steps on the sheet). */
  startMinute: number | null;
  /** Optional for gym (see `defaultGymMinutes`); an activity takes the choice's minutes. */
  minutes?: number | null;
  recordedAt: string;
}

/**
 * The planned row of a choice (AC10). The name is a snapshot of the routine session or the workout, so
 * it still reads right if they go away; "partido" is kept only for a sport.
 */
export function plannedSessionFor(
  choice: PlanSessionChoice,
  placement: PlanSessionPlacement,
): PlannedWorkout {
  const base = {
    id: placement.id,
    localDate: placement.localDate,
    startMinute: placement.startMinute,
    recordedAt: placement.recordedAt,
  };
  const gym = {
    ...base,
    kind: 'gym' as const,
    activity: null,
    minutes: placement.minutes ?? null,
    isMatch: false,
  };
  switch (choice.type) {
    case 'program':
      return {
        ...gym,
        name: choice.session.name,
        programSessionId: choice.session.id,
        repeatWorkoutId: null,
      };
    case 'repeat':
      return {
        ...gym,
        name: choice.workout.name,
        programSessionId: null,
        repeatWorkoutId: choice.workout.id,
      };
    case 'free':
      return { ...gym, name: choice.name, programSessionId: null, repeatWorkoutId: null };
    case 'activity':
      return {
        ...base,
        kind: choice.choice.kind,
        activity: choice.choice.activity,
        name: choice.choice.name,
        minutes: choice.minutes,
        isMatch: choice.choice.kind === 'sport' && choice.isMatch,
        programSessionId: null,
        repeatWorkoutId: null,
      };
  }
}
