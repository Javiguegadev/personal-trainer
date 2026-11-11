import { z } from 'zod';

/** Plausibility limits (spec 001 AC22). Values are metric; conversion happens in @pt/core/units. */
export const PROFILE_LIMITS = {
  heightCm: { min: 120, max: 230 },
  weightKg: { min: 30, max: 300 },
  textMax: 500,
  listMax: 30,
  listItemMax: 60,
} as const;

export const SexSchema = z.enum(['female', 'male', 'other']);
export type Sex = z.infer<typeof SexSchema>;

export const ActivityLevelSchema = z.enum([
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
]);
export type ActivityLevel = z.infer<typeof ActivityLevelSchema>;

export const GoalSchema = z.enum(['lose', 'maintain', 'gain']);
export type Goal = z.infer<typeof GoalSchema>;

export const DietTypeSchema = z.enum(['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'other']);
export type DietType = z.infer<typeof DietTypeSchema>;

export const UnitsSchema = z.enum(['metric', 'imperial']);
export type Units = z.infer<typeof UnitsSchema>;

export const LocaleSchema = z.enum(['es', 'en']);
export type Locale = z.infer<typeof LocaleSchema>;

/** Health facts the user reports (form checkbox or AI `flag_safety` tool). */
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

/** What the user confirms (form or chat summary). Metric only. */
export const ProfileInputSchema = z.object({
  sex: SexSchema,
  birthDate: IsoDateSchema,
  heightCm: HeightCmSchema,
  weightKg: WeightKgSchema,
  targetWeightKg: WeightKgSchema.nullable(),
  activityLevel: ActivityLevelSchema,
  /** The goal the user asked for; safety rules may apply a different one. */
  goal: GoalSchema,
  injuries: z.string().trim().max(PROFILE_LIMITS.textMax).nullable(),
  healthFlags: z.array(ReportedHealthFlagSchema).max(3),
  units: UnitsSchema,
  locale: LocaleSchema,
  dietaryPrefs: DietaryPrefsSchema,
  /** The user's local date (YYYY-MM-DD). The API accepts it only within ±1 day of server UTC. */
  today: IsoDateSchema,
});
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export const TargetsSchema = z.object({
  kcal: z.number().int(),
  proteinG: z.number().int(),
  carbsG: z.number().int(),
  fatG: z.number().int(),
  fiberG: z.number().int(),
  formulaVersion: z.string(),
  /** Why the targets were limited, if they were (e.g. `calorie_floor`). */
  clampedReason: z.string().nullable(),
});
export type Targets = z.infer<typeof TargetsSchema>;

/** The numbers behind the targets, shown in "How is this calculated?" (AC15). */
export const TargetsBreakdownSchema = z.object({
  ageYears: z.number().int(),
  bmrKcal: z.number().int(),
  activityFactor: z.number(),
  tdeeKcal: z.number().int(),
  goalAdjustmentKcal: z.number().int(),
  floorKcal: z.number().int(),
  proteinGPerKg: z.number(),
  /** Weight used for protein and the fat minimum: the actual weight, or the BMI-25 weight when BMI ≥ 30. */
  referenceWeightKg: z.number(),
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
  activityLevel: ActivityLevelSchema,
  requestedGoal: GoalSchema,
  goal: GoalSchema,
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
