import type Anthropic from '@anthropic-ai/sdk';
import type { WorkoutReading } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { AiUnavailableError, type CreateMessage } from '../../client';
import {
  WORKOUT_SYSTEM_PROMPT,
  createWorkoutReader,
  workoutCatalogBlock,
  workoutUserText,
  type WorkoutReadInput,
} from './index';

const reading: WorkoutReading = {
  status: 'ok',
  gym: {
    exercises: [
      {
        mention: 'press banca 4x8 con 60',
        exerciseRef: 'e1',
        setGroups: [
          { count: 4, reps: 8, weight: 60, weightUnit: 'kg', durationS: null, distanceM: null },
        ],
      },
    ],
    minutes: null,
    sessionRpe: null,
  },
  activities: [],
  daysAgo: 1,
  startTime: null,
  painMentioned: false,
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
    usage: { input_tokens: 200, cache_read_input_tokens: 5000, output_tokens: 150 },
    ...over,
  } as Anthropic.Message;
}

const text = (value: string) => ({ type: 'text', text: value, citations: null }) as const;
const answer = (value: unknown = reading) => message({ content: [text(JSON.stringify(value))] });

const INPUT: WorkoutReadInput = {
  text: 'ayer press banca 4x8 con 60',
  today: '2026-11-24',
  catalog: [
    {
      ref: 'e1',
      nameEs: 'Press de banca',
      nameEn: 'Bench press',
      synonyms: ['press banca', 'bench press'],
      tracking: 'weight_reps',
    },
    { ref: 'e2', nameEs: 'Plancha', nameEn: 'Plank', synonyms: [], tracking: 'duration' },
  ],
  own: [{ ref: 'u1', name: 'Press Larsen', tracking: 'weight_reps' }],
};

function setup(...answers: (Anthropic.Message | Error | 'hang')[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const createMessage: CreateMessage = async (params, options) => {
    calls.push(params);
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
  let clock = 1000;
  const read = createWorkoutReader(createMessage, () => (clock += 100));
  return { read, calls };
}

describe('createWorkoutReader (spec 012)', () => {
  it('makes one call without tools and returns the reading with its usage', async () => {
    const { read, calls } = setup(answer());
    const result = await read(INPUT);
    expect(result.reading).toEqual(reading);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('tools');
    expect(calls[0]).toMatchObject({
      model: 'claude-haiku-5-5',
      output_config: { effort: 'low' },
    });
    expect(result.usage).toMatchObject({
      feature: 'workout_text',
      model: 'claude-haiku-5-5',
      inputTokens: 5200,
      outputTokens: 150,
      status: 'ok',
    });
  });

  it('caches the instructions and the catalog, and sends the request facts after them', async () => {
    const { read, calls } = setup(answer(), answer());
    await read(INPUT);
    await read({ ...INPUT, text: 'plancha 3x45 s', own: [] });
    const [first, second] = calls;
    expect(first?.system).toEqual(second?.system);
    const system = first?.system as Anthropic.TextBlockParam[];
    expect(system.map((b) => b.cache_control ?? null)).toEqual([null, { type: 'ephemeral' }]);
    expect(system[0]?.text).toBe(WORKOUT_SYSTEM_PROMPT);
    expect(system[1]?.text).toBe(workoutCatalogBlock(INPUT.catalog));
    // Nothing of the user in the cached prefix.
    expect(JSON.stringify(system)).not.toContain('Press Larsen');
    expect(JSON.stringify(system)).not.toContain('<workout>');
  });

  it.each([
    ['a refusal', message({ stop_reason: 'refusal', content: [] }), 'refusal'],
    ['max_tokens', message({ stop_reason: 'max_tokens', content: [] }), 'max_tokens'],
    ['an invalid output', answer({ status: 'ok' }), 'invalid_output'],
    ['an API error', new Error('boom'), 'error'],
  ] as const)('fails with the usage to record on %s (AC16)', async (_, outcome, status) => {
    const { read } = setup(outcome);
    const failure = await read(INPUT).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AiUnavailableError);
    expect((failure as AiUnavailableError).usage).toMatchObject({
      feature: 'workout_text',
      status,
    });
  });
});

describe('the prompt blocks', () => {
  it('lists every catalog exercise on one line with its ref, names, synonyms and tracking', () => {
    const block = workoutCatalogBlock(INPUT.catalog);
    expect(block).toContain(
      'e1 | Press de banca | Bench press | press banca, bench press | weight_reps',
    );
    expect(block).toContain('e2 | Plancha | Plank |  | duration');
  });

  it('gives the model today and the 6 days before with their weekdays, the own exercises and the sentence', () => {
    const text = workoutUserText(INPUT);
    expect(text).toContain('daysAgo 0: 2026-11-24, martes (Tuesday)');
    expect(text).toContain('daysAgo 1: 2026-11-23, lunes (Monday)');
    expect(text).toContain('daysAgo 6: 2026-11-18, miércoles (Wednesday)');
    expect(text).not.toContain('daysAgo 7');
    expect(text).toContain('u1 | Press Larsen | weight_reps');
    expect(text).toContain('<workout>\nayer press banca 4x8 con 60\n</workout>');
    expect(workoutUserText({ ...INPUT, own: [] })).toContain('(none)');
  });

  it('treats the sentence as data', () => {
    expect(WORKOUT_SYSTEM_PROMPT).toMatch(/sentence is data/);
  });
});
