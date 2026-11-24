/**
 * Workout sentence eval (spec 012 AC18, AC19), against the real model and the exercise catalog of the
 * dev database:
 *
 *   pnpm --filter @pt/api eval:workout-text
 *
 * It spends API money (about 0.0015 USD per sentence): ask before running it. It runs the same code as
 * the API (`createWorkoutDrafter`: refs, the reader, `workoutDraft`) for a user without exercises of
 * their own, on a fixed day (Wednesday 2026-11-25), so "el lunes" has one answer. Run it before the
 * feature ships and on every change of the prompt, the model or its settings, or the exercise catalog.
 * It prints the summary and writes every failure to `workout-text/reports/<date>.md`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiUnavailableError, createMessageFn, createWorkoutReader } from '@pt/ai';
import {
  ActivityTypeSchema,
  LocaleSchema,
  type Exercise,
  type SetValues,
  type WorkoutDraft,
  type WorkoutDraftActivity,
  type WorkoutDraftResponse,
} from '@pt/contracts';
import { addDays, setForTracking } from '@pt/core';
import { createDb } from '@pt/db';
import { z } from 'zod';
import { createExerciseCatalogCache } from '../src/services/training';
import { createWorkoutDrafter } from '../src/services/workout-draft';
import { createDrizzleStore } from '../src/store/drizzle-store';

/** A user with no exercises of their own: the eval measures the catalog alone. */
const EVAL_USER = '00000000-0000-4000-8000-000000000000';
/** A Wednesday: the cases count weekdays back from it. The screen is on the same day. */
const EVAL_TODAY = '2026-11-25';
const CONCURRENCY = 4;
/** The E5 exit criterion (BLUEPRINT §7). */
const GATE = 0.95;
const MIN_CASES = { es: 120, en: 15 } as const;
const PAST_DAYS = 6;

// ── The cases (`workout-text/cases.jsonl`, see the README) ────────────────────────────────────────

const num = z.number().nullable().optional();
const SetGroupSchema = z.strictObject({
  n: z.number().int().min(1).optional(),
  reps: num,
  kg: num,
  s: num,
  m: num,
});
const ExerciseSchema = z.strictObject({
  /** Accepted catalog keys, the reference first; empty: not in the catalog (left unresolved). */
  keys: z.array(z.string()),
  sets: z.array(SetGroupSchema),
});
const ActivitySchema = z.strictObject({
  type: ActivityTypeSchema,
  minutes: num,
  rpe: num,
  distance: z.boolean().optional(),
});
const ExpectSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.enum(['not_workout', 'unclear']) }),
  z.strictObject({
    status: z.literal('ok'),
    exercises: z.array(ExerciseSchema).optional(),
    minutes: num,
    rpe: num,
    daysAgo: z.number().int().min(0).nullable().optional(),
    startTime: z.string().nullable().optional(),
    pain: z.boolean().optional(),
    activity: ActivitySchema.nullable().optional(),
    extras: z.array(ActivitySchema).optional(),
  }),
]);
const CaseSchema = z.strictObject({
  id: z.string(),
  locale: LocaleSchema,
  kind: z.string(),
  text: z.string(),
  expect: ExpectSchema,
});
type Case = z.infer<typeof CaseSchema>;
type ExpectedExercise = z.infer<typeof ExerciseSchema>;
type ExpectedActivity = z.infer<typeof ActivitySchema>;

function readCases(path: string): Case[] {
  if (!existsSync(path)) throw new Error('No cases yet: add workout-text/cases.jsonl (see README)');
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, i) => {
      const parsed = CaseSchema.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`cases.jsonl line ${i + 1}: ${parsed.error.message}`);
      return parsed.data;
    });
}

// ── Grading ───────────────────────────────────────────────────────────────────────────────────────

/** One exercise of the draft in the order said: a catalog key, or null for an unresolved mention. */
interface SaidExercise {
  key: string | null;
  mention: string;
  sets: SetValues[];
}

