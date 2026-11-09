/**
 * @pt/db — Drizzle schema, client and migrations.
 * Only apps/api may import this package (enforced by ESLint).
 */
export * as schema from './schema';
export { createDb, type Db } from './client';
