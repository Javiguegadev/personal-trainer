import { z } from 'zod';
import { IsoDateSchema, LocaleSchema } from './profile';

/**
 * Limits of the exercise catalog and the workout log (spec 009). `TRAINING_LIMITS` in `profile.ts` is
 * the weekly plan of spec 002; these are the logged sessions.
 */
export const WORKOUT_LIMITS = {
  weightKgMax: 500,
  repsMin: 1,
  repsMax: 100,
  /** Time of one set, in seconds (1 s to 3 h). */
  durationSMin: 1,
  durationSMax: 10_800,
  /** Distance of one set, in metres (1 m to 100 km). */
  distanceMMin: 1,
  distanceMMax: 100_000,
  restSMax: 900,
  setsPerExerciseMax: 20,
  exercisesPerSessionMax: 30,
  minutesMin: 1,
  minutesMax: 600,
  /** An activity of AC16 is at least 5 minutes. */
  activityMinutesMin: 5,
  rpeMin: 1,
  rpeMax: 10,
  /** Abuse guard: more workouts than this in one day are rejected. */
  workoutsPerDayMax: 10,
  nameMax: 60,
  customExerciseNameMax: 60,
  customExercisesMax: 200,
  /** Longest range one `GET /me/workouts` can ask for, in days. */
  listDaysMax: 62,
  /** How far back the API accepts a workout, in days. */
  historyDays: 366,
  /** How far back the UI offers to log a workout: today and the 6 days before (spec 009 Assumptions). */
  pastDaysUi: 6,
  /** Days of workouts kept in the offline cache (AC22). */
  cacheDays: 60,
  /** Recent exercises in the picker (AC5). */
  recentExercisesMax: 20,
  /** Sessions of one exercise in its history screen (AC15). */
  historySessionsDefault: 10,
  historySessionsMax: 100,
  /** Sessions an exercise needs before its chart shows (AC15). */
  chartSessionsMin: 3,
  /** "Repetir" shortcuts on the Training tab (AC18, AC20). */
  repeatShortcuts: 3,
  /** Sets of an exercise never done before (AC7). */
  defaultSets: 3,
  /** Rest timer (AC9). */
  defaultRestS: 90,
  restStepS: 15,
  /** Weight steppers (AC8). */
  weightStepKg: 2.5,
  weightStepLb: 5,
  /** Estimated 1RM only from sets of 1 to this many reps (AC14). */
  oneRepMaxRepsMax: 12,
  /** A session open longer than this asks whether it finished (AC13). */
  staleSessionHours: 6,
  /** A weight above the heaviest one by more than this share asks for confirmation (Safety). */
  weightJumpRatio: 0.5,
} as const;

const datetime = z.iso.datetime({ offset: true });

/** How sets of an exercise are tracked (spec 009 Assumptions). */
export const ExerciseTrackingSchema = z.enum([
  'weight_reps',
  'reps',
  'duration',
  'distance_duration',
]);
export type ExerciseTracking = z.infer<typeof ExerciseTrackingSchema>;

export const ExerciseCategorySchema = z.enum([
  'strength',
  'cardio',
  'mobility',
  'plyometrics',
  'other',
]);
export type ExerciseCategory = z.infer<typeof ExerciseCategorySchema>;

export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
  'full_body',
] as const;
export const MuscleGroupSchema = z.enum(MUSCLE_GROUPS);
export type MuscleGroup = z.infer<typeof MuscleGroupSchema>;

/** The filter chips of the picker (AC5); each one covers one or more muscle groups. */
export const MUSCLE_FILTERS = {
  chest: ['chest'],
  back: ['back'],
  shoulders: ['shoulders'],
  biceps: ['biceps', 'forearms'],
  triceps: ['triceps'],
  legs: ['quads', 'hamstrings', 'calves'],
  glutes: ['glutes'],
  core: ['core'],
  cardio: [],
} as const satisfies Record<string, readonly MuscleGroup[]>;
export type MuscleFilter = keyof typeof MUSCLE_FILTERS;

export const EquipmentSchema = z.enum([
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'kettlebell',
  'band',
  'bodyweight',
  'other',
]);
export type Equipment = z.infer<typeof EquipmentSchema>;

