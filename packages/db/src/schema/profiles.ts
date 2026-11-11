import { sql } from 'drizzle-orm';
import {
  check,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  date,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid, authUsers } from 'drizzle-orm/supabase';
import { activityLevelEnum, dietTypeEnum, goalEnum, localeEnum, sexEnum, unitsEnum } from './enums';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * One row per user (spec 001). `id` = auth.users.id; deleting the auth user cascades everywhere.
 * RLS: users may only read their own row; every write goes through apps/api.
 */
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    sex: sexEnum('sex').notNull(),
    birthDate: date('birth_date', { mode: 'string' }).notNull(),
    heightCm: numeric('height_cm', { precision: 5, scale: 1, mode: 'number' }).notNull(),
    weightKg: numeric('weight_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    targetWeightKg: numeric('target_weight_kg', { precision: 5, scale: 2, mode: 'number' }),
    activityLevel: activityLevelEnum('activity_level').notNull(),
    /** The goal applied after safety rules. */
    goal: goalEnum('goal').notNull(),
    /** The goal the user asked for. */
    requestedGoal: goalEnum('requested_goal').notNull(),
    safetyFlags: text('safety_flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    injuries: text('injuries'),
    units: unitsEnum('units').notNull().default('metric'),
    locale: localeEnum('locale').notNull().default('es'),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check('profiles_height_cm_range', sql`${t.heightCm} between 120 and 230`),
    check('profiles_weight_kg_range', sql`${t.weightKg} between 30 and 300`),
    check(
      'profiles_target_weight_kg_range',
      sql`${t.targetWeightKg} is null or ${t.targetWeightKg} between 30 and 300`,
    ),
    pgPolicy('profiles_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.id} = ${authUid}`,
    }),
  ],
);

export const dietaryPrefs = pgTable(
  'dietary_prefs',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    dietType: dietTypeEnum('diet_type').notNull(),
    allergies: text('allergies')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dislikes: text('dislikes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    restrictions: text('restrictions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (t) => [
    pgPolicy('dietary_prefs_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);