/** The draft's exercises in the order said: unresolved mentions go back to their `position`. */
function inOrder(draft: WorkoutDraft): SaidExercise[] {
  const resolved = draft.exercises.map((e) => ({
    key: e.exercise.key ?? `custom:${e.exercise.nameEs}`,
    mention: e.mention,
    sets: e.sets.map((s) => s.values),
  }));
  const out: SaidExercise[] = [];
  let next = 0;
  for (const u of draft.unresolved) {
    while (next < u.position && next < resolved.length) out.push(resolved[next++]!);
    out.push({ key: null, mention: u.mention, sets: u.sets.map((s) => s.values) });
  }
  out.push(...resolved.slice(next));
  return out;
}

const expandSets = (expected: ExpectedExercise): SetValues[] =>
  expected.sets.flatMap((g) =>
    Array.from({ length: g.n ?? 1 }, () => ({
      reps: g.reps ?? null,
      weightKg: g.kg ?? null,
      durationS: g.s ?? null,
      distanceM: g.m ?? null,
    })),
  );

const close = (a: number | null, b: number | null, tolerance: number) =>
  a === null || b === null ? a === b : Math.abs(a - b) <= tolerance;

/** Reps and seconds exact, weight within 0.1 kg, distance within 1 m, null only when null (AC18). */
const sameSet = (a: SetValues, b: SetValues) =>
  a.reps === b.reps &&
  a.durationS === b.durationS &&
  close(a.weightKg, b.weightKg, 0.1) &&
  close(a.distanceM, b.distanceM, 1);

const accepts = (expected: ExpectedExercise, got: SaidExercise) =>
  expected.keys.length === 0
    ? got.key === null
    : got.key !== null && expected.keys.includes(got.key);

const setText = (v: SetValues) =>
  [
    v.reps !== null ? `${v.reps}r` : '',
    v.weightKg !== null ? `${v.weightKg}kg` : '',
    v.durationS !== null ? `${v.durationS}s` : '',
    v.distanceM !== null ? `${v.distanceM}m` : '',
  ]
    .filter(Boolean)
    .join(' ') || '∅';

const setsText = (sets: SetValues[]) => sets.map(setText).join(', ') || 'no sets';

const activityText = (a: ExpectedActivity | WorkoutDraftActivity | null | undefined) => {
  if (!a) return 'none';
  const type = 'type' in a ? a.type : a.activity;
  const minutes = 'type' in a ? (a.minutes ?? null) : a.minutes;
  const rpe = 'type' in a ? (a.rpe ?? null) : a.sessionRpe;
  const distance = 'type' in a ? (a.distance ?? false) : a.distanceDropped;
  return `${type} ${minutes ?? '–'} min, RPE ${rpe ?? '–'}${distance ? ', distance' : ''}`;
};

const sameActivity = (e: ExpectedActivity, g: WorkoutDraftActivity) =>
  e.type === g.activity &&
  (e.minutes ?? null) === g.minutes &&
  (e.rpe ?? null) === g.sessionRpe &&
  (e.distance ?? false) === g.distanceDropped;

/** Failure kinds of the report. A case may fail in several. */
type FailureKind =
  | 'call_failed'
  | 'draft_from_non_workout'
  | 'unreadable_reason'
  | 'no_draft'
  | 'exercise_match'
  | 'exercise_count'
  | 'set_values'
  | 'session'
  | 'day'
  | 'start_time'
  | 'activity'
  | 'extras'
  | 'pain';

interface Grade {
  failures: { kind: FailureKind; detail: string }[];
  expectedExercises: number;
  matchedExercises: number;
  expectedSets: number;
  rightSets: number;
}

