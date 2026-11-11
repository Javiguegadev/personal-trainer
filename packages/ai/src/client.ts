import Anthropic from '@anthropic-ai/sdk';
import type { AiFeature, ModelId } from './config';

/** The one SDK call the features use. Injected so tests and evals can swap it. */
export type CreateMessage = (
  params: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message>;

export function createMessageFn(apiKey: string): CreateMessage {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000 });
  return (params) => client.messages.create(params);
}

export type AiCallStatus = 'ok' | 'refusal' | 'max_tokens' | 'invalid_output' | 'error';

/** What apps/api writes to `ai_usage` for every call (spec 001 AC12, BLUEPRINT §3 cost target). */
export interface AiUsage {
  feature: AiFeature;
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  status: AiCallStatus;
}

/** The model could not produce a usable answer. The API maps it to 503 `ai_unavailable`. */
export class AiUnavailableError extends Error {
  constructor(
    readonly status: Exclude<AiCallStatus, 'ok'>,
    readonly usage: AiUsage,
    message: string,
  ) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}
