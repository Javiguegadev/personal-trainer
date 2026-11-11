/**
 * Drizzle tables live here, one file per domain (profiles.ts, nutrition.ts, training.ts, ...).
 * Tables are added stage by stage via the `db-migration` skill (see docs/BLUEPRINT.md §5).
 */
export * from './enums';
export * from './profiles';
export * from './nutrition';
export * from './privacy';
export * from './ai';
