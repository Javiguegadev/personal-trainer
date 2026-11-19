import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid } from 'drizzle-orm/supabase';
import {
  activityKindEnum,
  equipmentAccessEnum,
  intensityEnum,
  jobActivityEnum,
  trainingExperienceEnum,
  trainingFocusEnum,
  workPatternEnum,
} from './enums';
import { profiles } from './profiles';

/**
 * What the user's job is like (spec 002). One row per user and no history: `nutrition_targets` already
 * records when the numbers changed. Spec 010 adds the work pattern and the day start; the work hours
 * live in `work_blocks`.
 * RLS: users may only read their own row; every write goes through apps/api.
 */
export const lifestyleProfiles = pgTable(
  'lifestyle_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    jobActivity: jobActivityEnum('job_activity').notNull(),
    /** How the job hours work (spec 010 AC3); null until "Mi semana" is saved. */
    workPattern: workPatternEnum('work_pattern'),
    /** When the user's day starts, in minutes after midnight (spec 010 AC6). */
    dayStartMinute: smallint('day_start_minute').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      'lifestyle_profiles_day_start_range',
      sql`${t.dayStartMinute} between 0 and 360 and ${t.dayStartMinute} % 30 = 0`,
    ),
    pgPolicy('lifestyle_profiles_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);

/**
 * The weekly training plan, without weekdays (spec 002): one row per activity. The API replaces the
 * whole list on every profile save. Its weekdays live in `planned_activity_days` (spec 010).
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

/**
 * What the user trains for (spec 004): one row per user, which sets the macros (`targets-v3`). Spec 010
 * adds the experience and equipment of the routine wizard; training days come from the activities.
 * RLS: users may only read their own row; every write goes through apps/api.
 */
export const trainingProfiles = pgTable(
  'training_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    focus: trainingFocusEnum('focus').notNull(),
    /** The routine wizard's answers (spec 010 AC14); null until then. */
    experience: trainingExperienceEnum('experience'),
    equipment: equipmentAccessEnum('equipment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    pgPolicy('training_profiles_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);

/**
 * The work hours of the typical week (spec 010 AC3): one block per weekday (ISO, Monday = 1), only for
 * a fixed work pattern. An end before the start means the block ends the next day. Replaced as a
 * whole by `PUT /me/week`.
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const workBlocks = pgTable(
  'work_blocks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    weekday: smallint('weekday').notNull(),
    startMinute: smallint('start_minute').notNull(),
    endMinute: smallint('end_minute').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.weekday] }),
    check('work_blocks_weekday_range', sql`${t.weekday} between 1 and 7`),
    check(
      'work_blocks_minutes_range',
      sql`${t.startMinute} between 0 and 1439 and ${t.endMinute} between 0 and 1439 and ${t.startMinute} <> ${t.endMinute}`,
    ),
    pgPolicy('work_blocks_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);

/**
 * The weekdays of a planned activity (spec 010 AC2), rewritten with `planned_activities` on every save.
 * `is_match` marks a match day of a sport (the contract allows it only for sports).
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const plannedActivityDays = pgTable(
  'planned_activity_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => plannedActivities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    weekday: smallint('weekday').notNull(),
    startMinute: smallint('start_minute'),
    isMatch: boolean('is_match').notNull().default(false),
  },
  (t) => [
    unique('planned_activity_days_weekday_key').on(t.activityId, t.weekday),
    index('planned_activity_days_user_id_idx').on(t.userId),
    check('planned_activity_days_weekday_range', sql`${t.weekday} between 1 and 7`),
    check(
      'planned_activity_days_start_range',
      sql`${t.startMinute} is null or ${t.startMinute} between 0 and 1439`,
    ),
    pgPolicy('planned_activity_days_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);
