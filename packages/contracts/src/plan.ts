import { z } from 'zod';
import {
  FOOD_LOG_LIMITS,
  MealItemSchema,
  MealTypeSchema,
  PortionSchema,
  type MealItem,
} from './food';
import { IsoDateSchema, LocaleSchema, MinuteOfDaySchema } from './profile';
import {
  ACTIVITY_TYPES,
  ActivityKindForLogSchema,
  ActivityTypeSchema,
  WORKOUT_LIMITS,
  WorkoutKindSchema,
} from './training';

/** Limits of the weekly planner (spec 013). */
export const PLAN_LIMITS = {
  /** The user plans from today to the Sunday this many weeks after the current week (AC1). */
  horizonWeeksAhead: 3,
  /** The API accepts a planned date up to this many days after its UTC today (AC23). */
  serverDaysAhead: 28,
  /** … and from this many days before it (time zones). Deletes are always accepted. */
  serverDaysBack: 1,
  /** Abuse guard, as the food log (spec 005). */
  itemsPerDayMax: FOOD_LOG_LIMITS.itemsPerDayMax,
  /** At most this many planned sessions on one day (AC10). */
  sessionsPerDayMax: 4,
  /** Upserts plus deletes in one bulk write (`planChangesToRequests` splits bigger changes). */
  changesMax: 300,
  /** Longest range one `GET /me/plan` can ask for, in days (27 days back to the horizon fits). */
  listDaysMax: 63,
  /** The plan kept in the offline cache starts this many days before today (AC22). */
  cacheDaysBack: 27,
} as const;

const datetime = z.iso.datetime({ offset: true });
const macro = z.number().min(0).max(FOOD_LOG_LIMITS.quickAddMacroMax);

// ── Planned meal items ────────────────────────────────────────────────────────────────────────────

const plannedItemPlacement = {
  id: z.uuid(),
  localDate: IsoDateSchema,
  mealType: MealTypeSchema,
  /** Device time of the write. The later one wins, also against a delete (AC23). */
  recordedAt: datetime,
};

/**
 * One planned item of a bulk write (AC5). The shape of `MealItemUpsertRequestSchema` without the input
 * method: the API computes the snapshot of a catalog food itself, as for the log.
 */
export const PlannedMealItemUpsertSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('food'),
    foodId: z.uuid(),
    portion: PortionSchema,
    ...plannedItemPlacement,
  }),
  z.object({
    kind: z.literal('quick_add'),
    label: z.string().trim().min(1).max(FOOD_LOG_LIMITS.labelMax),
    kcal: z.number().min(0).max(FOOD_LOG_LIMITS.quickAddKcalMax),
    proteinG: macro.nullable(),
    carbsG: macro.nullable(),
    fatG: macro.nullable(),
    ...plannedItemPlacement,
  }),
]);
export type PlannedMealItemUpsert = z.infer<typeof PlannedMealItemUpsertSchema>;

/** A planned item: a log item's shape without how it was logged (ADR 006). */
export const PlannedMealItemSchema = MealItemSchema.omit({
  inputMethod: true,
  plannedItemId: true,
});
export type PlannedMealItem = z.infer<typeof PlannedMealItemSchema>;

/** The fields a planned item shares with a log item, so core code can read both. */
export type MealItemLike = Omit<MealItem, 'inputMethod' | 'plannedItemId'>;

// ── Planned sessions ──────────────────────────────────────────────────────────────────────────────

const plannedWorkoutPlacement = {
  id: z.uuid(),
  localDate: IsoDateSchema,
  /** Optional start time, minutes after midnight on that local date. */
  startMinute: MinuteOfDaySchema.nullable(),
  /** Device time of the write. The later one wins, also against a delete (AC23). */
  recordedAt: datetime,
};

const plannedName = z.string().trim().min(1).max(WORKOUT_LIMITS.nameMax).nullable();

const plannedGym = z.object({
  kind: z.literal('gym'),
  /** "Rutina B", or the name of the workout to repeat: a snapshot (spec 013 Assumptions). */
  name: plannedName,
  minutes: z
    .number()
    .int()
    .min(WORKOUT_LIMITS.minutesMin)
    .max(WORKOUT_LIMITS.minutesMax)
    .nullable(),
  /** A session of the routine; it keeps the rotation link when the workout is saved. */
  programSessionId: z.uuid().nullable(),
  /** A past workout to repeat (spec 009 AC18). Never together with `programSessionId`. */
  repeatWorkoutId: z.uuid().nullable(),
  ...plannedWorkoutPlacement,
});

const plannedActivity = z.object({
  kind: ActivityKindForLogSchema,
  /** A chip of spec 009 AC16; null when the name comes from a profile activity ("Fútbol 7"). */
  activity: ActivityTypeSchema.nullable(),
  name: plannedName,
  minutes: z.number().int().min(WORKOUT_LIMITS.activityMinutesMin).max(WORKOUT_LIMITS.minutesMax),
  /** "Partido": only for a sport (AC10); it feeds the day-before-match notice (AC13). */
  isMatch: z.boolean().default(false),
  ...plannedWorkoutPlacement,
});

type PlannedWorkoutShape =
  | { kind: 'gym'; programSessionId: string | null; repeatWorkoutId: string | null }
  | {
      kind: z.infer<typeof ActivityKindForLogSchema>;
      activity: z.infer<typeof ActivityTypeSchema> | null;
      name: string | null;
      isMatch: boolean;
    };

