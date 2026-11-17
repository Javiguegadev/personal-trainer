import type Anthropic from '@anthropic-ai/sdk';
import type { LabelReading } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { AiUnavailableError, type CreateMessage } from '../../client';
import { createLabelReader } from './index';

const reading: LabelReading = {
  status: 'ok',
  basis: 'per_100g',
  servingSize: 30,
  servingUnit: 'g',
  energyKcal: 436,
  energyKj: 1836,
  fatG: 10.5,
  carbsG: 76,
  proteinG: 7.1,
  fiberG: null,
  productName: 'Galletas María',
  brand: null,
};

const image = { mediaType: 'image/jpeg' as const, data: 'aGVsbG8=' };

function message(over: Partial<Anthropic.Message>): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [],
    usage: { input_tokens: 1200, output_tokens: 150 },
    ...over,
  } as Anthropic.Message;
}

const text = (value: string) => ({ type: 'text', text: value, citations: null }) as const;

function setup(answer: Anthropic.Message | Error) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const createMessage: CreateMessage = async (params) => {
    calls.push(params);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  let clock = 1000;
  const read = createLabelReader(createMessage, () => (clock += 250));
  return { read, calls };
}

const failure = async (run: Promise<unknown>) => {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiUnavailableError);
  return error as AiUnavailableError;
};

describe('createLabelReader (spec 006 AC15, AC17–AC19)', () => {
  it('returns the reading and what the call cost', async () => {
    const { read } = setup(message({ content: [text(JSON.stringify(reading))] }));
    const result = await read(image);
    expect(result.reading).toEqual(reading);
    expect(result.usage).toEqual({
      feature: 'label_scan',
      model: 'claude-haiku-5-5',
      inputTokens: 1200,
      outputTokens: 150,
      // 1200 × $0.10 + 150 × $0.50, per million tokens
      costUsd: 0.000195,
      latencyMs: 250,
      status: 'ok',
    });
  });

  it('sends only the image and a fixed instruction, on Haiku 5.5 with a structured output', async () => {
    const { read, calls } = setup(message({ content: [text(JSON.stringify(reading))] }));
    await read(image);
    expect(calls).toHaveLength(1);
    const params = calls[0]!;
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.output_config?.format?.type).toBe('json_schema');
    expect(params.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' } },
          { type: 'text', text: 'Read the nutrition table in this photo.' },
        ],
      },
    ]);
    // No sampling parameters (Haiku 5.5 rejects them) and no forced thinking budget.
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('thinking');
  });

  it('reads the text block after a thinking block', async () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig' } as const;
    const { read } = setup(message({ content: [thinking, text(JSON.stringify(reading))] }));
    expect((await read(image)).reading).toEqual(reading);
  });

  it('fails as a refusal or a cut answer without reading the content', async () => {
    for (const stop of ['refusal', 'max_tokens'] as const) {
      const { read } = setup(message({ stop_reason: stop, content: [text('{"status":"ok"')] }));
      const error = await failure(read(image));
      expect(error.status).toBe(stop);
      expect(error.usage).toMatchObject({ status: stop, inputTokens: 1200, outputTokens: 150 });
    }
  });

  it('fails as invalid output when the answer is not the schema', async () => {
    for (const body of [
      'not json',
      '{"status":"ok"}',
      JSON.stringify({ ...reading, fatG: '10' }),
    ]) {
      const { read } = setup(message({ content: [text(body)] }));
      expect((await failure(read(image))).status).toBe('invalid_output');
    }
    const { read } = setup(message({ content: [] }));
    expect((await failure(read(image))).status).toBe('invalid_output');
  });

  it('fails as an error, with no tokens, when the call throws', async () => {
    const { read } = setup(new Error('socket hang up'));
    const error = await failure(read(image));
    expect(error.status).toBe('error');
    expect(error.usage).toMatchObject({
      status: 'error',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
    // The error never carries the image.
    expect(error.message).not.toContain('aGVsbG8=');
  });
});
