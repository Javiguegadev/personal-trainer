import { z } from 'zod';
import { IsoDateSchema, LocaleSchema } from './profile';
import { ActivityTypeSchema, ExerciseSchema, SetValuesSchema, WORKOUT_LIMITS } from './training';

/** Limits of the workout sentence shortcut (spec 012). */
export const WORKOUT_DRAFT_LIMITS = {
  textMin: 3,
  textMax: 500,
  /** The words an exercise or an activity came from, as shown in the draft. */
  mentionMax: 80,
  /** Exercises of one draft, unresolved ones included (AC3). */
  exercisesMax: WORKOUT_LIMITS.exercisesPerSessionMax,
  /** Other activities said in the sentence, shown as "También: …" lines (AC6). */
  extraActivitiesMax: 2,
  /** The user's own exercises sent to the model (`u1`…): all of them, as a user has at most 200. */
  ownExercisesMax: WORKOUT_LIMITS.customExercisesMax,
  /** Furthest day back the model may name; `core` keeps only today and the 6 days before (AC4). */
  daysAgoMax: 30,
  /** Abuse guard per user and UTC day, apart from the meal shortcuts (AC17). */
  textsPerDay: 20,
  /** The whole call (AC16). */
  timeoutMs: 20_000,
} as const;

/** `POST /me/workouts/drafts/text`: a typed or dictated sentence (AC2–AC5). */
export const WorkoutTextDraftRequestSchema = z.object({
  text: z.string().trim().min(WORKOUT_DRAFT_LIMITS.textMin).max(WORKOUT_DRAFT_LIMITS.textMax),
  locale: LocaleSchema.default('es'),
  /** The user's local date; the API accepts it within ±1 day of server UTC, as every write. */
  today: IsoDateSchema,
  /** The day the screen is on: the draft's day unless the sentence names another (AC1, AC4). */
  localDate: IsoDateSchema,
});
export type WorkoutTextDraftRequest = z.infer<typeof WorkoutTextDraftRequestSchema>;

/** Why a sentence gave no draft (AC9). */
export const WorkoutUnreadableReasonSchema = z.enum(['not_workout', 'unclear']);
export type WorkoutUnreadableReason = z.infer<typeof WorkoutUnreadableReasonSchema>;

// ── The model's reading (structured output) ───────────────────────────────────────────────────────
// Loose on purpose: numbers carry no bounds, so an odd value reaches `core` (`workoutDraft`), which
// clamps it and marks it "Revisa" instead of failing the whole call (AC8).

/** `count` sets with the same values ("4x8 con 60" is one group of 4). A value not said is null. */
export const WorkoutReadingSetGroupSchema = z.object({
  count: z.number(),
  reps: z.number().nullable(),
  /** As said, in `weightUnit`; extra weight ("lastre") on a reps-only exercise too. */
  weight: z.number().nullable(),
  weightUnit: z.enum(['kg', 'lb']),
  durationS: z.number().nullable(),
  distanceM: z.number().nullable(),
});
export type WorkoutReadingSetGroup = z.infer<typeof WorkoutReadingSetGroupSchema>;

export const WorkoutReadingExerciseSchema = z.object({
  /** The words of the sentence for this exercise ("press banca 4x8 con 60"). */
  mention: z.string(),
  /** A ref of the catalog block or of the user's own exercises (`e12`, `u3`); null when none fits. */
  exerciseRef: z.string().nullable(),
  /** Empty when no set was said. */
  setGroups: z.array(WorkoutReadingSetGroupSchema),
});
export type WorkoutReadingExercise = z.infer<typeof WorkoutReadingExerciseSchema>;

export const WorkoutReadingActivitySchema = z.object({
  mention: z.string(),
  activity: ActivityTypeSchema,
  minutes: z.number().nullable(),
  sessionRpe: z.number().nullable(),
  /** A distance or a pace was said: not stored, the draft says so (AC5). */
  distanceSaid: z.boolean(),
});
export type WorkoutReadingActivity = z.infer<typeof WorkoutReadingActivitySchema>;

