/**
 * @pt/ai — Claude integration. Imported ONLY by apps/api (enforced by ESLint).
 *
 * Planned layout:
 *   src/config.ts        model + effort per feature (Haiku 5.5 for fast/high-volume, Opus 5.5 for
 *                        planning/coaching); changing them requires an eval run
 *   src/client.ts        Anthropic SDK wrapper: refusal + max_tokens handling, usage metering (ai_usage)
 *   src/tools/           knowledge-base tools (search_foods, get_food, search_exercises, get_guideline,
 *                        get_user_stats) backed by Postgres
 *   src/prompts/         one folder per feature (system prompt + Zod output schema from @pt/contracts)
 *   evals/               fixtures + graders; run on any prompt, model or knowledge-base change
 *
 * Non-negotiables: grounded answers with citations; structured outputs only; the AI picks catalog IDs +
 * quantities and @pt/core computes and validates; minimal personal data in prompts; never expose keys.
 */
export {};
