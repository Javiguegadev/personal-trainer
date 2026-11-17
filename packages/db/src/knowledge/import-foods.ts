/**
 * Imports the curated food catalog (spec 005 AC1–AC3):
 *
 *   pnpm --filter @pt/db import:foods
 *
 * Downloads the CIQUAL XML files to `.cache/knowledge/` (outside git) when they are missing, joins them
 * with `catalog/foods.csv`, upserts `knowledge_sources`, `foods` and `food_servings`, and writes a report
 * to `.cache/knowledge/import-report.md`. Idempotent: running it again updates rows, never duplicates
 * them, and keeps the ids of existing servings (logged items point to them).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, gt, sql } from 'drizzle-orm';
import { createDb } from '../client';
import { foodServings, foods, knowledgeSources } from '../schema';
import { buildCatalogRows, formatReport } from './build';
import { parseCatalog } from './catalog/parse';
import { parseCiqualComposition, toPer100g } from './ciqual/parse';
import { CIQUAL_2025, KNOWLEDGE_SOURCES } from './sources';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const cacheDir = resolve(root, '.cache/knowledge');

async function cached(dir: string, name: string, fileId: string): Promise<string> {
  const path = resolve(cacheDir, dir, name);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const url = `https://entrepot.recherche.data.gouv.fr/api/access/datafile/${fileId}`;
    console.log(`Downloading ${url} → ${path}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  return readFileSync(path, 'utf8');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set (see .env.example)');

  const catalog = parseCatalog(readFileSync(resolve(here, 'catalog/foods.csv'), 'utf8'));
  const ciqualIds = new Set(
    catalog.entries.filter((e) => e.source === CIQUAL_2025.id).map((e) => e.sourceId),
  );
  await cached(CIQUAL_2025.id, 'alim.xml', CIQUAL_2025.files.alim);
  const composition = parseCiqualComposition(
    await cached(CIQUAL_2025.id, 'compo.xml', CIQUAL_2025.files.compo),
    ciqualIds,
  );
  const report = buildCatalogRows(catalog.entries, (source, sourceId) => {
    if (source !== CIQUAL_2025.id) return null;
    const values = composition.get(sourceId);
    return values ? toPer100g(values) : null;
  });

  const db = createDb(databaseUrl);
  try {
    await db.transaction(async (tx) => {
      for (const source of KNOWLEDGE_SOURCES) {
        const row = {
          id: source.id,
          name: source.name,
          url: source.url,
          license: source.license,
          version: source.version,
          attributionEs: source.attributionEs,
          attributionEn: source.attributionEn,
          importedAt: new Date(),
        };
        await tx
          .insert(knowledgeSources)
          .values(row)
          .onConflictDoUpdate({ target: knowledgeSources.id, set: row });
      }
      for (const { entry, values } of report.rows) {
        const row = {
          key: entry.key,
          source: entry.source,
          sourceId: entry.sourceId,
          nameEs: entry.nameEs,
          nameEn: entry.nameEn,
          synonymsEs: entry.synonymsEs,
          popularity: entry.popularity,
          kcal100g: values.kcal,
          proteinG100g: values.proteinG,
          carbsG100g: values.carbsG,
          fatG100g: values.fatG,
          fiberG100g: values.fiberG,
        };
        const [food] = await tx
          .insert(foods)
          .values(row)
          .onConflictDoUpdate({ target: foods.key, set: { ...row, updatedAt: sql`now()` } })
          .returning({ id: foods.id });
        const foodId = food!.id;
        const existing = await tx
          .select({ id: foodServings.id, sort: foodServings.sort })
          .from(foodServings)
          .where(eq(foodServings.foodId, foodId));
        for (const [sort, serving] of entry.servings.entries()) {
          const values = {
            labelEs: serving.labelEs,
            labelEn: serving.labelEn,
            grams: serving.grams,
          };
          const current = existing.find((s) => s.sort === sort);
          if (current) {
            await tx.update(foodServings).set(values).where(eq(foodServings.id, current.id));
          } else {
            await tx.insert(foodServings).values({ ...values, foodId, sort });
          }
        }
        await tx
          .delete(foodServings)
          .where(
            and(eq(foodServings.foodId, foodId), gt(foodServings.sort, entry.servings.length - 1)),
          );
      }
    });
  } finally {
    await db.$client.end();
  }

  const text = formatReport(report, catalog.errors);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(resolve(cacheDir, 'import-report.md'), text);
  console.log(text.split('\n').slice(0, 8).join('\n'));
  console.log(`Full report: ${resolve(cacheDir, 'import-report.md')}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