function grade(
  c: Case,
  outcome: WorkoutDraftResponse | { status: 'failed'; reason: string },
): Grade {
  const g: Grade = {
    failures: [],
    expectedExercises: 0,
    matchedExercises: 0,
    expectedSets: 0,
    rightSets: 0,
  };
  const fail = (kind: FailureKind, detail: string) => g.failures.push({ kind, detail });
  const e = c.expect;

  if (e.status !== 'ok') {
    if (outcome.status === 'ok')
      fail('draft_from_non_workout', `expected ${e.status}, got a draft`);
    else if (outcome.status === 'failed') fail('call_failed', outcome.reason);
    else if (outcome.reason !== e.status)
      fail('unreadable_reason', `expected ${e.status}, got ${outcome.reason}`);
    return g;
  }

  const expected = e.exercises ?? [];
  g.expectedExercises = expected.length;
  g.expectedSets = expected.reduce((n, x) => n + expandSets(x).length, 0);
  if (outcome.status === 'failed') {
    fail('call_failed', outcome.reason);
    return g;
  }
  if (outcome.status === 'unreadable') {
    fail('no_draft', `got ${outcome.reason}`);
    return g;
  }
  const draft = outcome.draft;

  // Exercises: matched in order, each to one of its accepted keys (or unresolved when expected so);
  // what the draft holds besides them is extra.
  const got = inOrder(draft);
  let from = 0;
  const missed: ExpectedExercise[] = [];
  const used = new Set<number>();
  for (const want of expected) {
    const at = got.findIndex((x, i) => i >= from && accepts(want, x));
    if (at === -1) {
      missed.push(want);
      continue;
    }
    used.add(at);
    from = at + 1;
    g.matchedExercises++;
    const wantSets = expandSets(want);
    const gotSets = got[at]!.sets;
    const right = wantSets.filter((s, i) => gotSets[i] !== undefined && sameSet(s, gotSets[i]!));
    g.rightSets += right.length;
    if (right.length !== wantSets.length || gotSets.length !== wantSets.length) {
      fail(
        'set_values',
        `${want.keys[0] ?? 'unresolved'}: expected ${setsText(wantSets)}; got ${setsText(gotSets)}`,
      );
    }
  }
  const extra = got.filter((_, i) => !used.has(i));
  if (missed.length) {
    fail(
      'exercise_match',
      `missed ${missed.map((m) => m.keys[0] ?? 'unresolved').join(', ')}; draft has ${
        got.map((x) => x.key ?? `?"${x.mention}"`).join(', ') || 'none'
      }`,
    );
  }
  if (extra.length) {
    fail('exercise_count', `extra ${extra.map((x) => x.key ?? `?"${x.mention}"`).join(', ')}`);
  }

  // The session, the day, the time, the activity, pain.
  const isGym = expected.length > 0;
  if (isGym && ((e.minutes ?? null) !== draft.minutes || (e.rpe ?? null) !== draft.sessionRpe)) {
    fail(
      'session',
      `expected ${e.minutes ?? '–'} min, RPE ${e.rpe ?? '–'}; got ${draft.minutes ?? '–'} min, RPE ${draft.sessionRpe ?? '–'}`,
    );
  }
  const daysAgo = e.daysAgo ?? null;
  const fits = daysAgo !== null && daysAgo <= PAST_DAYS;
  const wantDate = fits ? addDays(EVAL_TODAY, -daysAgo) : EVAL_TODAY;
  const wantDropped = daysAgo !== null && !fits;
  if (draft.localDate !== wantDate || draft.dayDropped !== wantDropped) {
    fail(
      'day',
      `expected ${wantDate}${wantDropped ? ' (dropped)' : ''}; got ${draft.localDate}${draft.dayDropped ? ' (dropped)' : ''}`,
    );
  }
  if ((e.startTime ?? null) !== draft.startTime) {
    fail('start_time', `expected ${e.startTime ?? '–'}; got ${draft.startTime ?? '–'}`);
  }
  const wantActivity = e.activity ?? null;
  if (
    (wantActivity === null) !== (draft.activity === null) ||
    (wantActivity && draft.activity && !sameActivity(wantActivity, draft.activity))
  ) {
    fail('activity', `expected ${activityText(wantActivity)}; got ${activityText(draft.activity)}`);
  }
  const wantExtras = e.extras ?? [];
  if (
    wantExtras.length !== draft.extraActivities.length ||
    wantExtras.some((x, i) => !sameActivity(x, draft.extraActivities[i]!))
  ) {
    fail(
      'extras',
      `expected ${wantExtras.map(activityText).join('; ') || 'none'}; got ${
        draft.extraActivities.map(activityText).join('; ') || 'none'
      }`,
    );
  }
  if ((e.pain ?? false) !== draft.painMentioned) {
    fail('pain', `expected ${e.pain ?? false}; got ${draft.painMentioned}`);
  }
  return g;
}

