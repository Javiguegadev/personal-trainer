/**
 * Onboarding eval (spec 001). Calls the real model: costs about $0.01 per full run on Haiku 5.5.
 *
 *   pnpm --filter @pt/ai eval:onboarding
 *
 * Pass bar: ≥ 95 % of cases fully correct and 100 % of expected safety flags raised.
 * Run it after any change to the onboarding prompt, tools, model or effort.
 */
import type { OnboardingDraft } from '@pt/contracts';
import { createMessageFn } from '../../src/client';
import { runOnboardingTurn } from '../../src/prompts/onboarding/run';
import { CASES, type OnboardingEvalCase } from './cases';

const TODAY = '2026-11-11';

function grade(c: OnboardingEvalCase, before: OnboardingDraft, after: OnboardingDraft): string[] {
  const problems: string[] = [];
  for (const [field, want] of Object.entries(c.expect ?? {})) {
    const got = after[field as keyof OnboardingDraft];
    const ok =
      typeof want === 'number'
        ? typeof got === 'number' && Math.abs(got - want) <= 0.6
        : got === want;
    if (!ok) problems.push(`${field}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  for (const [field, min] of Object.entries(c.minItems ?? {})) {
    const got = after[field as 'allergies'] ?? [];
    if (got.length < min)
      problems.push(`${field}: want ≥ ${min} items, got ${JSON.stringify(got)}`);
  }
  for (const field of c.nonEmpty ?? []) {
    if (!after[field]) problems.push(`${field}: want non-empty`);
  }
  for (const field of c.unchanged ?? []) {
    if (JSON.stringify(after[field]) !== JSON.stringify(before[field])) {
      problems.push(`${field}: must not change, got ${JSON.stringify(after[field])}`);
    }
  }
  return problems;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (root .env)');
  const createMessage = createMessageFn(apiKey);

  let passed = 0;
  let flagsExpected = 0;
  let flagsRaised = 0;
  let cost = 0;

  for (const c of CASES) {
    const draft = c.draft ?? {};
    try {
      const result = await runOnboardingTurn(createMessage, {
        messages: [{ role: 'user', content: c.message }],
        draft,
        locale: c.locale,
        today: TODAY,
      });
      cost += result.usage.costUsd;
      const problems = grade(c, draft, result.draft);
      for (const flag of c.flags ?? []) {
        flagsExpected++;
        if (result.draft.healthFlags?.includes(flag)) flagsRaised++;
        else problems.push(`flag ${flag} not raised`);
      }
      if (problems.length === 0) passed++;
      console.log(
        `${problems.length === 0 ? 'PASS' : 'FAIL'}  ${c.id}${problems.length ? `\n      ${problems.join('\n      ')}` : ''}`,
      );
      if (problems.length) console.log(`      reply: ${result.reply.slice(0, 160)}`);
    } catch (error) {
      console.log(`ERROR ${c.id}: ${(error as Error).message}`);
    }
  }

  const rate = passed / CASES.length;
  const flagRate = flagsExpected ? flagsRaised / flagsExpected : 1;
  console.log(
    `\n${passed}/${CASES.length} cases (${(rate * 100).toFixed(0)} %), flags ${flagsRaised}/${flagsExpected}, cost $${cost.toFixed(4)}`,
  );
  const ok = rate >= 0.95 && flagRate === 1;
  console.log(ok ? 'EVAL PASSED' : 'EVAL FAILED (bar: ≥ 95 % cases, 100 % flags)');
  process.exitCode = ok ? 0 : 1;
}

await main();
