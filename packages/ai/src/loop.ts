import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { AiUnavailableError, type AiCallStatus, type AiUsage, type CreateMessage } from './client';
import { FEATURES, costUsd, type AiFeature } from './config';

/** Runs one tool call and returns the text of its result. A thrown error becomes an error result. */
export type ToolHandler = (name: string, input: unknown) => Promise<string>;

export interface StructuredToolLoop<T> {
  feature: AiFeature;
  /**
   * Stable: the cached prefix with the tools. A string is cached as one block; blocks are sent as
   * given, so the caller places the breakpoints (spec 012: the instructions plus the catalog).
   */
  system: string | Anthropic.TextBlockParam[];
  /** Empty for one call without tools (`maxToolRounds` 0). */
  tools: Anthropic.Tool[];
  /** The first user turn: the input of this request. */
  content: Anthropic.ContentBlockParam[];
  /** The final answer, as a structured output. */
  schema: z.ZodType<T>;
  handleTool: ToolHandler;
  /** The whole loop, every call included. */
  timeoutMs: number;
}

export interface StructuredToolResult<T> {
  output: T;
  usage: AiUsage;
}

/**
 * A short manual tool loop that ends in a structured output (spec 007): the model calls our tools at
 * most `FEATURES[feature].maxToolRounds` times, then answers with JSON that must match `schema`.
 * Tokens of every call are added into one `ai_usage` row. Throws `AiUnavailableError` with that usage
 * on an API error, a time-out, a refusal, `max_tokens`, too many tool rounds or an invalid answer.
 *
 * The assistant turns are appended unchanged (thinking blocks included), as the API requires.
 */
export async function runStructuredToolLoop<T>(
  createMessage: CreateMessage,
  loop: StructuredToolLoop<T>,
  now: () => number = Date.now,
): Promise<StructuredToolResult<T>> {
  const config = FEATURES[loop.feature];
  const startedAt = now();
  let inputTokens = 0;
  let outputTokens = 0;
  const usage = (status: AiCallStatus): AiUsage => ({
    feature: loop.feature,
    model: config.model,
    inputTokens,
    outputTokens,
    costUsd: costUsd(config.model, inputTokens, outputTokens),
    latencyMs: now() - startedAt,
    status,
  });
  const fail = (status: Exclude<AiCallStatus, 'ok'>, message: string): never => {
    throw new AiUnavailableError(status, usage(status), `${loop.feature}: ${message}`);
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), loop.timeoutMs);
  const format = zodOutputFormat(loop.schema);
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: loop.content }];
  try {
    for (let call = 0; ; call++) {
      let message: Anthropic.Message;
      try {
        message = await createMessage(
          {
            model: config.model,
            max_tokens: config.maxTokens,
            output_config: { effort: config.effort, format },
            // Tools render before the system prompt: one breakpoint here caches both.
            system:
              typeof loop.system === 'string'
                ? [{ type: 'text', text: loop.system, cache_control: { type: 'ephemeral' } }]
                : loop.system,
            ...(loop.tools.length ? { tools: loop.tools } : {}),
            messages,
          },
          { signal: controller.signal },
        );
      } catch (error) {
        if (controller.signal.aborted) return fail('error', 'time-out');
        const detail = error instanceof Anthropic.APIError ? `API error ${error.status}` : 'error';
        return fail('error', detail);
      }
      const u = message.usage;
      inputTokens +=
        u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      outputTokens += u.output_tokens;

      if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
        return fail(message.stop_reason, message.stop_reason);
      }
      if (message.stop_reason === 'tool_use') {
        if (call >= config.maxToolRounds) return fail('invalid_output', 'too many tool rounds');
        messages.push({ role: 'assistant', content: message.content });
        const calls = message.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
        );
        // Every result goes back in one user turn, so parallel calls keep working.
        const results = await Promise.all(
          calls.map(async (block): Promise<Anthropic.ToolResultBlockParam> => {
            try {
              const content = await loop.handleTool(block.name, block.input);
              return { type: 'tool_result', tool_use_id: block.id, content };
            } catch {
              return {
                type: 'tool_result',
                tool_use_id: block.id,
                content: 'The tool failed.',
                is_error: true,
              };
            }
          }),
        );
        messages.push({ role: 'user', content: results });
        continue;
      }

      // The answer may come after thinking blocks: read the text block by type, not by position.
      const text = message.content.find((block) => block.type === 'text')?.text;
      let json: unknown;
      try {
        json = JSON.parse(text ?? '');
      } catch {
        json = undefined;
      }
      const parsed = loop.schema.safeParse(json);
      if (!parsed.success) return fail('invalid_output', 'the output does not match the schema');
      return { output: parsed.data, usage: usage('ok') };
    }
  } finally {
    clearTimeout(timer);
  }
}
