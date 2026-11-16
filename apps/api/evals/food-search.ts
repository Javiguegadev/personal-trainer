/**
 * Food search eval (spec 005 AC5), against the catalog of the dev database:
 *
 *   pnpm --filter @pt/api eval:food-search
 *
 * Each case of `food-search.jsonl` is a query as users type it with the keys that would be a right
 * answer. Passes when an expected food is first in at least 75 % of the cases and in the top 3 in at
 * least 90 % (provisional thresholds). Run it on every change to the catalog or to the search.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOOD_LOG_LIMITS } from '@pt/contracts';
import { buildFoodSearchIndex, searchFoods } from '@pt/core';
import { createDb } from '@pt/db';
import { createDrizzleStore } from '../src/store/drizzle-store';

const THRESHOLDS = { top1: 0.75, top3: 0.9 };

interface EvalCase {
  query: string;
  expected: string[];
  kind: string;
}

const pct = (n: number, total: number) => `${((100 * n) / Math.max(total, 1)).toFixed(1)} %`;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set (see .env.example)');
  const here = dirname(fileURLToPath(import.meta.url));
  const cases: EvalCase[] = readFileSync(resolve(here, 'food-search.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as EvalCase);

  const db = createDb(databaseUrl);
  const catalog = await createDrizzleStore(db).listCatalog();
  await db.$client.end();
  const keyOf = new Map(catalog.map((f) => [f.id, f.key]));
  const nameOf = new Map(catalog.map((f) => [f.key, f.nameEs]));
  const index = buildFoodSearchIndex(catalog);

  const unknown = cases.flatMap((c) => c.expected.filter((k) => !nameOf.has(k)));
  if (unknown.length) throw new Error(`Unknown keys in the eval: ${unknown.join(', ')}`);

  const byKind = new Map<string, { total: number; top1: number; top3: number }>();
  const failures: string[] = [];
  let top1 = 0;
  let top3 = 0;
  for (const c of cases) {
    const keys = searchFoods(index, c.query, 'es', FOOD_LOG_LIMITS.searchResultsMax).map(
      (id) => keyOf.get(id) ?? id,
    );
    const rank = keys.findIndex((k) => c.expected.includes(k));
    const stats = byKind.get(c.kind) ?? { total: 0, top1: 0, top3: 0 };
    stats.total++;
    if (rank === 0) {
      top1++;
      stats.top1++;
    }
    if (rank >= 0 && rank < 3) {
      top3++;
      stats.top3++;
    } else {
      const got = keys
        .slice(0, 3)
        .map((k) => nameOf.get(k))
        .join(' | ');
      failures.push(
        `- [${c.kind}] "${c.query}" → expected ${c.expected.map((k) => nameOf.get(k)).join(' / ')}; got ${got || 'nothing'}`,
      );
    }
    byKind.set(c.kind, stats);
  }

  console.log(`Food search eval: ${cases.length} cases, ${catalog.length} foods`);
  console.log(`  first: ${pct(top1, cases.length)} (≥ ${THRESHOLDS.top1 * 100} %)`);
  console.log(`  top 3: ${pct(top3, cases.length)} (≥ ${THRESHOLDS.top3 * 100} %)`);
  for (const [kind, s] of [...byKind].sort()) {
    console.log(
      `  ${kind.padEnd(11)} ${String(s.total).padStart(3)}  first ${pct(s.top1, s.total)}  top 3 ${pct(s.top3, s.total)}`,
    );
  }
  if (failures.length)
    console.log(`\nNot in the top 3 (${failures.length}):\n${failures.join('\n')}`);
  const passed = top1 / cases.length >= THRESHOLDS.top1 && top3 / cases.length >= THRESHOLDS.top3;
  console.log(passed ? '\nPASS' : '\nFAIL');
  process.exit(passed ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