function checkPlannedWorkout(workout: PlannedWorkoutShape, ctx: z.RefinementCtx): void {
  if (workout.kind === 'gym') {
    if (workout.programSessionId !== null && workout.repeatWorkoutId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['repeatWorkoutId'],
        message: 'A routine session and a workout to repeat',
      });
    }
    return;
  }
  if (workout.activity === null && workout.name === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['activity'],
      message: 'An activity needs a type or name',
    });
  }
  if (workout.activity !== null && ACTIVITY_TYPES[workout.activity] !== workout.kind) {
    ctx.addIssue({ code: 'custom', path: ['kind'], message: 'Kind does not match the activity' });
  }
  if (workout.isMatch && workout.kind !== 'sport') {
    ctx.addIssue({ code: 'custom', path: ['isMatch'], message: 'Only a sport has matches' });
  }
}

/** One planned session or activity of a bulk write (AC10). */
export const PlannedWorkoutUpsertSchema = z
  .discriminatedUnion('kind', [plannedGym, plannedActivity])
  .superRefine(checkPlannedWorkout);
export type PlannedWorkoutUpsert = z.infer<typeof PlannedWorkoutUpsertSchema>;

/** A stored planned session or activity: every field, whatever its kind. */
export const PlannedWorkoutSchema = z.object({
  id: z.uuid(),
  localDate: IsoDateSchema,
  startMinute: z.number().int().nullable(),
  kind: WorkoutKindSchema,
  activity: ActivityTypeSchema.nullable(),
  name: z.string().nullable(),
  minutes: z.number().int().nullable(),
  isMatch: z.boolean(),
  /** Null when not a routine session, or when that session was removed (a free gym session). */
  programSessionId: z.uuid().nullable(),
  /** Null when not a repeat, or when that workout was deleted (a free gym session). */
  repeatWorkoutId: z.uuid().nullable(),
  recordedAt: datetime,
});
export type PlannedWorkout = z.infer<typeof PlannedWorkoutSchema>;

// ── Bulk writes and reads ─────────────────────────────────────────────────────────────────────────

export const PlanDeleteSchema = z.object({ id: z.uuid(), recordedAt: datetime });
export type PlanDelete = z.infer<typeof PlanDeleteSchema>;

function distinctIds(changes: { upserts: { id: string }[]; deletes: { id: string }[] }) {
  const ids = [...changes.upserts, ...changes.deletes].map((c) => c.id);
  return new Set(ids).size === ids.length;
}

function withinChangesMax(changes: { upserts: unknown[]; deletes: unknown[] }) {
  return changes.upserts.length + changes.deletes.length <= PLAN_LIMITS.changesMax;
}

function changesRequest<T extends z.ZodType<{ id: string }>>(upsert: T) {
  return z
    .object({
      /** Language of the name and serving snapshots. */
      locale: LocaleSchema.default('es'),
      upserts: z.array(upsert).default([]),
      deletes: z.array(PlanDeleteSchema).default([]),
    })
    .refine(withinChangesMax, { message: 'Too many changes' })
    .refine(distinctIds, { message: 'Repeated id' });
}

/** `POST /me/plan/meal-items`: planned items to store and to delete, in the `food-log` queue scope. */
export const PlanMealChangesRequestSchema = changesRequest(PlannedMealItemUpsertSchema);
export type PlanMealChangesRequest = z.input<typeof PlanMealChangesRequestSchema>;

/** `POST /me/plan/workouts`: planned sessions to store and to delete, in the `training` scope. */
export const PlanWorkoutChangesRequestSchema = changesRequest(PlannedWorkoutUpsertSchema);
export type PlanWorkoutChangesRequest = z.input<typeof PlanWorkoutChangesRequestSchema>;

export const PlanMealChangesResponseSchema = z.object({
  /** The rows stored after the write (the newer one where another write won); deleted ids omitted. */
  mealItems: z.array(PlannedMealItemSchema),
});
export type PlanMealChangesResponse = z.infer<typeof PlanMealChangesResponseSchema>;

export const PlanWorkoutChangesResponseSchema = z.object({
  workouts: z.array(PlannedWorkoutSchema),
});
export type PlanWorkoutChangesResponse = z.infer<typeof PlanWorkoutChangesResponseSchema>;

export const PlanQuerySchema = z.object({ from: IsoDateSchema, to: IsoDateSchema });
export type PlanQuery = z.infer<typeof PlanQuerySchema>;

export const PlanResponseSchema = z.object({
  /** Planned items of the range, by day and then by `recordedAt`. Deleted rows are not listed. */
  mealItems: z.array(PlannedMealItemSchema),
  /** Planned sessions of the range, by day and start time. Deleted rows are not listed. */
  workouts: z.array(PlannedWorkoutSchema),
});
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

/** The plan in "Descargar mis datos" (AC25), deleted rows included with their date. */
export const ExportedPlanSchema = z.object({
  mealItems: z.array(PlannedMealItemSchema.extend({ deletedAt: datetime.nullable() })),
  workouts: z.array(PlannedWorkoutSchema.extend({ deletedAt: datetime.nullable() })),
});
export type ExportedPlan = z.infer<typeof ExportedPlanSchema>;
