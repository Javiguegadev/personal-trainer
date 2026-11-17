/**
 * Meal draft evals (spec 007 AC13–AC15), against the real model and the catalog of the dev database:
 *
 *   pnpm --filter @pt/api eval:meal-text     # sentences: meal-text/cases.jsonl
 *   pnpm --filter @pt/api eval:meal-photo    # weighed plates: meal-photo/cases.jsonl + photos/
 *
 * Both spend API money (about 0.0005 USD per sentence, a little more per photo): ask before running
 * them. They run the same code as the API (`createMealDrafter`: search tool, refs, `mealDraft`) for a
 * user without foods of their own. Run them before the feature ships and on every change of the
 * prompt, the tool, the model or its effort, or the search.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiUnavailableError, createMealReader, createMessageFn, type MealInput } from '@pt/ai';
import type { DraftItem, ImageUpload, MealDraftResponse } from '@pt/contracts';
import { draftTotals } from '@pt/core';
import { createDb } from '@pt/db';
import type { Deps } from '../src/deps';
import { createCatalogCache } from '../src/services/foods';
import { createMealDrafter } from '../src/services/meal-draft';
import { createDrizzleStore } from '../src/store/drizzle-store';

/** A user with no foods of their own and no history: the eval measures the catalog alone. */
const EVAL_USER = '00000000-0000-4000-8000-000000000000';

interface ExpectedFood {
  /** Catalog keys that count as a right match, the reference first. Empty: not in the catalog. */
  keys: string[];
  /** Reference grams (ml count as grams). */
  grams: number;
}

interface TextCase {
  text: string;
  kind: string;
  /** Every quantity is said in grams or as a count of a catalog serving (the ±5 % check). */
  explicit: boolean;
  expected: ExpectedFood[];
}

interface PhotoCase {
  file: string;
  /** Empty for a photo with no food. */
  expected: ExpectedFood[];
  note?: string;
}

