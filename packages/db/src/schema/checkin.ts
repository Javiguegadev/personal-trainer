import { sql } from 'drizzle-orm';
import {
  check,
  date,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid } from 'drizzle-orm/supabase';
import { checkinSourceEnum, stressLevelEnum, workShiftEnum } from './enums';
import { profiles } from './profiles';

/**
 * The daily check-in (spec 011): how the user slept, how stressed they are and, for shift and
 * irregular workers, today's shift. One row per user and local day; a shift crossing midnight is
 * stored on the day it starts. The readiness is computed on the device, never stored.
 * A delete keeps the row as a tombstone (`deleted_at`) so an older write cannot bring it back (AC15).
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const dailyCheckins = pgTable(
  'daily_checkins',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** The user's day, with the day start of spec 010 AC6. */
    localDate: date('local_date', { mode: 'string' }).notNull(),
    /** Minutes slept: a chip's middle value, or exact minutes from a health import later (ADR 007). */
    sleepMinutes: smallint('sleep_minutes'),
    stress: stressLevelEnum('stress'),
    workShift: workShiftEnum('work_shift'),
    /** The shift hours (minutes after midnight); an end before the start ends the next day. */
    shiftStartMinute: smallint('shift_start_minute'),
    shiftEndMinute: smallint('shift_end_minute'),
    source: checkinSourceEnum('source').notNull().default('manual'),
    /** Device time of the write: the later one wins, also against a delete (AC15). */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.localDate] }),
    check(
      'daily_checkins_sleep_range',
      sql`${t.sleepMinutes} is null or ${t.sleepMinutes} between 0 and 960`,
    ),
    check(
      'daily_checkins_shift_minutes_range',
      sql`(${t.shiftStartMinute} is null or ${t.shiftStartMinute} between 0 and 1439) and (${t.shiftEndMinute} is null or ${t.shiftEndMinute} between 0 and 1439)`,
    ),
    // Both hours iff a working shift, and a shift never starts and ends at the same minute.
    check(
      'daily_checkins_shift_hours',
      sql`case when ${t.workShift} in ('morning', 'afternoon', 'night') then ${t.shiftStartMinute} is not null and ${t.shiftEndMinute} is not null and ${t.shiftStartMinute} <> ${t.shiftEndMinute} else ${t.shiftStartMinute} is null and ${t.shiftEndMinute} is null end`,
    ),
    pgPolicy('daily_checkins_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);
