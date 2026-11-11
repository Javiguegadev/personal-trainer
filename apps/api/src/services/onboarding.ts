import { AiUnavailableError, FEATURES } from '@pt/ai';
import {
  ONBOARDING_LIMITS,
  type OnboardingChatRequest,
  type OnboardingChatResponse,
} from '@pt/contracts';
import { missingDraftFields } from '@pt/core';
import type { Deps } from '../deps';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ChatOutcome =
  | { kind: 'ok'; response: OnboardingChatResponse }
  | { kind: 'rate_limited' }
  | { kind: 'ai_unavailable' };

/**
 * One onboarding chat turn (AC8, AC12, AC20, AC25). The transcript is never stored; every model call is
 * metered in `ai_usage`, which is also what the daily cap counts.
 */
export async function onboardingChat(
  deps: Deps,
  userId: string,
  request: OnboardingChatRequest,
): Promise<ChatOutcome> {
  const started = deps.now();
  const used = await deps.store.countAiCalls(
    userId,
    'onboarding',
    new Date(started.getTime() - DAY_MS),
  );
  if (used >= ONBOARDING_LIMITS.messagesPerDay) return { kind: 'rate_limited' };
  if (!deps.onboardingAi) return { kind: 'ai_unavailable' };

  try {
    const result = await deps.onboardingAi(request);
    await deps.store.recordAiUsage(userId, result.usage, deps.now());
    return {
      kind: 'ok',
      response: {
        reply: result.reply,
        draft: result.draft,
        missing: missingDraftFields(result.draft),
        softStop: result.softStop,
      },
    };
  } catch (error) {
    const usage =
      error instanceof AiUnavailableError
        ? error.usage
        : {
            feature: 'onboarding' as const,
            model: FEATURES.onboarding.model,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            latencyMs: deps.now().getTime() - started.getTime(),
            status: 'error' as const,
          };
    if (!(error instanceof AiUnavailableError)) console.error('onboarding AI call failed', error);
    await deps.store.recordAiUsage(userId, usage, deps.now());
    return { kind: 'ai_unavailable' };
  }
}
