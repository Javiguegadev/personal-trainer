/**
 * @pt/ai — Claude integration (Phase 8). Imported ONLY by apps/api (enforced by ESLint).
 *
 * Planned layout:
 *   src/client.ts        Anthropic SDK wrapper: model/effort per feature, refusal + max_tokens
 *                        handling, cost metering into ai_generations
 *   src/prompts/         one folder per feature (system prompt + Zod output schema)
 *   evals/               fixtures + graders; run in CI on any prompt/model change
 *
 * Non-negotiables: structured outputs only; AI picks catalog IDs + quantities,
 * @pt/core computes macros/volume and validates; never expose keys to clients.
 */
export {};