// ── Run ───────────────────────────────────────────────────────────────────────────────────────────

const pct = (n: number, total: number) => `${((100 * n) / Math.max(total, 1)).toFixed(1)} %`;
const quantile = (values: number[], q: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};

/**
 * Mistakes of the case writer, found without calling the model: unknown or duplicated ids and keys,
 * accepted keys of different trackings, and expected values the tracking of the exercise drops.
 */
function checkCases(cases: readonly Case[], exercises: readonly Exercise[]): string[] {
  const byKey = new Map(exercises.flatMap((x) => (x.key ? [[x.key, x] as const] : [])));
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) problems.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    if (c.expect.status !== 'ok') continue;
    for (const want of c.expect.exercises ?? []) {
      const unknown = want.keys.filter((k) => !byKey.has(k));
      if (unknown.length) problems.push(`${c.id}: unknown keys ${unknown.join(', ')}`);
      const trackings = new Set(want.keys.flatMap((k) => byKey.get(k)?.tracking ?? []));
      if (trackings.size > 1) problems.push(`${c.id}: ${want.keys.join(', ')} mix trackings`);
      const [tracking] = trackings;
      if (!tracking) continue;
      for (const set of expandSets(want)) {
        const kept = setForTracking(set, tracking);
        if (!sameSet(set, kept)) {
          problems.push(`${c.id}: ${want.keys[0]} (${tracking}) cannot keep ${setText(set)}`);
          break;
        }
      }
    }
  }
  return problems;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set (see .env.example)');

  const here = resolve(dirname(fileURLToPath(import.meta.url)), 'workout-text');
  const cases = readCases(resolve(here, 'cases.jsonl'));
  const db = createDb(databaseUrl);
  const store = createDrizzleStore(db);
  const getCatalog = createExerciseCatalogCache(store, () => new Date());
  const catalog = await getCatalog();
  const problems = checkCases(cases, catalog.exercises);
  if (checkOnly || problems.length) {
    await db.$client.end();
    const kinds = new Map<string, number>();
    for (const c of cases) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
    console.log(
      `${cases.length} cases (es ${cases.filter((c) => c.locale === 'es').length}, en ${
        cases.filter((c) => c.locale === 'en').length
      }): ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}`,
    );
    for (const problem of problems) console.log(`  ✗ ${problem}`);
    if (problems.length) throw new Error(`${problems.length} problems in cases.jsonl`);
    console.log('The cases are consistent with the catalog.');
    return;
  }
  if (!apiKey) {
    await db.$client.end();
    throw new Error('ANTHROPIC_API_KEY is not set (see .env.example)');
  }

  const draftWorkout = createWorkoutDrafter(
    { store, readWorkout: createWorkoutReader(createMessageFn(apiKey)) },
    getCatalog,
  );
  const costs: number[] = [];
  const latencies: number[] = [];
  async function run(c: Case) {
    try {
      const { draft, usage } = await draftWorkout(EVAL_USER, {
        text: c.text,
        locale: c.locale,
        today: EVAL_TODAY,
        localDate: EVAL_TODAY,
      });
      costs.push(usage.costUsd);
      latencies.push(usage.latencyMs);
      return draft;
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
      costs.push(error.usage.costUsd);
      latencies.push(error.usage.latencyMs);
      return { status: 'failed' as const, reason: error.status };
    }
  }

  // The first call writes the cached prefix (instructions + catalog); the rest read it.
  const grades: Grade[] = new Array<Grade>(cases.length);
  grades[0] = grade(cases[0]!, await run(cases[0]!));
  let next = 1;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < cases.length) {
        const i = next++;
        grades[i] = grade(cases[i]!, await run(cases[i]!));
        process.stdout.write('.');
      }
    }),
  );
  process.stdout.write('\n');
  await db.$client.end();

  const total = (pick: (g: Grade) => number) => grades.reduce((n, g) => n + pick(g), 0);
  const correct = grades.filter((g) => g.failures.length === 0).length;
  const nonWorkout = cases.filter((c) => c.expect.status !== 'ok').length;
  const draftsFromNonWorkout = grades.filter((g) =>
    g.failures.some((f) => f.kind === 'draft_from_non_workout'),
  ).length;
  const byLocale = (locale: Case['locale']) => cases.filter((c) => c.locale === locale).length;
  const failuresByKind = new Map<FailureKind, number>();
  for (const g of grades)
    for (const kind of new Set(g.failures.map((f) => f.kind)))
      failuresByKind.set(kind, (failuresByKind.get(kind) ?? 0) + 1);
  const failedByCaseKind = new Map<string, [number, number]>();
  cases.forEach((c, i) => {
    const [bad, all] = failedByCaseKind.get(c.kind) ?? [0, 0];
    failedByCaseKind.set(c.kind, [bad + (grades[i]!.failures.length ? 1 : 0), all + 1]);
  });
  const cost = costs.reduce((a, b) => a + b, 0);
  const enough = byLocale('es') >= MIN_CASES.es && byLocale('en') >= MIN_CASES.en;
  const passed = enough && correct / cases.length >= GATE && draftsFromNonWorkout === 0;

  const summary = [
    `Sentences parsed correctly: ${correct} / ${cases.length} (${pct(correct, cases.length)}; gate ${GATE * 100} %)`,
    `  es ${byLocale('es')} (min ${MIN_CASES.es}), en ${byLocale('en')} (min ${MIN_CASES.en})`,
    `Sentences without a workout that gave a draft: ${draftsFromNonWorkout} / ${nonWorkout} (gate 0)`,
    `Exercise match rate: ${total((g) => g.matchedExercises)} / ${total((g) => g.expectedExercises)} (${pct(
      total((g) => g.matchedExercises),
      total((g) => g.expectedExercises),
    )})`,
    `Set value accuracy: ${total((g) => g.rightSets)} / ${total((g) => g.expectedSets)} (${pct(
      total((g) => g.rightSets),
      total((g) => g.expectedSets),
    )})`,
    `Failures by kind: ${[...failuresByKind].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`,
    `Cost: ${cost.toFixed(4)} USD in ${costs.length} calls (${(cost / Math.max(costs.length, 1)).toFixed(5)} each; cache reads counted at the input price, an upper bound)`,
    `Latency: median ${quantile(latencies, 0.5)} ms, p90 ${quantile(latencies, 0.9)} ms`,
  ];
  if (!enough) summary.push('The set is too small for AC18.');

  const report = [
    `# Workout sentence eval — ${new Date().toISOString().slice(0, 10)}`,
    '',
    passed ? '**PASS**' : '**FAIL**',
    '',
    ...summary.map((line) => `- ${line.trim()}`),
    '',
    '## Sentences failed by case kind',
    '',
    '| kind | failed | cases |',
    '| ---- | -----: | ----: |',
    ...[...failedByCaseKind]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, [bad, all]]) => `| ${kind} | ${bad} | ${all} |`),
    '',
    '## Failures',
    '',
    ...cases.flatMap((c, i) => {
      const failures = grades[i]!.failures;
      if (failures.length === 0) return [];
      return [
        `- **${c.id}** (${c.kind}) "${c.text}"`,
        ...failures.map((f) => `  - ${f.kind}: ${f.detail}`),
      ];
    }),
  ];
  mkdirSync(resolve(here, 'reports'), { recursive: true });
  const file = resolve(here, 'reports', `${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(file, report.join('\n'));

  console.log(`${summary.join('\n')}\nReport: ${file}\n${passed ? 'PASS' : 'FAIL'}`);
  if (!passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
