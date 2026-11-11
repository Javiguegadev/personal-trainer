import type Anthropic from '@anthropic-ai/sdk';
import {
  FlagSafetyToolInputSchema,
  ProfileDraftToolInputSchema,
  type OnboardingChatRequest,
  type OnboardingDraft,
  type ReportedHealthFlag,
} from '@pt/contracts';
import { applyDraftToolInput, missingDraftFields } from '@pt/core';
import {
  AiUnavailableError,
  type AiCallStatus,
  type AiUsage,
  type CreateMessage,
} from '../../client';
import { FEATURES, costUsd } from '../../config';
import { ONBOARDING_SYSTEM_PROMPT } from './system';
import { FLAG_SAFETY, ONBOARDING_TOOLS, UPDATE_PROFILE_DRAFT } from './tools';

export interface OnboardingTurnResult {
  reply: string;
  draft: OnboardingDraft;
  softStop: boolean;
  usage: AiUsage;
}

const config = FEATURES.onboarding;

/** Per-request context, appended as a trailing system message so the stable prefix stays cacheable. */
function contextMessage(request: OnboardingChatRequest, draft: OnboardingDraft): string {
  return [
    `Context — language: ${request.locale}; today: ${request.today}.`,
    `Profile collected so far: ${JSON.stringify(draft)}`,
    `Required fields still missing: ${JSON.stringify(missingDraftFields(draft))}`,
  ].join('\n');
}

function addFlag(draft: OnboardingDraft, flag: ReportedHealthFlag): OnboardingDraft {
  const flags = new Set(draft.healthFlags ?? []);
  flags.add(flag);
  return { ...draft, healthFlags: [...flags] };
}

/**
 * One onboarding chat turn (spec 001 AC8–AC9, AC20, AC25). Stateless: the client sends the whole
 * conversation (text only) and the current draft. Only the chat text and the draft reach the model —
 * never the user's email, name or ID.
 */
export async function runOnboardingTurn(
  createMessage: CreateMessage,
  request: OnboardingChatRequest,
  now: () => number = Date.now,
): Promise<OnboardingTurnResult> {
  const started = now();
  let draft: OnboardingDraft = { ...request.draft };
  let inputTokens = 0;
  let outputTokens = 0;

  const usage = (status: AiCallStatus): AiUsage => ({
    feature: 'onboarding',
    model: config.model,
    inputTokens,
    outputTokens,
    costUsd: costUsd(config.model, inputTokens, outputTokens),
    latencyMs: now() - started,
    status,
  });

  // Append-only history: Haiku 5.5 binds thinking blocks to the exact prefix they were produced with, so
  // nothing already sent may change between tool rounds. The context message is sent once; tool results
  // carry what changed afterwards (stillMissing).
  const conversation: Anthropic.MessageParam[] = [
    ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'system', content: contextMessage(request, draft) },
  ];

  for (let round = 0; round <= config.maxToolRounds; round++) {
    const response = await createMessage({
      model: config.model,
      max_tokens: config.maxTokens,
      output_config: { effort: config.effort },
      system: [
        { type: 'text', text: ONBOARDING_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      tools: ONBOARDING_TOOLS,
      messages: conversation,
    });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason === 'refusal') {
      throw new AiUnavailableError(
        'refusal',
        usage('refusal'),
        'The model declined the onboarding turn',
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiUnavailableError(
        'max_tokens',
        usage('max_tokens'),
        'The onboarding reply was cut off',
      );
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const reply = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (!reply) {
        throw new AiUnavailableError(
          'invalid_output',
          usage('invalid_output'),
          'Empty onboarding reply',
        );
      }
      return {
        reply,
        draft,
        softStop: draft.healthFlags?.includes('ed_soft_stop') ?? false,
        usage: usage('ok'),
      };
    }

    const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tool) => {
      if (tool.name === UPDATE_PROFILE_DRAFT) {
        const parsed = ProfileDraftToolInputSchema.safeParse(tool.input);
        if (!parsed.success) {
          return {
            type: 'tool_result',
            tool_use_id: tool.id,
            is_error: true,
            content: `Invalid input: ${parsed.error.message}`,
          };
        }
        const applied = applyDraftToolInput(draft, parsed.data, request.today);
        draft = applied.draft;
        return {
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify({
            saved: true,
            notPlausible: applied.invalid,
            stillMissing: missingDraftFields(draft),
          }),
        };
      }
      if (tool.name === FLAG_SAFETY) {
        const parsed = FlagSafetyToolInputSchema.safeParse(tool.input);
        if (!parsed.success) {
          return {
            type: 'tool_result',
            tool_use_id: tool.id,
            is_error: true,
            content: `Invalid input: ${parsed.error.message}`,
          };
        }
        draft = addFlag(draft, parsed.data.flag);
        return {
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify({ recorded: true }),
        };
      }
      return {
        type: 'tool_result',
        tool_use_id: tool.id,
        is_error: true,
        content: `Unknown tool ${tool.name}`,
      };
    });

    conversation.push(
      { role: 'assistant', content: response.content },
      { role: 'user', content: results },
    );
  }

  throw new AiUnavailableError('invalid_output', usage('invalid_output'), 'Too many tool rounds');
}
