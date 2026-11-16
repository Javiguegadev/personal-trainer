/**
 * Label reading eval (spec 006 AC20), against the real model:
 *
 *   pnpm --filter @pt/api eval:label-scan
 *
 * It spends API money (about 0.0005 USD per photo): ask before running it. Each line of
 * `label/cases.jsonl` is a photo of `label/photos/` with the values typed by hand from the package
 * (see `label/README.md`). Passes when at least 95 % of the readable photos give every required value
 * exactly and no unreadable photo gives values. Run it before the feature ships and on every change
 * of the prompt, the model or its effort.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiUnavailableError, createLabelReader, createMessageFn } from '@pt/ai';
import type { LabelImage, QuantityUnit } from '@pt/contracts';
import { labelDraft } from '@pt/core';

const THRESHOLD = 0.95;
const MIN_CASES = 30;
const MIN_UNREADABLE = 5;

type Expected =
  | { status: 'unreadable' }
  | {
      status: 'ok';
      unit: QuantityUnit;
      kcal: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      /** Checked only when the label prints it. */
      fiberG?: number;
    };

interface EvalCase {
  file: string;
  expected: Expected;
  note?: string;
}

const MEDIA_TYPES: Record<string, LabelImage['mediaType']> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Labels print one decimal at most; the conversion from kJ or from a serving may add more. */
const same = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.05;

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (see .env.example)');
  const here = resolve(dirname(fileURLToPath(import.meta.url)), 'label');
  const casesPath = resolve(here, 'cases.jsonl');
  const cases: EvalCase[] = existsSync(casesPath)
    ? readFileSync(casesPath, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as EvalCase)
    : [];
  if (cases.length === 0) {
    throw new Error('No cases yet: add photos and `label/cases.jsonl` (see label/README.md)');
  }

  const read = createLabelReader(createMessageFn(apiKey));
  const failures: string[] = [];
  let readable = 0;
  let readableOk = 0;
  let unreadable = 0;
  let unreadableWithValues = 0;
  let cost = 0;
  let calls = 0;

  for (const c of cases) {
    const mediaType = MEDIA_TYPES[extname(c.file).toLowerCase()];
    if (!mediaType) throw new Error(`${c.file}: use a .jpg, .png or .webp photo`);
    const data = readFileSync(resolve(here, 'photos', c.file)).toString('base64');
    let outcome: ReturnType<typeof labelDraft> | { status: 'failed'; reason: string };
    try {
      const { reading, usage } = await read({ mediaType, data });
      cost += usage.costUsd;
      calls += 1;
      outcome = labelDraft(reading);
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
      cost += error.usage.costUsd;
      calls += 1;
      outcome = { status: 'failed', reason: error.status };
    }

    if (c.expected.status === 'unreadable') {
      unreadable += 1;
      if (outcome.status === 'ok') {
        unreadableWithValues += 1;
        failures.push(`${c.file}: expected unreadable, got ${JSON.stringify(outcome.draft)}`);
      }
      continue;
    }
    readable += 1;
    if (outcome.status !== 'ok') {
      failures.push(`${c.file}: expected values, got ${JSON.stringify(outcome)}`);
      continue;
    }
    const { draft } = outcome;
    const e = c.expected;
    const wrong = [
      draft.unit === e.unit ? null : `unit ${draft.unit} ≠ ${e.unit}`,
      same(draft.kcal, e.kcal) ? null : `kcal ${draft.kcal} ≠ ${e.kcal}`,
      same(draft.proteinG, e.proteinG) ? null : `protein ${draft.proteinG} ≠ ${e.proteinG}`,
      same(draft.carbsG, e.carbsG) ? null : `carbs ${draft.carbsG} ≠ ${e.carbsG}`,
      same(draft.fatG, e.fatG) ? null : `fat ${draft.fatG} ≠ ${e.fatG}`,
      e.fiberG === undefined || same(draft.fiberG, e.fiberG)
        ? null
        : `fiber ${draft.fiberG} ≠ ${e.fiberG}`,
    ].filter((problem): problem is string => problem !== null);
    if (wrong.length === 0) readableOk += 1;
    else failures.push(`${c.file}: ${wrong.join(', ')}`);
  }

  const share = readable === 0 ? 0 : readableOk / readable;
  console.log(`Readable photos right: ${readableOk} / ${readable} (${(100 * share).toFixed(1)} %)`);
  console.log(`Unreadable photos that gave values: ${unreadableWithValues} / ${unreadable}`);
  console.log(`Cost: ${cost.toFixed(4)} USD in ${calls} calls (${(cost / calls).toFixed(5)} each)`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  if (cases.length < MIN_CASES || unreadable < MIN_UNREADABLE) {
    console.log(
      `The set is too small for AC20: ${cases.length} photos (${unreadable} unreadable); it asks for ${MIN_CASES} (${MIN_UNREADABLE}).`,
    );
  }
  const passed =
    share >= THRESHOLD &&
    unreadableWithValues === 0 &&
    cases.length >= MIN_CASES &&
    unreadable >= MIN_UNREADABLE;
  console.log(passed ? 'PASS' : 'FAIL');
  if (!passed) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
