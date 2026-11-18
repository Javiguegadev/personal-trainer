import type Anthropic from '@anthropic-ai/sdk';
import type { FeedbackReading } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { AiUnavailableError, type CreateMessage } from '../../client';
import { createFeedbackWriter, feedbackUserText, type FeedbackPromptInput } from './index';

const input: FeedbackPromptInput = {
  locale: 'es',
  state: 'in_progress',
  trainingFocus: 'hypertrophy',
  dietType: 'vegetarian',
  allergies: ['frutos secos'],
  dislikes: ['coliflor'],
  observations: [
    {
      kind: 'protein_gap',
      numbers: {
        nutrient: 'protein',
        eaten: 60,
        target: 140,
        left: 80,
        mealsLeft: ['dinner'],
        perMeal: [],
      },
    },
  ],
  candidates: {
    protein_gap: [{ ref: 'c1', name: 'Yogur griego', portion: '1 yogur (125 g)', amount: 12.5 }],
  },
};

const reading: FeedbackReading = {
  notes: [
    {
      observation: 'protein_gap',
      text: 'Para la cena, un yogur griego suma proteína.',
      suggestionRefs: ['c1'],
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
    usage: { input_tokens: 1500, output_tokens: 120 },
    ...over,
  } as Anthropic.Message;
}

const text = (value: string) => ({ type: 'text', text: value, citations: null }) as const;

function setup(answer: Anthropic.Message | Error | 'hang') {
  const calls: { params: Anthropic.MessageCreateParamsNonStreaming; signal?: AbortSignal }[] = [];
  const createMessage: CreateMessage = async (params, options) => {
    calls.push({ params, signal: options?.signal });
    if (answer === 'hang') {
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if (answer instanceof Error) throw answer;
    return answer;
  };
  let clock = 1000;
  const write = createFeedbackWriter(createMessage, () => (clock += 300));
  return { write, calls };
}

const failure = async (run: Promise<unknown>) => {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiUnavailableError);
  return error as AiUnavailableError;
};

describe('createFeedbackWriter (spec 008 AC13, AC15, AC20)', () => {
  it('returns the reading and what the call cost', async () => {
    const { write } = setup(message({ content: [text(JSON.stringify(reading))] }));
    const result = await write(input);
    expect(result.reading).toEqual(reading);
    expect(result.usage).toEqual({
      feature: 'daily_feedback',
      model: 'claude-haiku-5-5',
      inputTokens: 1500,
      outputTokens: 120,
      // 1500 × $0.10 + 120 × $0.50, per million tokens
      costUsd: 0.00021,
      latencyMs: 300,
      status: 'ok',
    });
  });

  it('calls Haiku 5.5 once, with a structured output, no tools and a time-out signal', async () => {
    const { write, calls } = setup(message({ content: [text(JSON.stringify(reading))] }));
    await write(input);
    expect(calls).toHaveLength(1);
    const { params, signal } = calls[0]!;
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.max_tokens).toBe(1024);
    expect(params.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(params).not.toHaveProperty('tools');
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('thinking');
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('sends only the locale, the focus, the diet, the observations and the candidates (AC20)', async () => {
    const { write, calls } = setup(message({ content: [text(JSON.stringify(reading))] }));
    await write(input);
    const sent = calls[0]!.params.messages;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.content).toBe(feedbackUserText(input));
    const json = JSON.parse(/<day>\n(.*)\n<\/day>/s.exec(feedbackUserText(input))?.[1] ?? '{}');
    expect(Object.keys(json).sort()).toEqual([
      'allergies',
      'candidates',
      'dietType',
      'dislikes',
      'locale',
      'mealsLeft',
      'observations',
      'state',
      'trainingFocus',
    ]);
    expect(json.mealsLeft).toEqual(['dinner']);
    expect(json.observations).toEqual([
      { kind: 'protein_gap', nutrient: 'protein', eaten: 60, target: 140, left: 80 },
    ]);
  });

  it('fails as a refusal, a cut answer or an invalid output', async () => {
    for (const stop of ['refusal', 'max_tokens'] as const) {
      const { write } = setup(message({ stop_reason: stop, content: [text('{')] }));
      expect((await failure(write(input))).status).toBe(stop);
    }
    for (const body of [
      'nope',
      '{"notes":[{"observation":"made_up","text":"x","suggestionRefs":[]}]}',
    ]) {
      const { write } = setup(message({ content: [text(body)] }));
      expect((await failure(write(input))).status).toBe('invalid_output');
    }
  });

  it('fails as an error with no tokens when the call throws or times out (AC15)', async () => {
    const { write } = setup(new Error('socket hang up'));
    const error = await failure(write(input));
    expect(error.status).toBe('error');
    expect(error.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, costUsd: 0 });

    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const hung = setup('hang');
      const pending = failure(hung.write(input));
      await vi.advanceTimersByTimeAsync(10_000);
      const timedOut = await pending;
      expect(timedOut.message).toContain('time-out');
    } finally {
      vi.useRealTimers();
    }
  });
});
