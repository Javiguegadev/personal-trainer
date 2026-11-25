import type { ReviewSummary } from '@pt/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid } from 'drizzle-orm/supabase';
import { reviewStatusEnum } from './enums';
import { profiles } from './profiles';

/**
 * The weekly review (spec 014): one row per user and reviewed week (Monday to Sunday), computed on the
 * first read from its Monday and stored with the numbers it used (`inputs`, `rules_version`), so a
 * review always reads as it was made (BLUEPRINT §5, traceable). A decision changes `status` and
 * `decided_at` once; "Aplicar" also changes `profiles.energy_calibration_kcal`.
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const weeklyReviews = pgTable(
  'weekly_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** The Monday of the reviewed week (user's local dates). */
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    status: reviewStatusEnum('status').notNull(),
    /** The proposed change of the calibration (±100), or null without a proposal. */
    kcalDelta: smallint('kcal_delta'),
    /** The kcal target before and after the proposal, as shown ("2.200 → 2.100 kcal"). */
    fromKcal: smallint('from_kcal'),
    toKcal: smallint('to_kcal'),
    /** Reason codes (`ReviewReasonSchema`). */
    reasons: text('reasons')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The summary the review showed (`ReviewSummarySchema`). */
    inputs: jsonb('inputs').$type<ReviewSummary>().notNull(),
    rulesVersion: text('rules_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    // Also the index of every read (by user, newest week first: the index scans backwards).
    unique('weekly_reviews_user_week_unique').on(t.userId, t.weekStart),
    // A proposal has its three numbers; a review without one has none. ±300: REVIEW_RULES.calibrationMaxKcal.
    check(
      'weekly_reviews_proposal',
      sql`(${t.kcalDelta} is null and ${t.fromKcal} is null and ${t.toKcal} is null) or (${t.kcalDelta} <> 0 and ${t.kcalDelta} between -300 and 300 and ${t.fromKcal} > 0 and ${t.toKcal} > 0)`,
    ),
    // Only a review with a proposal can be accepted or rejected.
    check(
      'weekly_reviews_status',
      sql`case when ${t.status} = 'no_change' then ${t.kcalDelta} is null else ${t.kcalDelta} is not null end`,
    ),
    // Monday: ISO day of week 1.
    check('weekly_reviews_week_start_monday', sql`extract(isodow from ${t.weekStart}) = 1`),
    pgPolicy('weekly_reviews_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);
