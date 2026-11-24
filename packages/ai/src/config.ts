/**
 * Model and effort per AI feature (CLAUDE.md: Haiku 5.5 for fast/high-volume, Opus 5.5 for planning and
 * coaching). Changing a feature's model or effort requires an eval run.
 */
export const MODELS = {
  haiku: 'claude-haiku-5-5',
  opus: 'claude-opus-5-5',
} as const;
export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/** USD per million tokens (prompts ≤ 100K tokens for Haiku 5.5). Used for `ai_usage.cost_usd`. */
export const PRICING_USD_PER_MTOK: Record<ModelId, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

/** Settings of one AI feature. */
export interface FeatureConfig {
  model: ModelId;
  effort: 'low' | 'medium' | 'high';
  /** Includes adaptive thinking tokens. */
  maxTokens: number;
  /** Tool round-trips per user message before we give up. */
  maxToolRounds: number;
}

/** Add each new feature here. */
export const FEATURES = {
  /**
   * Reads a nutrition label from a photo (spec 006): one call, no tools. Low effort: it is a
   * transcription, and thinking counts towards `maxTokens`. Provisional until the label eval runs.
   */
  label_scan: { model: MODELS.haiku, effort: 'low', maxTokens: 2048, maxToolRounds: 0 },
  /**
   * A meal from a sentence or a plate photo (spec 007): the model searches our catalog with
   * `search_foods` (two rounds at most) and returns catalog refs with portions. Low effort: matching
   * names and reading quantities. Provisional until the meal evals run.
   */
  meal_text: { model: MODELS.haiku, effort: 'low', maxTokens: 4096, maxToolRounds: 2 },
  meal_photo: { model: MODELS.haiku, effort: 'low', maxTokens: 4096, maxToolRounds: 2 },
  /**
   * Words the daily feedback (spec 008): one call, no tools. Core found the observations and computed
   * every number; the model writes 1–3 short notes and picks foods among core's candidates. Low effort:
   * short wording. Provisional until the feedback eval runs.
   */
  daily_feedback: { model: MODELS.haiku, effort: 'low', maxTokens: 1024, maxToolRounds: 0 },
  /**
   * A workout from a sentence (spec 012): one call, no tools. The whole exercise catalog is in the
   * cached system prompt, so the model picks refs and reads the numbers said; core checks them. Low
   * effort: matching names and reading notations. The workout eval passed with these settings on
   * 2026-11-24 (174 of 178 sentences, `apps/api/evals/workout-text/`).
   */
  workout_text: { model: MODELS.haiku, effort: 'low', maxTokens: 4096, maxToolRounds: 0 },
} as const satisfies Record<string, FeatureConfig>;
/** The name stored in `ai_usage.feature`. */
export type AiFeature = keyof typeof FEATURES;

export function costUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const p = PRICING_USD_PER_MTOK[model];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
