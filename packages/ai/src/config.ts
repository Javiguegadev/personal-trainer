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

export const FEATURES = {
  onboarding: {
    model: MODELS.haiku,
    /** Chat turns are short; low effort keeps latency down. Thinking stays adaptive (Haiku 5.5 default). */
    effort: 'low',
    /** Includes adaptive thinking tokens. */
    maxTokens: 4000,
    /** Tool round-trips per user message before we give up. */
    maxToolRounds: 3,
  },
} as const;
export type AiFeature = keyof typeof FEATURES;

export function costUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const p = PRICING_USD_PER_MTOK[model];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
