/**
 * Exercise search against the committed catalog (spec 009 AC3, AC4). It lives here, next to the
 * catalog, because `@pt/core` cannot read files; the ranking itself is `searchExercises` of core.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchExercises } from '@pt/core';
import { describe, expect, it } from 'vitest';
import { parseExerciseCatalog } from './build';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = parseExerciseCatalog(
  readFileSync(resolve(here, '../catalog/exercises.csv'), 'utf8'),
).entries.map((e) => ({ ...e, id: e.key }));
const cases = JSON.parse(
  readFileSync(resolve(here, '../catalog/exercise-search.fixture.json'), 'utf8'),
) as { q: string; key: string }[];

describe('exercise search fixture (AC4)', () => {
  const results = cases.map((c) => ({ ...c, ids: searchExercises(catalog, c.q, 'es', 3) }));
  const first = results.filter((r) => r.ids[0] === r.key);
  const top3 = results.filter((r) => r.ids.includes(r.key));

  it('has at least 80 cases whose keys exist', () => {
    expect(cases.length).toBeGreaterThanOrEqual(80);
    const keys = new Set(catalog.map((e) => e.key));
    expect(cases.filter((c) => !keys.has(c.key))).toEqual([]);
  });

  it('finds the expected exercise first in ≥ 85 % and in the top 3 in ≥ 95 %', () => {
    const misses = results
      .filter((r) => r.ids[0] !== r.key)
      .map((r) => `${r.q} → ${r.ids.join(', ') || '∅'} (want ${r.key})`);
    // Ambiguous queries ("curl bíceps", "máquina de remo") may miss; the report lists them.
    if (misses.length) console.info(['Exercise search misses:', ...misses].join('\n'));
    expect(first.length / cases.length).toBeGreaterThanOrEqual(0.85);
    expect(top3.length / cases.length).toBeGreaterThanOrEqual(0.95);
  });
});

describe('searchExercises (AC3)', () => {
  it('ignores accents and case and matches words in any order', () => {
    expect(searchExercises(catalog, 'BANCA press', 'es', 1)).toEqual(['press-banca']);
    expect(searchExercises(catalog, 'jalón', 'es', 1)).toEqual(['jalon-pecho']);
  });

  it('tolerates one typo in words of 5 letters or more', () => {
    expect(searchExercises(catalog, 'sentadila', 'es', 1)).toEqual(['sentadilla']);
  });

  it('ranks the English name first in English', () => {
    expect(searchExercises(catalog, 'bench press', 'en', 1)).toEqual(['press-banca']);
    expect(searchExercises(catalog, 'sentadilla', 'en', 1)).toEqual(['sentadilla']);
  });

  it('puts a recent exercise first among equal matches', () => {
    const ids = searchExercises(catalog, 'curl', 'es', 30, new Set(['curl-zottman']));
    expect(ids[0]).toBe('curl-zottman');
  });
});
