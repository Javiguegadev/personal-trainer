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
  uniqueIndex,
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
  programOriginEnum,
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
    /** The routine session it was started from (spec 010 AC18); null when free or removed. */
    programSessionId: uuid('program_session_id').references(() => programSessions.id, {
      onDelete: 'set null',
    }),
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
    index('workouts_user_program_session_idx').on(t.userId, t.programSessionId),
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

/**
 * The user's routine (spec 010, the Plans block of BLUEPRINT §5): a template of @pt/core edited by the
 * user, or built by hand. One active routine per user; a delete keeps the row as a tombstone so an
 * older write cannot bring it back (AC22). The AI programs of E7 write to the same tables.
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const workoutPrograms = pgTable(
  'workout_programs',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    origin: programOriginEnum('origin').notNull(),
    /** The template it came from (`full-body-ab`); null when built by hand. */
    templateKey: text('template_key'),
    /** Device time of the write: the later one wins, also against a delete (AC22). */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('workout_programs_one_active_idx')
      .on(t.userId)
      .where(sql`${t.deletedAt} is null`),
    check('workout_programs_name_length', sql`length(${t.name}) between 1 and 60`),
    pgPolicy('workout_programs_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);

/**
 * The sessions of a routine, in rotation order (A, B, C…). Their ids come from the device and stay the
 * same across edits, so workouts keep pointing at them (AC19); a session left out of a write is deleted
 * and its workouts lose the link (`on delete set null`, AC22).
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const programSessions = pgTable(
  'program_sessions',
  {
    id: uuid('id').primaryKey(),
    programId: uuid('program_id')
      .notNull()
      .references(() => workoutPrograms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    name: text('name').notNull(),
  },
  (t) => [
    index('program_sessions_program_id_idx').on(t.programId),
    check('program_sessions_name_length', sql`length(${t.name}) between 1 and 40`),
    pgPolicy('program_sessions_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);

/**
 * The exercises of a routine session with their target (sets and a rep range, or a time), replaced
 * with the routine on every write. The label is a snapshot, as in `workout_sets`.
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const programExercises = pgTable(
  'program_exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => programSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    exerciseId: uuid('exercise_id').references(() => exercises.id, { onDelete: 'set null' }),
    exerciseLabel: text('exercise_label').notNull(),
    tracking: exerciseTrackingEnum('tracking').notNull(),
    sets: smallint('sets').notNull(),
    repsMin: smallint('reps_min'),
    repsMax: smallint('reps_max'),
    durationS: integer('duration_s'),
    restS: smallint('rest_s'),
  },
  (t) => [
    index('program_exercises_session_id_idx').on(t.sessionId),
    index('program_exercises_user_id_idx').on(t.userId),
    check('program_exercises_sets_range', sql`${t.sets} between 1 and 10`),
    check(
      'program_exercises_reps_range',
      sql`(${t.repsMin} is null and ${t.repsMax} is null) or (${t.repsMin} between 1 and 100 and ${t.repsMax} between ${t.repsMin} and 100)`,
    ),
    check(
      'program_exercises_duration_range',
      sql`${t.durationS} is null or ${t.durationS} between 1 and 10800`,
    ),
    check('program_exercises_rest_range', sql`${t.restS} is null or ${t.restS} between 0 and 900`),
    pgPolicy('program_exercises_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);
