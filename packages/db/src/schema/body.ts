import { sql } from 'drizzle-orm';
import {
  check,
  date,
  numeric,
  pgPolicy,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid } from 'drizzle-orm/supabase';
import { profiles } from './profiles';

/**
 * The weight log (spec 003): one row per user and day. The most recent row is copied to
 * `profiles.weight_kg`, which the targets and the safety rules read.
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const bodyMeasurements = pgTable(
  'body_measurements',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** The user's day. */
    localDate: date('local_date', { mode: 'string' }).notNull(),
    weightKg: numeric('weight_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    /** Device time of the write: the later one wins when two devices write the same day. */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.localDate] }),
    check('body_measurements_weight_kg_range', sql`${t.weightKg} between 30 and 300`),
    pgPolicy('body_measurements_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);
