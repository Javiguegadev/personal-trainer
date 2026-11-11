import { sql } from 'drizzle-orm';
import { index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid, authUsers } from 'drizzle-orm/supabase';
import { consentKindEnum } from './enums';

/**
 * Append-only consent log (GDPR art. 7 + 9). Linked to auth.users because consent is given before the
 * profile exists.
 */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    kind: consentKindEnum('kind').notNull(),
    version: text('version').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('consents_user_kind_idx').on(t.userId, t.kind),
    pgPolicy('consents_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);
