import { z } from 'zod';
import { ExportedCheckinSchema } from './checkin';
import { DietaryPrefsSchema, ProfileSchema, StoredTargetsSchema } from './profile';
import { WeightEntrySchema } from './weight';
import { FoodSchema, MealItemSchema } from './food';
import { ExerciseSchema, ProgramSchema, WorkoutSchema } from './training';
import { ExportedPlanSchema } from './plan';

/**
 * Version of the consent text shown to the user. Bump it when the text changes: a consent given to an
 * older version no longer counts, so the app asks again (spec 002 AC13, AC14).
 */
export const CONSENT_VERSION = '2026-11-v9';

export const ConsentKindSchema = z.enum(['health_data']);
export type ConsentKind = z.infer<typeof ConsentKindSchema>;

export const ConsentRequestSchema = z.object({
  kind: ConsentKindSchema,
  /** Only the current text can be accepted. */
  version: z.literal(CONSENT_VERSION),
});
export type ConsentRequest = z.infer<typeof ConsentRequestSchema>;

const datetime = z.iso.datetime({ offset: true });

export const ExportResponseSchema = z.object({
  exportedAt: datetime,
  userId: z.uuid(),
  email: z.string().nullable(),
  profile: ProfileSchema.nullable(),
  dietaryPrefs: DietaryPrefsSchema.nullable(),
  targets: z.array(StoredTargetsSchema.extend({ validTo: datetime.nullable() })),
  /** The weight log, oldest first (spec 003 AC26). */
  weights: z.array(WeightEntrySchema),
  /** The food log, oldest first (spec 005 AC23). */
  mealItems: z.array(MealItemSchema),
  /** Starred foods (spec 005 AC23). */
  favouriteFoods: z.array(z.object({ foodId: z.uuid(), key: z.string(), createdAt: datetime })),
  /** The foods the user created, in Spanish (spec 006 AC22). */
  customFoods: z.array(FoodSchema),
  /** The training log with its sets, oldest first (spec 009 AC25). */
  workouts: z.array(WorkoutSchema),
  /** The exercises the user created, deleted ones included with their date (spec 009 AC25). */
  customExercises: z.array(ExerciseSchema.extend({ deletedAt: datetime.nullable() })),
  /** The user's routines, deleted ones included with their date (spec 010 AC24). */
  programs: z.array(ProgramSchema.extend({ deletedAt: datetime.nullable() })),
  /** The daily check-ins, oldest first, deleted ones included with their date (spec 011 AC16). */
  checkins: z.array(ExportedCheckinSchema),
  /** The planned meals and sessions, deleted ones included with their date (spec 013 AC25). */
  plan: ExportedPlanSchema,
  consents: z.array(
    z.object({
      kind: ConsentKindSchema,
      version: z.string(),
      grantedAt: datetime,
      revokedAt: datetime.nullable(),
    }),
  ),
  aiUsage: z.array(
    z.object({
      feature: z.string(),
      model: z.string(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      createdAt: datetime,
    }),
  ),
});
export type ExportResponse = z.infer<typeof ExportResponseSchema>;
