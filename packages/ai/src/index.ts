/**
 * @pt/ai — Claude integration. Imported ONLY by apps/api (enforced by ESLint).
 *
 * Layout:
 *   src/config.ts        models, pricing and the settings of each feature; changing them requires an eval run
 *   src/client.ts        SDK wrapper (injectable `CreateMessage`), usage metering type, errors
 *   src/prompts/<name>/  one folder per feature: system prompt, tools, runner
 *   evals/               fixtures + graders; run on any prompt, model or knowledge-base change
 *
 * Features: `label_scan` (spec 006), which reads a nutrition label from a photo; `meal_text` and
 * `meal_photo` (spec 007), which turn a sentence or a plate photo into catalog foods with a tool loop; `daily_feedback` (spec 008), which words the notes of a day. The onboarding chat
 * was retired (ADR 004, spec 002); the questions assistant of stage E5b is the next one.
 *
 * Non-negotiables: grounded answers with citations; validated tool inputs; the AI picks catalog IDs +
 * quantities and @pt/core computes and validates; minimal personal data in prompts; never expose keys.
 */
export * from './client';
export * from './config';
export * from './loop';
export * from './prompts/feedback';
export * from './prompts/label';
export * from './prompts/meal';
