import {
  ActivityKindSchema,
  ConsentKindSchema,
  FoodInputMethodSchema,
  FoodOriginSchema,
  DietTypeSchema,
  EquipmentAccessSchema,
  EquipmentSchema,
  ExerciseCategorySchema,
  ExerciseOriginSchema,
  ExerciseTrackingSchema,
  GoalSchema,
  IntensitySchema,
  JobActivitySchema,
  LocaleSchema,
  MealTypeSchema,
  MuscleGroupSchema,
  ProgramOriginSchema,
  QuantityUnitSchema,
  SexSchema,
  TrainingExperienceSchema,
  TrainingFocusSchema,
  UnitsSchema,
  ActivityTypeSchema,
  WorkoutInputMethodSchema,
  WorkoutKindSchema,
  WorkPatternSchema,
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
export const exerciseOriginEnum = pgEnum('exercise_origin', values(ExerciseOriginSchema));
export const exerciseTrackingEnum = pgEnum('exercise_tracking', values(ExerciseTrackingSchema));
export const exerciseCategoryEnum = pgEnum('exercise_category', values(ExerciseCategorySchema));
export const muscleGroupEnum = pgEnum('muscle_group', values(MuscleGroupSchema));
export const equipmentEnum = pgEnum('equipment', values(EquipmentSchema));
export const workoutKindEnum = pgEnum('workout_kind', values(WorkoutKindSchema));
export const activityTypeEnum = pgEnum('activity_type', values(ActivityTypeSchema));
export const workoutInputMethodEnum = pgEnum(
  'workout_input_method',
  values(WorkoutInputMethodSchema),
);
export const workPatternEnum = pgEnum('work_pattern', values(WorkPatternSchema));
export const trainingExperienceEnum = pgEnum(
  'training_experience',
  values(TrainingExperienceSchema),
);
export const equipmentAccessEnum = pgEnum('equipment_access', values(EquipmentAccessSchema));
export const programOriginEnum = pgEnum('program_origin', values(ProgramOriginSchema));