/** Where an exercise comes from: the curated catalog, or the user (private to them). */
export const ExerciseOriginSchema = z.enum(['catalog', 'user']);
export type ExerciseOrigin = z.infer<typeof ExerciseOriginSchema>;

/**
 * An exercise with the names of both locales: the catalog is searched on the device, and the search
 * also matches English names in Spanish (AC3).
 */
export const ExerciseSchema = z.object({
  id: z.uuid(),
  /** Curated key (`press-banca`); null for a custom exercise. */
  key: z.string().nullable(),
  origin: ExerciseOriginSchema,
  nameEs: z.string(),
  nameEn: z.string(),
  synonymsEs: z.array(z.string()),
  synonymsEn: z.array(z.string()),
  tracking: ExerciseTrackingSchema,
  category: ExerciseCategorySchema,
  primaryMuscles: z.array(MuscleGroupSchema),
  secondaryMuscles: z.array(MuscleGroupSchema),
  equipment: z.array(EquipmentSchema),
  /** Tie-break in search; 0 for custom exercises. */
  popularity: z.number().int(),
  /** `knowledge_sources.id`; null for custom exercises. */
  source: z.string().nullable(),
});
export type Exercise = z.infer<typeof ExerciseSchema>;

/** `GET /exercises`: the whole catalog plus the user's custom exercises, cached on the device. */
export const ExerciseCatalogResponseSchema = z.object({
  /** Changes when the catalog changes (source version and row count). */
  version: z.string(),
  exercises: z.array(ExerciseSchema),
});
export type ExerciseCatalogResponse = z.infer<typeof ExerciseCatalogResponseSchema>;

/** `PUT /me/exercises/:id`: a custom exercise. Its id comes from the device, so a session can use it first. */
export const CustomExerciseUpsertRequestSchema = z.object({
  name: z.string().trim().min(1).max(WORKOUT_LIMITS.customExerciseNameMax),
  tracking: ExerciseTrackingSchema,
  primaryMuscle: MuscleGroupSchema.nullable(),
  /** Device time of the write. The later one wins, also against a delete. */
  recordedAt: datetime,
});
export type CustomExerciseUpsertRequest = z.infer<typeof CustomExerciseUpsertRequestSchema>;

export const ExerciseIdParamSchema = z.object({ id: z.uuid() });
export const CustomExerciseDeleteQuerySchema = z.object({ recordedAt: datetime });
export type CustomExerciseDeleteQuery = z.infer<typeof CustomExerciseDeleteQuerySchema>;

export const CustomExerciseSaveResponseSchema = z.object({
  /** The exercise stored after the write (the newer one if another write won); null when deleted. */
  exercise: ExerciseSchema.nullable(),
});
export type CustomExerciseSaveResponse = z.infer<typeof CustomExerciseSaveResponseSchema>;

// ── Workouts ──────────────────────────────────────────────────────────────────────────────────────

/** `gym`: a session with exercises and sets. The others are activities without sets (AC16). */
export const WorkoutKindSchema = z.enum(['gym', 'sport', 'cardio', 'other']);
export type WorkoutKind = z.infer<typeof WorkoutKindSchema>;

export const ActivityKindForLogSchema = z.enum(['sport', 'cardio', 'other']);
export type ActivityKindForLog = z.infer<typeof ActivityKindForLogSchema>;