/** What the model returns for a sentence. For a status other than `ok`, `gym` is null and the lists empty. */
export const WorkoutReadingSchema = z.object({
  status: z.enum(['ok', 'not_workout', 'unclear']),
  gym: z
    .object({
      /** In the order said. */
      exercises: z.array(WorkoutReadingExerciseSchema),
      minutes: z.number().nullable(),
      sessionRpe: z.number().nullable(),
    })
    .nullable(),
  /** In the order said, gym exercises excluded (a treadmill inside a session is an exercise). */
  activities: z.array(WorkoutReadingActivitySchema),
  /** "ayer" is 1; null when no day was said. */
  daysAgo: z.number().nullable(),
  /** Local clock time the workout started, `HH:MM`; null when not said. */
  startTime: z.string().nullable(),
  /** Pain or an injury was mentioned: the draft shows a fixed line (AC15). */
  painMentioned: z.boolean(),
});
export type WorkoutReading = z.infer<typeof WorkoutReadingSchema>;

// ── The draft (checked by `core`) ─────────────────────────────────────────────────────────────────

/** One set as read: null values were not said. `clamped`: a value was out of range (AC8, "Revisa"). */
export const WorkoutDraftSetSchema = z.object({
  values: SetValuesSchema,
  clamped: z.boolean(),
});
export type WorkoutDraftSet = z.infer<typeof WorkoutDraftSetSchema>;

export const WorkoutDraftExerciseSchema = z.object({
  exercise: ExerciseSchema,
  mention: z.string(),
  /** At most `setsPerExerciseMax`; empty when no set was said. */
  sets: z.array(WorkoutDraftSetSchema),
});
export type WorkoutDraftExercise = z.infer<typeof WorkoutDraftExerciseSchema>;

/** An exercise the catalog and the user's own exercises lack (AC7): never saved as is. */
export const WorkoutDraftUnresolvedSchema = z.object({
  mention: z.string(),
  /** The sets said for it, as read; checked against the tracking of the exercise chosen. */
  sets: z.array(WorkoutDraftSetSchema),
  /** Resolved exercises said before it, so it goes back to its place when resolved. */
  position: z.number().int().min(0),
});
export type WorkoutDraftUnresolved = z.infer<typeof WorkoutDraftUnresolvedSchema>;

export const WorkoutDraftActivitySchema = z.object({
  activity: ActivityTypeSchema,
  mention: z.string(),
  /** Within the activity limits of spec 009 AC16; null when not said. */
  minutes: z.number().int().nullable(),
  sessionRpe: z.number().int().nullable(),
  /** A distance or a pace was said and is not stored (AC5). */
  distanceDropped: z.boolean(),
});
export type WorkoutDraftActivity = z.infer<typeof WorkoutDraftActivitySchema>;

const startTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * The editable draft of a sentence (AC3–AC8, AC15): a gym session (`exercises`, `unresolved`) or an
 * activity (`activity`). Nothing is stored until the user saves it with `PUT /me/workouts/{id}`.
 */
export const WorkoutDraftSchema = z.object({
  /** The day said, else the day of the screen. */
  localDate: IsoDateSchema,
  /** Local clock time said (`HH:MM`); the device builds `startedAt` with its own time zone. */
  startTime: startTime.nullable(),
  /** A day was said but is outside today and the 6 days before: the day chip shows "Revisa el día". */
  dayDropped: z.boolean(),
  /** Gym session only. */
  minutes: z.number().int().nullable(),
  sessionRpe: z.number().int().nullable(),
  exercises: z.array(WorkoutDraftExerciseSchema),
  unresolved: z.array(WorkoutDraftUnresolvedSchema),
  /** The activity, when the sentence holds no gym session. */
  activity: WorkoutDraftActivitySchema.nullable(),
  /** Other activities said, each with "Registrar" (AC6). */
  extraActivities: z.array(WorkoutDraftActivitySchema),
  painMentioned: z.boolean(),
  /** Activities left out beyond `extraActivitiesMax` (AC6 notice). */
  ignored: z.number().int().min(0),
});
export type WorkoutDraft = z.infer<typeof WorkoutDraftSchema>;

export const WorkoutDraftResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), draft: WorkoutDraftSchema }),
  z.object({ status: z.literal('unreadable'), reason: WorkoutUnreadableReasonSchema }),
]);
export type WorkoutDraftResponse = z.infer<typeof WorkoutDraftResponseSchema>;
