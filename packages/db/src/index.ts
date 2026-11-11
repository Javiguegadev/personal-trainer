/**
 * @pt/db — Drizzle schema, client and migrations.
 * Only apps/api may import this package (enforced by ESLint).
 */
export * as schema from './schema';
export { createDb, type Db } from './client';
// Query operators re-exported so apps/api uses the same drizzle-orm instance as the schema.
export { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