/** The activity chips of AC16, each with its kind. */
export const ACTIVITY_TYPES = {
  football: 'sport',
  padel: 'sport',
  running: 'cardio',
  cycling: 'cardio',
  swimming: 'cardio',
  walking: 'cardio',
  group_class: 'other',
  other: 'other',
} as const satisfies Record<string, ActivityKindForLog>;
export const ActivityTypeSchema = z.enum([
  'football',
  'padel',
  'running',
  'cycling',
  'swimming',
  'walking',
  'group_class',
  'other',
]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

/** How a workout reached the log. Spec 011 adds `text` and `voice`. */
export const WorkoutInputMethodSchema = z.enum(['live', 'manual', 'repeat', 'activity']);
export type WorkoutInputMethod = z.infer<typeof WorkoutInputMethodSchema>;

const reps = z.number().int().min(WORKOUT_LIMITS.repsMin).max(WORKOUT_LIMITS.repsMax);
const weightKg = z.number().min(0).max(WORKOUT_LIMITS.weightKgMax);
const durationS = z
  .number()
  .int()
  .min(WORKOUT_LIMITS.durationSMin)
  .max(WORKOUT_LIMITS.durationSMax);
const distanceM = z
  .number()
  .int()
  .min(WORKOUT_LIMITS.distanceMMin)
  .max(WORKOUT_LIMITS.distanceMMax);
const rpe = z.number().int().min(WORKOUT_LIMITS.rpeMin).max(WORKOUT_LIMITS.rpeMax);

/**
 * The values of one completed set. Which fields are required depends on the exercise's tracking
 * (`setMatchesTracking` in core); a bodyweight exercise may carry extra weight.
 */
export const SetValuesSchema = z.object({
  reps: reps.nullable(),
  weightKg: weightKg.nullable(),
  durationS: durationS.nullable(),
  distanceM: distanceM.nullable(),
});
export type SetValues = z.infer<typeof SetValuesSchema>;

export const WorkoutSetInputSchema = SetValuesSchema.extend({
  /** Rest taken after the set, which prefills the next timer of that exercise (AC9). */
  restS: z.number().int().min(0).max(WORKOUT_LIMITS.restSMax).nullable(),
});
export type WorkoutSetInput = z.infer<typeof WorkoutSetInputSchema>;

export const WorkoutExerciseInputSchema = z.object({
  exerciseId: z.uuid(),
  sets: z.array(WorkoutSetInputSchema).min(1).max(WORKOUT_LIMITS.setsPerExerciseMax),
});
export type WorkoutExerciseInput = z.infer<typeof WorkoutExerciseInputSchema>;

const workoutPlacement = {
  /** The user's day the workout started on. */
  localDate: IsoDateSchema,
  startedAt: datetime,
  sessionRpe: rpe.nullable(),
  /** Device time of the write. The later one wins, also against a delete (AC23). */
  recordedAt: datetime,
  /** The user's local date. The API accepts it only within ±1 day of server UTC. */
  today: IsoDateSchema,
  /** Language of the exercise name snapshots. */
  locale: LocaleSchema.default('es'),
};

/** `PUT /me/workouts/:id`. The whole workout is replaced, sets included (AC23). */
export const WorkoutUpsertRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('gym'),
    name: z.string().trim().min(1).max(WORKOUT_LIMITS.nameMax).nullable(),
    minutes: z.number().int().min(WORKOUT_LIMITS.minutesMin).max(WORKOUT_LIMITS.minutesMax),
    exercises: z
      .array(WorkoutExerciseInputSchema)
      .min(1)
      .max(WORKOUT_LIMITS.exercisesPerSessionMax),
    inputMethod: z.enum(['live', 'manual', 'repeat']),
    ...workoutPlacement,
  }),
  z.object({
    kind: ActivityKindForLogSchema,
    /** A chip of AC16; null when the name comes from a profile activity ("Fútbol 7"). */
    activity: ActivityTypeSchema.nullable(),
    name: z.string().trim().min(1).max(WORKOUT_LIMITS.nameMax).nullable(),
    minutes: z.number().int().min(WORKOUT_LIMITS.activityMinutesMin).max(WORKOUT_LIMITS.minutesMax),
    inputMethod: z.literal('activity'),
    ...workoutPlacement,
  }),
]);
export type WorkoutUpsertRequest = z.infer<typeof WorkoutUpsertRequestSchema>;
export type GymWorkoutRequest = Extract<WorkoutUpsertRequest, { kind: 'gym' }>;
export type ActivityWorkoutRequest = Exclude<WorkoutUpsertRequest, { kind: 'gym' }>;

export const WorkoutSetSchema = WorkoutSetInputSchema.extend({
  setNumber: z.number().int().min(1),
});
export type WorkoutSet = z.infer<typeof WorkoutSetSchema>;

export const WorkoutExerciseSchema = z.object({
  /** Null when the exercise no longer exists. */
  exerciseId: z.uuid().nullable(),
  /** Snapshot of the exercise's name. */
  label: z.string(),
  tracking: ExerciseTrackingSchema,
  sets: z.array(WorkoutSetSchema),
});
export type WorkoutExercise = z.infer<typeof WorkoutExerciseSchema>;

