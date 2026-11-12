import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid } from 'drizzle-orm/supabase';
import { activityKindEnum, intensityEnum, jobActivityEnum } from './enums';
import { profiles } from './profiles';

/**
 * What the user's job is like (spec 002). One row per user and no history: `nutrition_targets` already
 * records when the numbers changed. Stage E5 adds the work schedule next to it.
 * RLS: users may only read their own row; every write goes through apps/api.
 */
export const lifestyleProfiles = pgTable(
  'lifestyle_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    jobActivity: jobActivityEnum('job_activity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    pgPolicy('lifestyle_profiles_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);

/**
 * The weekly training plan, without weekdays (spec 002): one row per activity. The API replaces the
 * whole list on every profile save. Stage E5 adds weekdays and times on top of it.
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const plannedActivities = pgTable(
  'planned_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    kind: activityKindEnum('kind').notNull(),
    /** Optional name, e.g. "fútbol". */
    label: text('label'),
    sessionsPerWeek: smallint('sessions_per_week').notNull(),
    minutesPerSession: smallint('minutes_per_session').notNull(),
    intensity: intensityEnum('intensity').notNull(),
    /** Order in the form. */
    position: smallint('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('planned_activities_user_id_idx').on(t.userId),
    check('planned_activities_sessions_range', sql`${t.sessionsPerWeek} between 1 and 14`),
    check('planned_activities_minutes_range', sql`${t.minutesPerSession} between 10 and 240`),
    check('planned_activities_label_length', sql`${t.label} is null or length(${t.label}) <= 40`),
    pgPolicy('planned_activities_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);
