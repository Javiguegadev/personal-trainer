import type Anthropic from '@anthropic-ai/sdk';
import type { OnboardingChatRequest } from '@pt/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AiUnavailableError, type CreateMessage } from '../../client';
import { runOnboardingTurn } from './run';
import { ONBOARDING_TOOLS } from './tools';

type Block = Anthropic.ContentBlock;

function message(
  content: Block[],
  stop_reason: Anthropic.Message['stop_reason'],
): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200 },
  } as unknown as Anthropic.Message;
}
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as unknown as Block;
const toolUse = (id: string, name: string, input: unknown) =>
  ({ type: 'tool_use', id, name, input }) as unknown as Block;

function fakeModel(...responses: Anthropic.Message[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const fn: CreateMessage = vi.fn(async (params) => {
    calls.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error('no more fake responses');
    return next;
  });
  return { fn, calls };
}

const request: OnboardingChatRequest = {
  messages: [{ role: 'user', content: 'Mido 5 ft 10, peso 180 lb y tengo 30 años' }],
  draft: { sex: 'male' },
  locale: 'es',
  today: '2026-11-11',
};

describe('runOnboardingTurn', () => {
  it('applies tool input through core (AC9) and returns the final reply with metered usage', async () => {
    const { fn, calls } = fakeModel(
      message(
        [
          toolUse('t1', 'update_profile_draft', {
            height: { unit: 'ft_in', feet: 5, inches: 10 },
            weight: { unit: 'lb', value: 180 },
            ageYears: 30,
          }),
        ],
        'tool_use',
      ),
      message([text('¡Gracias! ¿Cuánto ejercicio haces a la semana?')], 'end_turn'),
    );

    const result = await runOnboardingTurn(fn, request, () => 0);

    expect(result.draft).toEqual({
      sex: 'male',
      heightCm: 177.8,
      weightKg: 81.6,
      birthDate: '1996-11-11',
    });
    expect(result.reply).toContain('ejercicio');
    expect(result.softStop).toBe(false);
    expect(result.usage).toMatchObject({
      feature: 'onboarding',
      model: 'claude-haiku-5-5',
      inputTokens: 2000,
      outputTokens: 400,
      status: 'ok',
    });
    expect(result.usage.costUsd).toBeCloseTo((2000 * 0.1 + 400 * 0.5) / 1e6, 10);

    // The second request carries the tool result with what is still missing.
    const second = calls[1]!;
    const toolResultTurn = second.messages.at(-1)!;
    expect(JSON.stringify(toolResultTurn.content)).toContain('stillMissing');
  });

  it('keeps the history append-only across tool rounds (thinking blocks are bound to the prefix)', async () => {
    const { fn, calls } = fakeModel(
      message([toolUse('t1', 'update_profile_draft', { sex: 'male' })], 'tool_use'),
      message([toolUse('t2', 'update_profile_draft', { dietType: 'vegan' })], 'tool_use'),
      message([text('Vale')], 'end_turn'),
    );
    await runOnboardingTurn(fn, request);
    for (let i = 1; i < calls.length; i++) {
      const previous = calls[i - 1]!.messages;
      expect(calls[i]!.messages.slice(0, previous.length)).toEqual(previous);
    }
  });

  it('raises the eating-disorder soft stop (AC20)', async () => {
    const { fn } = fakeModel(
      message([toolUse('t1', 'flag_safety', { flag: 'ed_soft_stop' })], 'tool_use'),
      message([text('Gracias por contármelo…')], 'end_turn'),
    );
    const result = await runOnboardingTurn(fn, request);
    expect(result.softStop).toBe(true);
    expect(result.draft.healthFlags).toEqual(['ed_soft_stop']);
  });

  it('returns invalid tool input to the model as an error instead of saving it', async () => {
    const { fn, calls } = fakeModel(
      message([toolUse('t1', 'update_profile_draft', { sex: 'robot' })], 'tool_use'),
      message([text('Perdona, ¿me repites tu sexo?')], 'end_turn'),
    );
    const result = await runOnboardingTurn(fn, request);
    expect(result.draft).toEqual({ sex: 'male' });
    expect(JSON.stringify(calls[1]!.messages.at(-1)!.content)).toContain('"is_error":true');
  });

  it.each(['refusal', 'max_tokens'] as const)(
    'maps stop_reason %s to AiUnavailableError',
    async (reason) => {
      const { fn } = fakeModel(message([], reason));
      await expect(runOnboardingTurn(fn, request)).rejects.toMatchObject({
        name: 'AiUnavailableError',
        status: reason,
      });
    },
  );

  it('gives up after too many tool rounds', async () => {
    const loop = () => message([toolUse('t', 'update_profile_draft', { sex: 'male' })], 'tool_use');
    const { fn } = fakeModel(loop(), loop(), loop(), loop(), loop());
    await expect(runOnboardingTurn(fn, request)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('sends only the chat text, the draft and the date: no identifiers (AC25)', async () => {
    const { fn, calls } = fakeModel(message([text('Hola')], 'end_turn'));
    await runOnboardingTurn(fn, request);
    const params = calls[0]!;
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.messages.slice(0, -1)).toEqual([
      { role: 'user', content: request.messages[0]!.content },
    ]);
    const context = params.messages.at(-1)!;
    expect(context.role).toBe('system');
    expect(context.content).toContain('"sex":"male"');
    // User-dependent content lives only in messages (the system prompt is static and says "do not ask for email").
    expect(JSON.stringify(params.messages)).not.toMatch(/email|user_?id|@/i);
  });
});

describe('ONBOARDING_TOOLS', () => {
  it('are plain JSON Schema objects the Messages API accepts', () => {
    for (const tool of ONBOARDING_TOOLS) {
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema).not.toHaveProperty('$schema');
    }
  });
});
