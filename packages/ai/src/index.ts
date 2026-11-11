/**
 * @pt/ai — Claude integration. Imported ONLY by apps/api (enforced by ESLint).
 *
 * Layout:
 *   src/config.ts        model + effort per feature; changing them requires an eval run
 *   src/client.ts        SDK wrapper (injectable `CreateMessage`), usage metering type, errors
 *   src/prompts/<name>/  one folder per feature: system prompt, tools, runner
 *   evals/               fixtures + graders; run on any prompt, model or knowledge-base change
 *
 * Non-negotiables: grounded answers with citations; validated tool inputs; the AI picks catalog IDs +
 * quantities and @pt/core computes and validates; minimal personal data in prompts; never expose keys.
 */
export * from './client';
export * from './config';
export { runOnboardingTurn, type OnboardingTurnResult } from './prompts/onboarding/run';
