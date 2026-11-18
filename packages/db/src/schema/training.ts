import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid } from 'drizzle-orm/supabase';
import {
  activityTypeEnum,
  equipmentEnum,
  exerciseCategoryEnum,
  exerciseOriginEnum,
  exerciseTrackingEnum,
  muscleGroupEnum,
  workoutInputMethodEnum,
  workoutKindEnum,
} from './enums';
import { knowledgeSources } from './food';
import { profiles } from './profiles';

/**
 * Every exercise a user can log (spec 009): the curated catalog (records of free-exercise-db with names
 * written by us, loaded by `import:exercises`) and the exercises a user creates, which only their owner
 * can read. A custom exercise is deleted with a tombstone, so past sets keep pointing at it.
 * RLS: catalog rows are readable by every signed-in user, custom rows by their owner; every write goes
 * through apps/api or the importer.
 */
export const exercises = pgTable(
  'exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Curated key (`press-banca`); null for a custom exercise. */
    key: text('key').unique(),
    origin: exerciseOriginEnum('origin').notNull().default('catalog'),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'cascade' }),
    source: text('source').references(() => knowledgeSources.id),
    sourceId: text('source_id'),
    nameEs: text('name_es').notNull(),
    nameEn: text('name_en').notNull(),
    synonymsEs: text('synonyms_es')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    synonymsEn: text('synonyms_en')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tracking: exerciseTrackingEnum('tracking').notNull(),
    category: exerciseCategoryEnum('category').notNull(),
    primaryMuscles: muscleGroupEnum('primary_muscles')
      .array()
      .notNull()
      .default(sql`'{}'`),
    secondaryMuscles: muscleGroupEnum('secondary_muscles')
      .array()
      .notNull()
      .default(sql`'{}'`),
    equipment: equipmentEnum('equipment')
      .array()
      .notNull()
      .default(sql`'{}'`),
    popularity: smallint('popularity').notNull().default(0),
    /** Custom rows: device time of the write, the later one wins (also against a delete). */
    recordedAt: timestamp('recorded_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('exercises_source_record_key').on(t.source, t.sourceId),
    index('exercises_owner_id_idx').on(t.ownerId),
    check(
      'exercises_owner_matches_origin',
      sql`(${t.ownerId} is null) = (${t.origin} = 'catalog')`,
    ),
    check('exercises_custom_recorded', sql`${t.origin} = 'catalog' or ${t.recordedAt} is not null`),
    check(
      'exercises_name_length',
      sql`length(${t.nameEs}) between 1 and 80 and length(${t.nameEn}) between 1 and 80`,
    ),
    pgPolicy('exercises_select_catalog_or_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.ownerId} is null or ${t.ownerId} = ${authUid}`,
    }),
  ],
);

/**
 * The training log (spec 009): one row per gym session or activity, with a client-generated id
 * (offline-safe `PUT` that replaces the workout and its sets). A delete keeps the row as a tombstone
 * so an older write cannot bring it back (AC23).
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const workouts = pgTable(
  'workouts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** The user's day the workout started on. */
    localDate: date('local_date', { mode: 'string' }).notNull(),
    kind: workoutKindEnum('kind').notNull(),
    /** The activity chip of AC16; null for a gym session or a profile activity's name. */
    activity: activityTypeEnum('activity'),
    name: text('name'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    minutes: smallint('minutes').notNull(),
    sessionRpe: smallint('session_rpe'),
    inputMethod: workoutInputMethodEnum('input_method').notNull(),
    /** Device time of the write: the later one wins, also against a delete (AC23). */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('workouts_user_date_idx').on(t.userId, t.localDate),
    check('workouts_minutes_range', sql`${t.minutes} between 1 and 600`),
    check('workouts_rpe_range', sql`${t.sessionRpe} is null or ${t.sessionRpe} between 1 and 10`),
    check('workouts_name_length', sql`${t.name} is null or length(${t.name}) between 1 and 60`),
    pgPolicy('workouts_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);

/**
 * The completed sets of a gym session, replaced with the workout on every `PUT` (AC23). `user_id` is
 * copied from the workout for RLS and for the per-exercise stats query (AC14).
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const workoutSets = pgTable(
  'workout_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workoutId: uuid('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id').references(() => exercises.id, { onDelete: 'set null' }),
    /** Snapshot of the exercise's name in the user's locale at the time. */
    exerciseLabel: text('exercise_label').notNull(),
    /** Snapshot of the exercise's tracking, so a set whose exercise is gone still reads right. */
    tracking: exerciseTrackingEnum('tracking').notNull(),
    /** Order of the exercise in the session, from 0. */
    position: smallint('position').notNull(),
    /** Order of the set within the exercise, from 1. */
    setNumber: smallint('set_number').notNull(),
    reps: smallint('reps'),
    weightKg: numeric('weight_kg', { precision: 5, scale: 2, mode: 'number' }),
    durationS: integer('duration_s'),
    distanceM: integer('distance_m'),
    restS: smallint('rest_s'),
  },
  (t) => [
    index('workout_sets_workout_id_idx').on(t.workoutId),
    index('workout_sets_user_exercise_idx').on(t.userId, t.exerciseId),
    unique('workout_sets_position_key').on(t.workoutId, t.position, t.setNumber),
    check('workout_sets_reps_range', sql`${t.reps} is null or ${t.reps} between 1 and 100`),
    check(
      'workout_sets_weight_range',
      sql`${t.weightKg} is null or ${t.weightKg} between 0 and 500`,
    ),
    check(
      'workout_sets_duration_range',
      sql`${t.durationS} is null or ${t.durationS} between 1 and 10800`,
    ),
    check(
      'workout_sets_distance_range',
      sql`${t.distanceM} is null or ${t.distanceM} between 1 and 100000`,
    ),
    check('workout_sets_rest_range', sql`${t.restS} is null or ${t.restS} between 0 and 900`),
    pgPolicy('workout_sets_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);
