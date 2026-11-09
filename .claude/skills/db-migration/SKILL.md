---
name: db-migration
description: Safely change the Postgres schema with Drizzle (schema edit, generate, review SQL, RLS, seed). Use for any new table, column, index or policy.
---

# Database migration

1. Edit or add `packages/db/src/schema/<domain>.ts` and re-export it from `schema/index.ts`.
   - Use `uuid` PKs (`defaultRandom()`), `timestamp with time zone` with `defaultNow()`, and an FK to
     `profiles.id` (= `auth.users.id`) for user-owned rows.
   - Use `numeric`/`integer` for nutrition values (never float for stored macros), and add indexes for every
     `(user_id, date)` query.
2. Run `pnpm db:generate`, then **read the generated SQL** and report anything destructive (drops, type
   changes, NOT NULL on existing tables) to the human.
3. Enable RLS and add policies for every user-owned table in the same migration (custom SQL migration if
   needed): `user_id = auth.uid()` for select/insert/update/delete. Public catalog tables get read-only
   policies.
4. Apply locally only: `pnpm db:migrate`. Applying to remote projects is a human step.
5. Update seed data if needed (`packages/db/src/seed/`), keeping it idempotent.
6. Never edit a migration that's already committed (a hook blocks it). Create a new one.
