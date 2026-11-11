import {
  ActivityLevelSchema,
  ConsentKindSchema,
  DietTypeSchema,
  GoalSchema,
  LocaleSchema,
  SexSchema,
  UnitsSchema,
} from '@pt/contracts';
import { pgEnum } from 'drizzle-orm/pg-core';

/** Zod 4 types `.options` as an array; pgEnum needs a non-empty tuple. Zod enums are never empty. */
function values<T extends string>(schema: { options: readonly T[] }): [T, ...T[]] {
  return schema.options as unknown as [T, ...T[]];
}

// Enum values come from @pt/contracts so the DB and the API can never drift apart.
export const sexEnum = pgEnum('sex', values(SexSchema));
export const activityLevelEnum = pgEnum('activity_level', values(ActivityLevelSchema));
export const goalEnum = pgEnum('goal', values(GoalSchema));
export const dietTypeEnum = pgEnum('diet_type', values(DietTypeSchema));
export const unitsEnum = pgEnum('units', values(UnitsSchema));
export const localeEnum = pgEnum('locale', values(LocaleSchema));
export const consentKindEnum = pgEnum('consent_kind', values(ConsentKindSchema));
