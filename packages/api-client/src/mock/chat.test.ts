import type { OnboardingChatRequest, OnboardingDraft } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { extractFromMessage, mockOnboardingTurn, type MockChatTurn } from './chat';

const TODAY = '2026-11-11';

function turn(messages: string[], draft: OnboardingDraft = {}) {
  const request: OnboardingChatRequest = {
    messages: messages.map((content) => ({ role: 'user' as const, content })),
    draft,
    locale: 'es',
    today: TODAY,
  };
  const result: MockChatTurn = mockOnboardingTurn(request);
  if (result.kind !== 'ok') throw new Error(`unexpected turn: ${result.kind}`);
  return result;
}

describe('mock chat: answers without units, read in the context of the question', () => {
  it('reads a bare number as the age when the age was asked', () => {
    expect(extractFromMessage('hombre, 30', TODAY, ['sex', 'birthDate'])).toEqual({
      sex: 'male',
      birthDate: '1996-11-11',
    });
  });

  it('reads the formats the chat intro suggests ("1,75", "80")', () => {
    const asked = ['heightCm', 'weightKg'] as const;
    expect(extractFromMessage('1,75 y 80', TODAY, asked)).toEqual({ heightCm: 175, weightKg: 80 });
    expect(extractFromMessage('175 80', TODAY, asked)).toEqual({ heightCm: 175, weightKg: 80 });
    expect(extractFromMessage('mido 170', TODAY, asked)).toEqual({ heightCm: 170 });
    expect(extractFromMessage('peso 80', TODAY, asked)).toEqual({ weightKg: 80 });
    expect(extractFromMessage('100 kilos y 1,80', TODAY, asked)).toEqual({
      heightCm: 180,
      weightKg: 100,
    });
  });

  it('does not guess what a bare number means when it was not asked', () => {
    expect(extractFromMessage('1,75 y 80', TODAY)).toEqual({});
    expect(extractFromMessage('30', TODAY, ['activityLevel'])).toEqual({});
  });

  it('takes "no" or "ninguna" as no special diet when the diet was asked', () => {
    expect(extractFromMessage('no', TODAY, ['dietType'])).toEqual({ dietType: 'omnivore' });
    expect(extractFromMessage('ninguna', TODAY, ['dietType'])).toEqual({ dietType: 'omnivore' });
    expect(extractFromMessage('no', TODAY, ['goal'])).toEqual({});
  });
});

describe('mock chat: everyday wording', () => {
  it.each([
    ['poco activo', 'light'],
    ['no muy activa', 'light'],
    ['muy activo', 'very_active'],
    ['trabajo en una oficina', 'sedentary'],
    ['entreno 3 días a la semana', 'moderate'],
    ['voy al gimnasio 6 veces por semana', 'active'],
  ])('maps "%s" to the %s activity level', (text, level) => {
    expect(extractFromMessage(text, TODAY).activityLevel).toBe(level);
  });

  it.each([
    ['quiero bajar de peso', 'lose'],
    ['definir', 'lose'],
    ['ganar masa muscular', 'gain'],
    ['mantenerme', 'maintain'],
    ['trabajar mejor', undefined],
  ])('maps "%s" to the goal %s', (text, goal) => {
    expect(extractFromMessage(text, TODAY).goal).toBe(goal);
  });

  it('understands masculino / femenino', () => {
    expect(extractFromMessage('masculino', TODAY).sex).toBe('male');
    expect(extractFromMessage('femenino', TODAY).sex).toBe('female');
  });
});

describe('mock chat: negations', () => {
  it('does not record an injury, an allergy or a pregnancy the user denies', () => {
    expect(extractFromMessage('no tengo ninguna lesión', TODAY)).toEqual({});
    expect(extractFromMessage('no soy alérgico a nada', TODAY)).toEqual({});
    expect(turn(['hola', 'no estoy embarazada']).draft.healthFlags).toBeUndefined();
    expect(turn(['hola', 'no tengo lesiones']).draft.healthFlags).toBeUndefined();
  });

  it('still records what the user does report', () => {
    expect(extractFromMessage('no tengo lesiones, pero me duele la rodilla', TODAY).injuries).toBe(
      'no tengo lesiones, pero me duele la rodilla',
    );
    expect(turn(['hola', 'estoy embarazada']).draft.healthFlags).toEqual(['pregnancy']);
    expect(turn(['hola', 'me duele la rodilla']).draft.healthFlags).toEqual(['medical_condition']);
  });

  it('raises the soft stop for "no como nada" but not for "no como nada de pescado"', () => {
    expect(turn(['hola', 'llevo días que no como nada']).softStop).toBe(true);
    expect(turn(['hola', 'no como nada de pescado']).softStop).toBe(false);
  });
});

describe('mock chat: conversation', () => {
  it('collects the conversation from the human test (2026-11-12)', () => {
    const first = turn(['hombre, 30']);
    expect(first.draft).toEqual({ sex: 'male', birthDate: '1996-11-11' });
    expect(first.reply).toContain('¿Cuánto mides y cuánto pesas?');

    const second = turn(['hombre, 30', '1,75 y 80'], first.draft);
    expect(second.draft).toEqual({
      sex: 'male',
      birthDate: '1996-11-11',
      heightCm: 175,
      weightKg: 80,
    });
    expect(second.reply).toContain('activo');
  });

  it('asks only for the missing half of a question', () => {
    const reply = turn(['hombre']).reply;
    expect(reply).toContain('¿Cuántos años tienes?');
    expect(reply).not.toContain('sexo');
  });

  it('never invents a value: it asks again with an example', () => {
    const draft: OnboardingDraft = { sex: 'male', birthDate: '1996-11-11' };
    const result = turn(['hombre, 30', 'pues no sé'], draft);
    expect(result.draft).toEqual(draft);
    expect(result.reply).toContain('¿Cuánto mides y cuánto pesas?');
    expect(result.reply).toContain('1,75');
  });

  it('greets on a first message it does not understand', () => {
    const result = turn(['hola']);
    expect(result.draft).toEqual({});
    expect(result.reply).toContain('¿Cuál es tu sexo y cuántos años tienes?');
  });

  it('fills what is missing with example values only on #demo', () => {
    const result = turn(['hombre', '#demo'], { sex: 'male' });
    expect(result.draft).toMatchObject({
      sex: 'male',
      heightCm: 165,
      weightKg: 62,
      activityLevel: 'moderate',
      goal: 'maintain',
      dietType: 'omnivore',
    });
    expect(result.draft.birthDate).toBe('1992-11-11');
  });
});
