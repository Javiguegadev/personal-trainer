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

/** No feature ships today (the onboarding chat was retired by ADR 004). Add each new one here. */
export const FEATURES = {} as const satisfies Record<string, FeatureConfig>;
/** The name stored in `ai_usage.feature`. */
export type AiFeature = string;

export function costUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const p = PRICING_USD_PER_MTOK[model];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
