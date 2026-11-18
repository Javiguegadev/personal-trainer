/**
 * Imports the curated exercise catalog (spec 009 AC1, AC2):
 *
 *   pnpm --filter @pt/db import:exercises
 *
 * Downloads free-exercise-db's `exercises.json` (pinned to one commit) to `.cache/knowledge/` (outside
 * git) when it is missing, joins it with `catalog/exercises.csv`, upserts the knowledge source and the
 * catalog rows of `exercises`, and writes a report to `.cache/knowledge/exercise-import-report.md`.
 * Idempotent: rows are matched by their curated key, so ids (and the sets that point to them) are kept.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { createDb } from '../client';
import { exercises, knowledgeSources } from '../schema';
import {
  buildExerciseRows,
  formatExerciseReport,
  parseExerciseCatalog,
  type SourceExercise,
} from './exercises/build';
import { FREE_EXERCISE_DB } from './sources';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const cacheDir = resolve(root, '.cache/knowledge');

async function sourceRecords(): Promise<Map<string, SourceExercise>> {
  const path = resolve(cacheDir, FREE_EXERCISE_DB.id, 'exercises.json');
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    console.log(`Downloading ${FREE_EXERCISE_DB.dataUrl} → ${path}`);
    const response = await fetch(FREE_EXERCISE_DB.dataUrl);
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(data)) throw new Error('exercises.json is not an array');
  const records = new Map<string, SourceExercise>();
  for (const item of data as Record<string, unknown>[]) {
    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    if (typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    records.set(item.id, {
      id: item.id,
      name: item.name,
      category: typeof item.category === 'string' ? item.category : '',
      equipment: typeof item.equipment === 'string' ? item.equipment : null,
      primaryMuscles: strings(item.primaryMuscles),
      secondaryMuscles: strings(item.secondaryMuscles),
    });
  }
  return records;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set (see .env.example)');

  const catalog = parseExerciseCatalog(
    readFileSync(resolve(here, 'catalog/exercises.csv'), 'utf8'),
  );
  const report = buildExerciseRows(catalog.entries, await sourceRecords());

  const db = createDb(databaseUrl);
  try {
    await db.transaction(async (tx) => {
      const source = {
        id: FREE_EXERCISE_DB.id,
        name: FREE_EXERCISE_DB.name,
        url: FREE_EXERCISE_DB.url,
        license: FREE_EXERCISE_DB.license,
        version: FREE_EXERCISE_DB.version,
        attributionEs: FREE_EXERCISE_DB.attributionEs,
        attributionEn: FREE_EXERCISE_DB.attributionEn,
        importedAt: new Date(),
      };
      await tx
        .insert(knowledgeSources)
        .values(source)
        .onConflictDoUpdate({ target: knowledgeSources.id, set: source });
      for (const entry of report.rows) {
        const row = {
          key: entry.key,
          origin: 'catalog' as const,
          source: FREE_EXERCISE_DB.id,
          sourceId: entry.sourceId,
          nameEs: entry.nameEs,
          nameEn: entry.nameEn,
          synonymsEs: entry.synonymsEs,
          synonymsEn: entry.synonymsEn,
          tracking: entry.tracking,
          category: entry.category,
          primaryMuscles: entry.primaryMuscles,
          secondaryMuscles: entry.secondaryMuscles,
          equipment: entry.equipment,
          popularity: entry.popularity,
        };
        await tx
          .insert(exercises)
          .values(row)
          .onConflictDoUpdate({ target: exercises.key, set: { ...row, updatedAt: sql`now()` } });
      }
    });
  } finally {
    await db.$client.end();
  }

  const text = formatExerciseReport(report, catalog.errors);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(resolve(cacheDir, 'exercise-import-report.md'), text);
  console.log(text.split('\n').slice(0, 7).join('\n'));
  console.log(`Full report: ${resolve(cacheDir, 'exercise-import-report.md')}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