export const WorkoutSchema = z.object({
  id: z.uuid(),
  localDate: IsoDateSchema,
  kind: WorkoutKindSchema,
  activity: ActivityTypeSchema.nullable(),
  name: z.string().nullable(),
  startedAt: datetime,
  minutes: z.number().int(),
  sessionRpe: z.number().int().nullable(),
  inputMethod: WorkoutInputMethodSchema,
  /** In session order; empty for an activity. */
  exercises: z.array(WorkoutExerciseSchema),
  recordedAt: datetime,
});
export type Workout = z.infer<typeof WorkoutSchema>;

export const WorkoutIdParamSchema = z.object({ id: z.uuid() });
export const WorkoutDeleteQuerySchema = z.object({ recordedAt: datetime });
export type WorkoutDeleteQuery = z.infer<typeof WorkoutDeleteQuerySchema>;

export const WorkoutSaveResponseSchema = z.object({
  /** The workout stored after the write (the newer one if another write won); null when deleted. */
  workout: WorkoutSchema.nullable(),
});
export type WorkoutSaveResponse = z.infer<typeof WorkoutSaveResponseSchema>;

export const WorkoutLogQuerySchema = z.object({ from: IsoDateSchema, to: IsoDateSchema });
export type WorkoutLogQuery = z.infer<typeof WorkoutLogQuerySchema>;

export const WorkoutLogResponseSchema = z.object({
  /** Workouts of the range, newest first. Deleted workouts are not listed. */
  workouts: z.array(WorkoutSchema),
});
export type WorkoutLogResponse = z.infer<typeof WorkoutLogResponseSchema>;

// ── Personal bests and exercise stats ─────────────────────────────────────────────────────────────

export const DatedValueSchema = z.object({ value: z.number(), localDate: IsoDateSchema });
export type DatedValue = z.infer<typeof DatedValueSchema>;

/** Computed by `personalBests` in core from the logged sets (AC14); null when there is no such set. */
export const PersonalBestsSchema = z.object({
  heaviestKg: DatedValueSchema.nullable(),
  oneRepMaxKg: DatedValueSchema.nullable(),
  mostReps: DatedValueSchema.nullable(),
  longestS: DatedValueSchema.nullable(),
  longestM: DatedValueSchema.nullable(),
});
export type PersonalBests = z.infer<typeof PersonalBestsSchema>;

/** One past session of an exercise. */
export const ExerciseSessionSchema = z.object({
  workoutId: z.uuid(),
  localDate: IsoDateSchema,
  sets: z.array(WorkoutSetSchema),
});
export type ExerciseSession = z.infer<typeof ExerciseSessionSchema>;

/** What a live session needs offline for one exercise: prefill, last rest and bests (AC7, AC9, AC10). */
export const ExerciseStatsSchema = z.object({
  exerciseId: z.uuid(),
  last: ExerciseSessionSchema,
  bests: PersonalBestsSchema,
  /** When the exercise was last done, for the picker's recents (AC5). */
  lastDoneAt: datetime,
});
export type ExerciseStats = z.infer<typeof ExerciseStatsSchema>;

/** `GET /me/exercises/stats`: every exercise the user has done, most recently done first. */
export const ExerciseStatsResponseSchema = z.object({
  stats: z.array(ExerciseStatsSchema),
});
export type ExerciseStatsResponse = z.infer<typeof ExerciseStatsResponseSchema>;

export const ExerciseHistoryQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WORKOUT_LIMITS.historySessionsMax)
    .default(WORKOUT_LIMITS.historySessionsDefault),
});
export type ExerciseHistoryQuery = z.infer<typeof ExerciseHistoryQuerySchema>;

/** `GET /me/exercises/:id/history` (AC15). */
export const ExerciseHistoryResponseSchema = z.object({
  exerciseId: z.uuid(),
  /** Newest first, at most `limit`. */
  sessions: z.array(ExerciseSessionSchema),
  /** Over the whole history, not only the sessions returned. */
  bests: PersonalBestsSchema,
});
export type ExerciseHistoryResponse = z.infer<typeof ExerciseHistoryResponseSchema>;
