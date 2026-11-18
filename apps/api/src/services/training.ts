import type { Exercise } from '@pt/contracts';
import type { LoggableExercise } from '@pt/core';
import type { Store } from '../deps';

export interface ExerciseCatalog {
  exercises: Exercise[];
  version: string;
}

/** The catalog changes only when the importer runs, so each API instance keeps it for a while. */
const CATALOG_TTL_MS = 10 * 60 * 1000;

/**
 * Loads the curated exercise catalog once per instance (spec 009 AC1). Custom exercises are never in
 * it: they are private, so nothing of a user stays in shared memory.
 */
export function createExerciseCatalogCache(store: Store, now: () => Date) {
  let cached: { catalog: ExerciseCatalog; loadedAt: number } | null = null;
  let loading: Promise<ExerciseCatalog> | null = null;

  return async function getExerciseCatalog(): Promise<ExerciseCatalog> {
    if (cached && now().getTime() - cached.loadedAt < CATALOG_TTL_MS) return cached.catalog;
    loading ??= store
      .listExerciseCatalog()
      .then((catalog) => {
        cached = { catalog, loadedAt: now().getTime() };
        return catalog;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  };
}

/** The exercises of a workout the user may log, by id (spec 009 AC23: unknown ids are a 404). */
export async function loggableExercises(
  store: Store,
  userId: string,
  ids: readonly string[],
): Promise<Map<string, LoggableExercise>> {
  const found = await store.getLoggableExercises(userId, [...new Set(ids)]);
  return new Map(found.map((e) => [e.id, e]));
}
