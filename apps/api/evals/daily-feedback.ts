/**
 * Daily feedback eval (spec 008 AC19), against the real model:
 *
 *   pnpm --filter @pt/api eval:daily-feedback
 *
 * It spends API money (about 0.0003 USD per day, 60 days): ask before running it. The days come from
 * `daily-feedback/fixtures.ts`: every scenario for every profile (focuses, vegetarian, vegan, allergy,
 * a teen), today and past days, alternating es and en. Core builds the observations and candidates as
 * the API does, the model words them, and `validateFeedback` checks them.
 *
 * Passes when 100 % of the calls give a valid answer, at most 10 % of the notes fall back to the fixed
 * wording, and no suggestion is outside its observation's candidates. It writes every note to
 * `daily-feedback/reports/<date>.md` for a human read of 20 of them (tone, no judgement, no advice to
 * restrict). Run it before shipping and on every change of the prompt, the model or the observation
 * rules.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiUnavailableError, createFeedbackWriter, createMessageFn } from '@pt/ai';
import type { Locale } from '@pt/contracts';
import {
  addDays,
  dailyObservations,
  feedbackCandidates,
  minuteOfDay,
  validateFeedback,
} from '@pt/core';
import { promptCandidates } from '../src/services/feedback';
import { PROFILES, SCENARIOS, userFoods } from './daily-feedback/fixtures';

const MIN_CASES = 40;
const TEMPLATE_RATE_MAX = 0.1;
const TODAY = '2026-11-18';

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (see .env.example)');
  const write = createFeedbackWriter(createMessageFn(apiKey));

  const cases = PROFILES.flatMap((profile) =>
    SCENARIOS.map((scenario) => ({ profile, scenario })),
  ).map((c, i) => ({ ...c, locale: (i % 2 === 0 ? 'es' : 'en') as Locale }));
  if (cases.length < MIN_CASES) throw new Error(`Only ${cases.length} cases, need ${MIN_CASES}`);

  const lines: string[] = [`# Daily feedback eval, ${new Date().toISOString()}`, ''];
  let failedCalls = 0;
  let notes = 0;
  let templates = 0;
  let foreignSuggestions = 0;
  let cost = 0;
  const latencies: number[] = [];
  const kinds = new Map<string, number>();

  for (const { profile, scenario, locale } of cases) {
    const localDate = scenario.when.today ? TODAY : addDays(TODAY, -1);
    const time = scenario.when.today ? scenario.when.time : '09:00';
    const { state, observations } = dailyObservations(
      { localDate, items: scenario.meals(profile.targets), trainingDay: scenario.trainingDay },
      profile.targets,
      profile.breakdown,
      { safetyFlags: profile.flags },
      { today: TODAY, minuteOfDay: minuteOfDay(time) },
    );
    const candidates = feedbackCandidates(
      observations,
      userFoods(profile, locale),
      profile.targets.kcal,
    );
    const title = `${scenario.id} · ${profile.id} · ${locale} · ${state}`;
    lines.push(`## ${title}`, '');

    try {
      const { reading, usage } = await write({
        locale,
        state,
        trainingFocus: profile.focus,
        dietType: profile.dietType,
        allergies: profile.allergies,
        dislikes: profile.dislikes,
        observations: observations.map(({ kind, numbers }) => ({ kind, numbers })),
        candidates: promptCandidates(candidates, locale),
      });
      cost += usage.costUsd;
      latencies.push(usage.latencyMs);
      for (const note of reading.notes) {
        const own = new Set((candidates[note.observation] ?? []).map((c) => c.ref));
        foreignSuggestions += note.suggestionRefs.filter((ref) => !own.has(ref)).length;
      }
      for (const note of validateFeedback(reading, observations, candidates)) {
        notes++;
        kinds.set(note.observation.kind, (kinds.get(note.observation.kind) ?? 0) + 1);
        if (note.source === 'template') templates++;
        const raw = reading.notes.find((n) => n.observation === note.observation.kind);
        const shown = note.text ?? `[fixed wording] (model said: ${raw?.text ?? 'nothing'})`;
        const foods = note.suggestions.map((s) => s.food.name).join(', ') || '—';
        lines.push(`- **${note.observation.kind}**: ${shown}  \n  Suggestions: ${foods}`);
      }
    } catch (error) {
      failedCalls++;
      const status = error instanceof AiUnavailableError ? error.status : 'exception';
      if (error instanceof AiUnavailableError) cost += error.usage.costUsd;
      lines.push(`- FAILED (${status})`);
      notes += observations.length;
      templates += observations.length;
    }
    lines.push('');
    process.stdout.write('.');
  }

  latencies.sort((a, b) => a - b);
  const p = (q: number) =>
    latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))];
  const templateRate = notes === 0 ? 0 : templates / notes;
  const summary = [
    `Days: ${cases.length} · notes: ${notes} · failed calls: ${failedCalls}`,
    `Fixed wording: ${templates} (${(templateRate * 100).toFixed(1)} %, max ${TEMPLATE_RATE_MAX * 100} %)`,
    `Suggestions outside the candidates: ${foreignSuggestions}`,
    `Notes per kind: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}`,
    `Cost: ${cost.toFixed(5)} USD in total, ${(cost / cases.length).toFixed(6)} USD per call`,
    `Latency: p50 ${p(0.5) ?? 0} ms, p90 ${p(0.9) ?? 0} ms`,
  ];
  const passed = failedCalls === 0 && templateRate <= TEMPLATE_RATE_MAX && foreignSuggestions === 0;
  lines.splice(2, 0, ...summary, '', passed ? '**PASS**' : '**FAIL**', '');

  const dir = resolve(dirname(fileURLToPath(import.meta.url)), 'daily-feedback', 'reports');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(file, lines.join('\n'));

  console.log(`\n${summary.join('\n')}\nReport: ${file}\n${passed ? 'PASS' : 'FAIL'}`);
  if (!passed) process.exitCode = 1;
}

await main();
