import { CONSENT_VERSION, MEAL_DRAFT_LIMITS, type MealDraftResponse } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { createApiClient, isApiError } from './client';
import { createMockApiClient } from './mock/backend';
import { mockAccessToken, mockUserFromEmail } from './mock/identity';

const NOW = new Date('2026-11-17T10:00:00.000Z');
const IMAGE = 'A'.repeat(4000);
const BASE = 'https://api.test';

const codeOf = (error: unknown) => (isApiError(error) ? error.code : String(error));

async function setup() {
  const token = mockAccessToken(mockUserFromEmail('ana@example.com'));
  const api = createMockApiClient({ getAccessToken: async () => token, now: () => NOW });
  await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
  return api;
}

const keysOf = (draft: MealDraftResponse) =>
  draft.status === 'ok' ? draft.items.map((i) => [i.food.key, i.portion.kind]) : [];

describe('createApiClient: meal drafts (spec 007)', () => {
  it('posts the sentence and the photo to their routes', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const empty: MealDraftResponse = { status: 'unreadable', reason: 'not_food' };
    const api = createApiClient({
      baseUrl: BASE,
      fetchImpl: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        return Response.json(empty);
      }) as typeof fetch,
    });
    const text = { text: 'dos huevos', locale: 'es' as const };
    const photo = {
      image: { mediaType: 'image/jpeg' as const, data: IMAGE },
      locale: 'es' as const,
    };
    expect(await api.draftFromText(text)).toEqual(empty);
    expect(await api.draftFromPhoto(photo)).toEqual(empty);
    expect(calls.map((c) => [c.init.method, c.url.replace(BASE, '')])).toEqual([
      ['POST', '/me/food-log/drafts/text'],
      ['POST', '/me/food-log/drafts/photo'],
    ]);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(text);
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual(photo);
  });
});

describe('mock backend: meal drafts (spec 007)', () => {
  it('drafts a sentence with counts, grams and an unknown food (AC4, AC6)', async () => {
    const api = await setup();
    const draft = await api.draftFromText({
      text: 'dos huevos, 200 g de arroz blanco cocido y salmorejo de mi abuela',
      locale: 'es',
    });
    expect(keysOf(draft)).toEqual([
      ['d-huevo', 'serving'],
      ['c-arroz-blanco-cocido', 'grams'],
    ]);
    expect(draft.status === 'ok' && draft.items[0]?.portion).toMatchObject({ servings: 2 });
    expect(draft.status === 'ok' && draft.unresolved).toEqual([
      { mention: 'salmorejo de mi abuela' },
    ]);
  });

  it('marks a food said without a quantity as assumed (AC4)', async () => {
    const api = await setup();
    const draft = await api.draftFromText({ text: 'café con leche', locale: 'es' });
    expect(draft.status === 'ok' && draft.items[0]).toMatchObject({
      food: { key: 'e-cafe-con-leche' },
      quantityAssumed: true,
    });
  });

  it('says a sentence without food has none (AC10)', async () => {
    const api = await setup();
    expect(await api.draftFromText({ text: 'hola qué tal', locale: 'es' })).toEqual({
      status: 'unreadable',
      reason: 'not_food',
    });
  });

  it('drafts a plate photo with a probable oil, and no food for a tiny image (AC5, AC10)', async () => {
    const api = await setup();
    const draft = await api.draftFromPhoto({
      image: { mediaType: 'image/jpeg', data: IMAGE },
      locale: 'es',
    });
    expect(keysOf(draft)).toEqual([
      ['d-huevo-plancha', 'serving'],
      ['b-patatas-fritas', 'grams'],
      ['f-aceite-oliva-virgen-extra', 'serving'],
    ]);
    expect(draft.status === 'ok' && draft.items.map((i) => [i.confidence, i.inferred])).toEqual([
      ['high', false],
      ['medium', false],
      ['low', true],
    ]);
    const tiny = await api.draftFromPhoto({
      image: { mediaType: 'image/jpeg', data: 'AAAA' },
      locale: 'es',
    });
    expect(tiny).toEqual({ status: 'unreadable', reason: 'not_food' });
    // Nothing of the photo or the sentence is kept (AC16).
    expect(JSON.stringify(await api.exportData())).not.toContain(IMAGE);
  });

  it('stops each shortcut at its own daily cap (AC12)', async () => {
    const api = await setup();
    for (let i = 0; i < MEAL_DRAFT_LIMITS.photosPerDay; i++) {
      await api.draftFromPhoto({ image: { mediaType: 'image/jpeg', data: 'AAAA' }, locale: 'es' });
    }
    const capped = await api
      .draftFromPhoto({ image: { mediaType: 'image/jpeg', data: 'AAAA' }, locale: 'es' })
      .catch(codeOf);
    expect(capped).toBe('ai_cap_reached');
    expect((await api.draftFromText({ text: 'dos huevos', locale: 'es' })).status).toBe('ok');
    const usage = (await api.exportData()).aiUsage.map((u) => u.feature);
    expect(usage.filter((f) => f === 'meal_photo')).toHaveLength(MEAL_DRAFT_LIMITS.photosPerDay);
    expect(usage.filter((f) => f === 'meal_text')).toHaveLength(1);
  });

  it('rejects a short sentence and a photo that is not base64', async () => {
    const api = await setup();
    expect(await api.draftFromText({ text: 'a', locale: 'es' }).catch(codeOf)).toBe(
      'validation_error',
    );
    const bad = await api
      .draftFromPhoto({ image: { mediaType: 'image/jpeg', data: 'no base64!' }, locale: 'es' })
      .catch(codeOf);
    expect(bad).toBe('validation_error');
  });
});
