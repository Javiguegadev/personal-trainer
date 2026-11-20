/**
 * The starter routine templates of `@pt/core` against the committed catalog (spec 010 AC15). It lives
 * here, next to the catalog, because `@pt/core` cannot read files.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routineExerciseKeys } from '@pt/core';
import { describe, expect, it } from 'vitest';
import { parseExerciseCatalog } from './build';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = parseExerciseCatalog(
  readFileSync(resolve(here, '../catalog/exercises.csv'), 'utf8'),
).entries;

describe('routine templates (spec 010 AC15)', () => {
  it('use only keys of the curated catalog', () => {
    const keys = new Set(catalog.map((e) => e.key));
    expect(routineExerciseKeys().filter((key) => !keys.has(key))).toEqual([]);
  });

  it('use strength or core exercises tracked by reps or time, never distance', () => {
    const byKey = new Map(catalog.map((e) => [e.key, e]));
    for (const key of routineExerciseKeys()) {
      expect(['weight_reps', 'reps', 'duration'], key).toContain(byKey.get(key)?.tracking);
    }
  });
});
