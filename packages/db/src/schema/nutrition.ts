import { sql } from 'drizzle-orm';
import { index, integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid } from 'drizzle-orm/supabase';
import { profiles } from './profiles';

/**
 * Daily targets history (spec 001 AC16). The current row has `valid_to` null; editing the profile closes
 * it and inserts a new one, so past logs keep the targets that applied at the time.
 */
export const nutritionTargets = pgTable(
  'nutrition_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    kcal: integer('kcal').notNull(),
    proteinG: integer('protein_g').notNull(),
    carbsG: integer('carbs_g').notNull(),
    fatG: integer('fat_g').notNull(),
    fiberG: integer('fiber_g').notNull(),
    formulaVersion: text('formula_version').notNull(),
    clampedReason: text('clamped_reason'),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp('valid_to', { withTimezone: true }),
  },
  (t) => [
    index('nutrition_targets_user_valid_from_idx').on(t.userId, t.validFrom.desc()),
    pgPolicy('nutrition_targets_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);
