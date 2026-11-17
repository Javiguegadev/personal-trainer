import {
  ActivityKindSchema,
  ConsentKindSchema,
  FoodInputMethodSchema,
  FoodOriginSchema,
  DietTypeSchema,
  GoalSchema,
  IntensitySchema,
  JobActivitySchema,
  LocaleSchema,
  MealTypeSchema,
  QuantityUnitSchema,
  SexSchema,
  TrainingFocusSchema,
  UnitsSchema,
} from '@pt/contracts';
import { pgEnum } from 'drizzle-orm/pg-core';

/** Zod 4 types `.options` as an array; pgEnum needs a non-empty tuple. Zod enums are never empty. */
function values<T extends string>(schema: { options: readonly T[] }): [T, ...T[]] {
  return schema.options as unknown as [T, ...T[]];
}

// Enum values come from @pt/contracts so the DB and the API can never drift apart.
export const sexEnum = pgEnum('sex', values(SexSchema));
export const jobActivityEnum = pgEnum('job_activity', values(JobActivitySchema));
export const activityKindEnum = pgEnum('activity_kind', values(ActivityKindSchema));
export const intensityEnum = pgEnum('intensity', values(IntensitySchema));
export const goalEnum = pgEnum('goal', values(GoalSchema));
export const trainingFocusEnum = pgEnum('training_focus', values(TrainingFocusSchema));
export const dietTypeEnum = pgEnum('diet_type', values(DietTypeSchema));
export const unitsEnum = pgEnum('units', values(UnitsSchema));
export const localeEnum = pgEnum('locale', values(LocaleSchema));
export const consentKindEnum = pgEnum('consent_kind', values(ConsentKindSchema));
export const mealTypeEnum = pgEnum('meal_type', values(MealTypeSchema));
export const foodInputMethodEnum = pgEnum('food_input_method', values(FoodInputMethodSchema));
export const quantityUnitEnum = pgEnum('quantity_unit', values(QuantityUnitSchema));
export const foodOriginEnum = pgEnum('food_origin', values(FoodOriginSchema));
