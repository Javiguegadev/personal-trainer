import type Anthropic from '@anthropic-ai/sdk';
import { MEAL_DRAFT_LIMITS, type MealReading } from '@pt/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AiUnavailableError, type CreateMessage } from '../../client';
import { createMealReader, MEAL_SYSTEM_PROMPT, SEARCH_FOODS_TOOL, type MealInput } from './index';

const reading: MealReading = {
  status: 'ok',
  items: [
    {
      mention: 'dos huevos fritos',
      foodId: 'f1',
      servingId: 'f1s1',
      servings: 2,
      grams: null,
      confidence: 'high',
      quantityAssumed: false,
      inferred: false,
    },
  ],
};

function message(over: Partial<Anthropic.Message>): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [],
    usage: { input_tokens: 1000, output_tokens: 100 },
    ...over,
  } as Anthropic.Message;
}

const text = (value: string) => ({ type: 'text', text: value, citations: null }) as const;
const toolUse = (id: string, queries: unknown) =>
  ({
    type: 'tool_use',
    id,
    name: 'search_foods',
    input: { queries },
    caller: { type: 'direct' },
  }) as const;
const searchCall = (id: string, ...queries: string[]) =>
  message({ stop_reason: 'tool_use', content: [toolUse(id, queries)] });
const answer = (value: MealReading = reading) =>
  message({ content: [text(JSON.stringify(value))] });

const SENTENCE: MealInput = { kind: 'text', text: 'dos huevos fritos' };
const PHOTO: MealInput = {
  kind: 'photo',
  image: { mediaType: 'image/jpeg', data: 'aGVsbG8=' },
};

