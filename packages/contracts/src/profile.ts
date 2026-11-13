import { z } from 'zod';

/** Plausibility limits (spec 001 AC22). Values are metric; conversion happens in @pt/core/units. */
export const PROFILE_LIMITS = {
  heightCm: { min: 120, max: 230 },
  weightKg: { min: 30, max: 300 },
  textMax: 500,
  listMax: 30,
  listItemMax: 60,
} as const;

/** Limits of the weekly training list (spec 002 AC2, AC4). */
export const TRAINING_LIMITS = {
  activitiesMax: 6,
  sessionsPerWeek: { min: 1, max: 14 },
  minutesPerSession: { min: 10, max: 240 },
  /** Total planned minutes per week; above it the list is taken as a typing mistake. */
  minutesPerWeekMax: 1200,
  labelMax: 40,
} as const;

export const SexSchema = z.enum(['female', 'male', 'other']);
export type Sex = z.infer<typeof SexSchema>;

/** What the job is like most of the day. Training is described apart, in `PlannedActivity`. */
export const JobActivitySchema = z.enum(['sedentary', 'standing', 'physical']);
export type JobActivity = z.infer<typeof JobActivitySchema>;

export const ActivityKindSchema = z.enum(['strength', 'cardio', 'sport', 'other']);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

export const IntensitySchema = z.enum(['light', 'moderate', 'hard']);
export type Intensity = z.infer<typeof IntensitySchema>;

/** One training or sport activity the user plans to do every week, outside work. */
export const PlannedActivitySchema = z.object({
  kind: ActivityKindSchema,
  /** Optional name, e.g. "fútbol". */
  label: z.string().trim().min(1).max(TRAINING_LIMITS.labelMax).nullable(),
  sessionsPerWeek: z
    .number()
    .int()
    .min(TRAINING_LIMITS.sessionsPerWeek.min)
    .max(TRAINING_LIMITS.sessionsPerWeek.max),
  minutesPerSession: z
    .number()
    .int()
    .min(TRAINING_LIMITS.minutesPerSession.min)
    .max(TRAINING_LIMITS.minutesPerSession.max),
  intensity: IntensitySchema,
});
export type PlannedActivity = z.infer<typeof PlannedActivitySchema>;

/** The weekly training list. Empty means "I don't train". */
export const PlannedActivitiesSchema = z
  .array(PlannedActivitySchema)
  .max(TRAINING_LIMITS.activitiesMax)
  .superRefine((list, ctx) => {
    const minutes = list.reduce((sum, a) => sum + a.sessionsPerWeek * a.minutesPerSession, 0);
    if (minutes > TRAINING_LIMITS.minutesPerWeekMax) {
      ctx.addIssue({
        code: 'too_big',
        origin: 'number',
        maximum: TRAINING_LIMITS.minutesPerWeekMax,
        inclusive: true,
        input: minutes,
        message: 'Too many training minutes per week',
      });
    }
  });

/** What the user wants with their weight; it sets the calories. */
export const GoalSchema = z.enum(['lose', 'maintain', 'gain']);
export type Goal = z.infer<typeof GoalSchema>;

/** What the user trains for (spec 004); it sets the macros, apart from the weight goal. */
export const TrainingFocusSchema = z.enum([
  'hypertrophy',
  'strength',
  'sport_performance',
  'general_fitness',
]);
export type TrainingFocus = z.infer<typeof TrainingFocusSchema>;