const MEDIA_TYPES: Record<string, ImageUpload['mediaType']> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const pct = (n: number, total: number) => `${((100 * n) / Math.max(total, 1)).toFixed(1)} %`;
const quantile = (values: number[], q: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

/** Pairs each expected food with one draft item of an accepted key; the rest are extra items. */
function match(expected: ExpectedFood[], items: DraftItem[]) {
  const free = [...items];
  const matched: { expected: ExpectedFood; item: DraftItem }[] = [];
  const missed: ExpectedFood[] = [];
  for (const e of expected.filter((f) => f.keys.length > 0)) {
    const i = free.findIndex((item) => e.keys.includes(item.food.key));
    if (i === -1) missed.push(e);
    else matched.push({ expected: e, item: free.splice(i, 1)[0] as DraftItem });
  }
  return { matched, missed, extra: free };
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'text' && mode !== 'photo') throw new Error('Usage: meal-draft.ts text|photo');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (see .env.example)');
  if (!databaseUrl) throw new Error('DATABASE_URL is not set (see .env.example)');

  const here = resolve(dirname(fileURLToPath(import.meta.url)), `meal-${mode}`);
  const db = createDb(databaseUrl);
  const store = createDrizzleStore(db);
  const catalog = await store.listCatalog();
  const byKey = new Map(catalog.map((f) => [f.key, f]));
  const now = () => new Date();
  const deps: Pick<Deps, 'store' | 'readMeal' | 'now'> = {
    store,
    readMeal: createMealReader(createMessageFn(apiKey)),
    now,
  };
  const draftMeal = createMealDrafter(deps, createCatalogCache(store, now));

  /** Reference kcal of the expected foods (first key, reference grams). */
  const referenceKcal = (expected: ExpectedFood[]) =>
    expected.reduce((sum, e) => {
      const food = e.keys[0] ? byKey.get(e.keys[0]) : undefined;
      return sum + (food ? (food.per100g.kcal * e.grams) / 100 : 0);
    }, 0);

  const costs: number[] = [];
  const latencies: number[] = [];
  async function run(
    input: MealInput,
  ): Promise<MealDraftResponse | { status: 'failed'; reason: string }> {
    try {
      const { draft, usage } = await draftMeal(EVAL_USER, input, 'es');
      costs.push(usage.costUsd);
      latencies.push(usage.latencyMs);
      return draft;
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
      costs.push(error.usage.costUsd);
      latencies.push(error.usage.latencyMs);
      return { status: 'failed', reason: error.status };
    }
  }

  const failures: string[] = [];
  let passed: boolean;

  if (mode === 'text') {
    const cases = readJsonl<TextCase>(resolve(here, 'cases.jsonl'));
    if (cases.length === 0) throw new Error('No cases yet: add meal-text/cases.jsonl (see README)');
    const unknown = cases
      .flatMap((c) => c.expected.flatMap((e) => e.keys))
      .filter((k) => !byKey.has(k));
    if (unknown.length)
      throw new Error(`Unknown keys in the eval: ${[...new Set(unknown)].join(', ')}`);

    let expectedFoods = 0;
    let matchedFoods = 0;
    let draftItems = 0;
    let extraItems = 0;
    let explicitCases = 0;
    let explicitOk = 0;
    let notFoodWithItems = 0;
    for (const c of cases) {
      const outcome = await run({ kind: 'text', text: c.text });
      const items = outcome.status === 'ok' ? outcome.items : [];
      if (c.kind === 'not_food') {
        if (items.length > 0) {
          notFoodWithItems++;
          failures.push(
            `"${c.text}": no food expected, got ${items.map((i) => i.food.key).join(', ')}`,
          );
        }
        continue;
      }
      if (outcome.status === 'failed') failures.push(`"${c.text}": failed (${outcome.reason})`);
      const { matched, missed, extra } = match(c.expected, items);
      expectedFoods += c.expected.filter((e) => e.keys.length > 0).length;
      matchedFoods += matched.length;
      draftItems += items.length;
      extraItems += extra.length;
      if (missed.length || extra.length) {
        failures.push(
          `"${c.text}": missed ${missed.map((m) => m.keys[0]).join(', ') || '-'}; extra ${extra.map((e) => e.food.key).join(', ') || '-'}`,
        );
      }
      if (c.explicit) {
        explicitCases++;
        const reference = referenceKcal(c.expected);
        const got = draftTotals(items).kcal;
        if (reference > 0 && Math.abs(got - reference) / reference <= 0.05) explicitOk++;
        else failures.push(`"${c.text}": ${got.toFixed(0)} kcal ≠ ${reference.toFixed(0)} (±5 %)`);
      }
    }
    console.log(
      `Foods matched: ${matchedFoods} / ${expectedFoods} (${pct(matchedFoods, expectedFoods)}; gate 90 %)`,
    );
    console.log(
      `Extra items: ${extraItems} / ${draftItems} (${pct(extraItems, draftItems)}; gate ≤ 5 %)`,
    );
    console.log(
      `Explicit sentences within ±5 % kcal: ${explicitOk} / ${explicitCases} (${pct(explicitOk, explicitCases)}; gate 90 %)`,
    );
    console.log(`Sentences without food that gave items: ${notFoodWithItems}`);
    passed =
      cases.length >= 120 &&
      matchedFoods / Math.max(expectedFoods, 1) >= 0.9 &&
      extraItems / Math.max(draftItems, 1) <= 0.05 &&
      explicitOk / Math.max(explicitCases, 1) >= 0.9 &&
      notFoodWithItems === 0;
    if (cases.length < 120)
      console.log(`The set is too small for AC13: ${cases.length} sentences (120).`);
  } else {
    const cases = readJsonl<PhotoCase>(resolve(here, 'cases.jsonl'));
    if (cases.length === 0)
      throw new Error('No cases yet: add photos and meal-photo/cases.jsonl (see README)');
    let plates = 0;
    let bigFoods = 0;
    let bigFoodsFound = 0;
    let platesWithin = 0;
    const errors: number[] = [];
    let nonFood = 0;
    let nonFoodWithItems = 0;
    for (const c of cases) {
      const mediaType = MEDIA_TYPES[extname(c.file).toLowerCase()];
      if (!mediaType) throw new Error(`${c.file}: use a .jpg, .png or .webp photo`);
      const data = readFileSync(resolve(here, 'photos', c.file)).toString('base64');
      const outcome = await run({ kind: 'photo', image: { mediaType, data } });
      const items = outcome.status === 'ok' ? outcome.items : [];
      if (c.expected.length === 0) {
        nonFood++;
        if (items.length > 0) {
          nonFoodWithItems++;
          failures.push(
            `${c.file}: no food expected, got ${items.map((i) => i.food.key).join(', ')}`,
          );
        }
        continue;
      }
      plates++;
      const plateGrams = c.expected.reduce((sum, e) => sum + e.grams, 0);
      const { matched, missed } = match(c.expected, items);
      const big = (e: ExpectedFood) => e.grams >= 0.1 * plateGrams && e.keys.length > 0;
      bigFoods += c.expected.filter(big).length;
      bigFoodsFound += matched.filter((m) => big(m.expected)).length;
      const reference = referenceKcal(c.expected);
      const got = draftTotals(items).kcal;
      const error = reference > 0 ? Math.abs(got - reference) / reference : 1;
      errors.push(error);
      if (error <= 0.25) platesWithin++;
      if (missed.some(big) || error > 0.25) {
        failures.push(
          `${c.file}: ${got.toFixed(0)} kcal vs ${reference.toFixed(0)}; missed ${
            missed
              .filter(big)
              .map((m) => m.keys[0])
              .join(', ') || '-'
          }`,
        );
      }
    }
    const median = quantile(errors, 0.5);
    console.log(
      `Foods of ≥ 10 % of the plate found: ${bigFoodsFound} / ${bigFoods} (${pct(bigFoodsFound, bigFoods)}; gate 80 %)`,
    );
    console.log(
      `Plates within ±25 % kcal: ${platesWithin} / ${plates} (${pct(platesWithin, plates)}; gate 70 %)`,
    );
    console.log(`Median kcal error: ${(100 * median).toFixed(1)} % (gate ≤ 20 %)`);
    console.log(`Photos without food that gave items: ${nonFoodWithItems} / ${nonFood}`);
    passed =
      plates >= 30 &&
      nonFood >= 5 &&
      bigFoodsFound / Math.max(bigFoods, 1) >= 0.8 &&
      platesWithin / Math.max(plates, 1) >= 0.7 &&
      median <= 0.2 &&
      nonFoodWithItems === 0;
    if (plates < 30 || nonFood < 5) {
      console.log(
        `The set is too small for AC14: ${plates} plates and ${nonFood} photos without food (30 and 5).`,
      );
    }
  }

  await db.$client.end();
  const cost = costs.reduce((a, b) => a + b, 0);
  console.log(
    `Cost: ${cost.toFixed(4)} USD in ${costs.length} calls (${(cost / Math.max(costs.length, 1)).toFixed(5)} each)`,
  );
  console.log(`Latency: median ${quantile(latencies, 0.5)} ms, p90 ${quantile(latencies, 0.9)} ms`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  console.log(passed ? 'PASS' : 'FAIL');
  if (!passed) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