/** A fake API: answers each call with the next message (or throws the next error). */
function setup(...answers: (Anthropic.Message | Error | 'hang')[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const createMessage: CreateMessage = async (params, options) => {
    // A snapshot: the loop keeps appending to the same array.
    calls.push({ ...params, messages: [...params.messages] });
    const next = answers.shift();
    if (next === undefined) throw new Error('no more answers');
    if (next === 'hang') {
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if (next instanceof Error) throw next;
    return next;
  };
  const searches: string[][] = [];
  const searchFoods = async (queries: string[]) => {
    searches.push(queries);
    return JSON.stringify({ results: queries.map((query) => ({ query, foods: [] })) });
  };
  let clock = 1000;
  const read = createMealReader(createMessage, () => (clock += 100));
  return { read, calls, searches, searchFoods };
}

const failure = async (run: Promise<unknown>) => {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiUnavailableError);
  return error as AiUnavailableError;
};

describe('createMealReader (spec 007 AC4, AC5, AC9, AC11, AC16)', () => {
  it('searches the catalog, answers, and adds the tokens of every call into one usage', async () => {
    const { read, searches, searchFoods } = setup(searchCall('t1', 'huevo frito'), answer());
    const result = await read(SENTENCE, searchFoods);
    expect(result.reading).toEqual(reading);
    expect(searches).toEqual([['huevo frito']]);
    expect(result.usage).toMatchObject({
      feature: 'meal_text',
      model: 'claude-haiku-5-5',
      inputTokens: 2000,
      outputTokens: 200,
      status: 'ok',
    });
    // 2000 × $0.10 + 200 × $0.50, per million tokens
    expect(result.usage.costUsd).toBeCloseTo(0.0003, 10);
  });

  it('sends the tool result back with the assistant turn unchanged', async () => {
    const first = searchCall('t1', 'huevo frito');
    const { read, calls, searchFoods } = setup(first, answer());
    await read(SENTENCE, searchFoods);
    const second = calls[1]?.messages ?? [];
    expect(second[1]).toEqual({ role: 'assistant', content: first.content });
    expect(second[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 't1',
          content: JSON.stringify({ results: [{ query: 'huevo frito', foods: [] }] }),
        },
      ],
    });
  });

  it('answers every parallel call in one user turn', async () => {
    const parallel = message({
      stop_reason: 'tool_use',
      content: [toolUse('t1', ['huevo']), toolUse('t2', ['pan'])],
    });
    const { read, calls, searchFoods } = setup(parallel, answer());
    await read(SENTENCE, searchFoods);
    const results = calls[1]?.messages[2]?.content as Anthropic.ToolResultBlockParam[];
    expect(results.map((r) => r.tool_use_id)).toEqual(['t1', 't2']);
  });

  it('sends a fixed, cached prefix: the system prompt and the strict tool (AC16)', async () => {
    const { read, calls, searchFoods } = setup(answer());
    await read(SENTENCE, searchFoods);
    const params = calls[0];
    expect(params?.model).toBe('claude-haiku-5-5');
    expect(params?.output_config?.effort).toBe('low');
    expect(params?.output_config?.format).toBeDefined();
    expect(params?.tools).toEqual([SEARCH_FOODS_TOOL]);
    expect(SEARCH_FOODS_TOOL.strict).toBe(true);
    expect(params?.system).toEqual([
      { type: 'text', text: MEAL_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ]);
    expect(params).not.toHaveProperty('tool_choice');
  });

  it('sends the sentence inside its tags and nothing about the user (AC16)', async () => {
    const { read, calls, searchFoods } = setup(answer());
    await read(SENTENCE, searchFoods);
    expect(calls[0]?.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What I ate, in my words:\n<meal>\ndos huevos fritos\n</meal>' },
        ],
      },
    ]);
  });

  it('sends a photo as an image block, metered as meal_photo (AC5)', async () => {
    const { read, calls, searchFoods } = setup(answer());
    const result = await read(PHOTO, searchFoods);
    const content = calls[0]?.messages[0]?.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' },
    });
    expect(result.usage.feature).toBe('meal_photo');
  });

  it('allows two tool rounds and fails on a third (AC11)', async () => {
    const twice = setup(searchCall('t1', 'a'), searchCall('t2', 'b'), answer());
    await expect(twice.read(SENTENCE, twice.searchFoods)).resolves.toBeDefined();

    const thrice = setup(searchCall('t1', 'a'), searchCall('t2', 'b'), searchCall('t3', 'c'));
    const error = await failure(thrice.read(SENTENCE, thrice.searchFoods));
    expect(error.status).toBe('invalid_output');
    expect(thrice.searches).toHaveLength(2);
    expect(error.usage.inputTokens).toBe(3000);
  });

  it('returns a failing search to the model as an error result', async () => {
    const { read, calls } = setup(searchCall('t1', 'huevo'), answer());
    await read(SENTENCE, async () => {
      throw new Error('database down');
    });
    const results = calls[1]?.messages[2]?.content as Anthropic.ToolResultBlockParam[];
    expect(results[0]).toMatchObject({ is_error: true, content: 'The tool failed.' });
  });

  it('fails on a refusal, on max_tokens, on an API error and on an invalid answer (AC11)', async () => {
    for (const [answerOrError, status] of [
      [message({ stop_reason: 'refusal' }), 'refusal'],
      [message({ stop_reason: 'max_tokens' }), 'max_tokens'],
      [new Error('network'), 'error'],
      [message({ content: [text('{"status":"ok"}')] }), 'invalid_output'],
      [message({ content: [text('not json')] }), 'invalid_output'],
    ] as const) {
      const { read, searchFoods } = setup(answerOrError);
      const error = await failure(read(SENTENCE, searchFoods));
      expect(error.status).toBe(status);
      expect(error.usage.status).toBe(status);
    }
  });

  it('gives up after the time limit of the whole draft (AC11)', async () => {
    vi.useFakeTimers();
    try {
      const { read, searchFoods } = setup('hang');
      const run = failure(read(SENTENCE, searchFoods));
      await vi.advanceTimersByTimeAsync(MEAL_DRAFT_LIMITS.timeoutMs);
      const error = await run;
      expect(error.status).toBe('error');
      expect(error.message).toContain('time-out');
    } finally {
      vi.useRealTimers();
    }
  });
});