export const DietTypeSchema = z.enum(['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'other']);
export type DietType = z.infer<typeof DietTypeSchema>;

export const UnitsSchema = z.enum(['metric', 'imperial']);
export type Units = z.infer<typeof UnitsSchema>;

export const LocaleSchema = z.enum(['es', 'en']);
export type Locale = z.infer<typeof LocaleSchema>;

/** Health facts the user reports (a form checkbox today; the questions assistant later). */
export const ReportedHealthFlagSchema = z.enum(['pregnancy', 'ed_soft_stop', 'medical_condition']);
export type ReportedHealthFlag = z.infer<typeof ReportedHealthFlagSchema>;

/** Every safety flag @pt/core can raise (reported ones plus computed ones). */
export const SafetyFlagSchema = z.enum([
  'pregnancy',
  'ed_soft_stop',
  'medical_condition',
  'injury',
  'teen_limited',
  'low_bmi',
  'low_target_bmi',
  'calorie_floor',
  'high_training_load',
]);
export type SafetyFlag = z.infer<typeof SafetyFlagSchema>;

/** A length as the user said it. Converted to cm by `toCm` in @pt/core. */
export const LengthMeasurementSchema = z.discriminatedUnion('unit', [
  z.object({ unit: z.literal('cm'), value: z.number().positive() }),
  z.object({ unit: z.literal('m'), value: z.number().positive() }),
  z.object({ unit: z.literal('in'), value: z.number().positive() }),
  z.object({
    unit: z.literal('ft_in'),
    feet: z.number().int().nonnegative(),
    inches: z.number().nonnegative(),
  }),
]);
export type LengthMeasurement = z.infer<typeof LengthMeasurementSchema>;

/** A weight as the user said it. Converted to kg by `toKg` in @pt/core. */
export const WeightMeasurementSchema = z.discriminatedUnion('unit', [
  z.object({ unit: z.literal('kg'), value: z.number().positive() }),
  z.object({ unit: z.literal('lb'), value: z.number().positive() }),
]);
export type WeightMeasurement = z.infer<typeof WeightMeasurementSchema>;

export const IsoDateSchema = z.iso.date();

const listOfStrings = z
  .array(z.string().trim().min(1).max(PROFILE_LIMITS.listItemMax))
  .max(PROFILE_LIMITS.listMax);

export const HeightCmSchema = z
  .number()
  .min(PROFILE_LIMITS.heightCm.min)
  .max(PROFILE_LIMITS.heightCm.max);
export const WeightKgSchema = z
  .number()
  .min(PROFILE_LIMITS.weightKg.min)
  .max(PROFILE_LIMITS.weightKg.max);

export const DietaryPrefsSchema = z.object({
  dietType: DietTypeSchema,
  allergies: listOfStrings,
  dislikes: listOfStrings,
  restrictions: listOfStrings,
});
export type DietaryPrefs = z.infer<typeof DietaryPrefsSchema>;

/** What the user confirms in the form. Metric only. */
export const ProfileInputSchema = z
  .object({
    sex: SexSchema,
    birthDate: IsoDateSchema,
    heightCm: HeightCmSchema,
    weightKg: WeightKgSchema,
    targetWeightKg: WeightKgSchema.nullable(),
    jobActivity: JobActivitySchema,
    plannedActivities: PlannedActivitiesSchema,
    /** The goal the user asked for; safety rules may apply a different one. */
    goal: GoalSchema,
    trainingFocus: TrainingFocusSchema,
    injuries: z.string().trim().max(PROFILE_LIMITS.textMax).nullable(),
    healthFlags: z.array(ReportedHealthFlagSchema).max(3),
    units: UnitsSchema,
    locale: LocaleSchema,
    dietaryPrefs: DietaryPrefsSchema,
    /** The user's local date (YYYY-MM-DD). The API accepts it only within ±1 day of server UTC. */
    today: IsoDateSchema,
  })
  .superRefine((input, ctx) => {
    // "Perform in my sport" needs the sport (spec 004 AC3): at least one, and every one named.
    if (input.trainingFocus !== 'sport_performance') return;
    const sports = input.plannedActivities.filter((activity) => activity.kind === 'sport');
    if (sports.length === 0) {
      ctx.addIssue({
        code: 'too_small',
        origin: 'array',
        minimum: 1,
        inclusive: true,
        input: input.plannedActivities,
        path: ['plannedActivities'],
        message: 'Add a sport activity',
      });
    }
    input.plannedActivities.forEach((activity, index) => {
      if (activity.kind !== 'sport' || activity.label !== null) return;
      ctx.addIssue({
        code: 'too_small',
        origin: 'string',
        minimum: 1,
        inclusive: true,
        input: activity.label,
        path: ['plannedActivities', index, 'label'],
        message: 'Name your sport',
      });
    });
  });
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export const TargetsSchema = z.object({
  kcal: z.number().int(),
  proteinG: z.number().int(),
  carbsG: z.number().int(),
  fatG: z.number().int(),
  fiberG: z.number().int(),
  formulaVersion: z.string(),
  /** Why the targets were limited, if they were: `calorie_floor` or `activity_ceiling`. */
  clampedReason: z.string().nullable(),
});
export type Targets = z.infer<typeof TargetsSchema>;

/** The numbers behind the targets, shown in "How is this calculated?" (AC15). */
export const TargetsBreakdownSchema = z.object({
  ageYears: z.number().int(),
  bmrKcal: z.number().int(),
  /** Job factor + training factor, after the ceiling. TDEE = BMR × this. */
  activityFactor: z.number(),
  jobFactor: z.number(),
  trainingFactor: z.number(),
  tdeeKcal: z.number().int(),
  goalAdjustmentKcal: z.number().int(),
  floorKcal: z.number().int(),
  proteinGPerKg: z.number(),
  /** Weight used for protein and the fat minimum: the actual weight, or the BMI-25 weight when BMI ≥ 30. */
  referenceWeightKg: z.number(),
  /** What the user trains for, which sets the protein and the carbohydrate minimum (spec 004). */
  trainingFocus: TrainingFocusSchema,
  /** Carbohydrate minimum per kg of reference weight; null outside sport performance (spec 004 AC7). */
  carbsMinGPerKg: z.number().nullable(),
});
export type TargetsBreakdown = z.infer<typeof TargetsBreakdownSchema>;

export const SafetyStatusSchema = z.enum(['ok', 'teen_limited', 'blocked']);
export type SafetyStatus = z.infer<typeof SafetyStatusSchema>;

export const SafetyEvaluationSchema = z.object({
  status: SafetyStatusSchema,
  requestedGoal: GoalSchema,
  appliedGoal: GoalSchema,
  flags: z.array(SafetyFlagSchema),
  /** Cap on the surplus as a fraction of TDEE, when limited (teens: 0.1). */
  maxSurplusRatio: z.number().nullable(),
  /** False when the app must not show numeric targets (blocked age, pregnancy/breastfeeding → see a professional). */
  targetsAllowed: z.boolean(),
});
export type SafetyEvaluation = z.infer<typeof SafetyEvaluationSchema>;

export const ProfileSchema = z.object({
  sex: SexSchema,
  birthDate: IsoDateSchema,
  heightCm: z.number(),
  weightKg: z.number(),
  targetWeightKg: z.number().nullable(),
  /** Null for an account created before spec 002 that has not filled in the form again. */
  jobActivity: JobActivitySchema.nullable(),
  plannedActivities: z.array(PlannedActivitySchema),
  requestedGoal: GoalSchema,
  goal: GoalSchema,
  /** Never null after the backfill of migration 0004; nullable so an old row cannot break a read. */
  trainingFocus: TrainingFocusSchema.nullable(),
  safetyFlags: z.array(SafetyFlagSchema),
  injuries: z.string().nullable(),
  units: UnitsSchema,
  locale: LocaleSchema,
  onboardingCompletedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const StoredTargetsSchema = TargetsSchema.extend({
  validFrom: z.iso.datetime({ offset: true }),
});
export type StoredTargets = z.infer<typeof StoredTargetsSchema>;

export const MeResponseSchema = z.object({
  userId: z.uuid(),
  consent: z.object({
    healthData: z.boolean(),
    version: z.string().nullable(),
  }),
  onboardingCompleted: z.boolean(),
  profile: ProfileSchema.nullable(),
  dietaryPrefs: DietaryPrefsSchema.nullable(),
  targets: StoredTargetsSchema.nullable(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
