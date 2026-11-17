import { readFileSync, readdirSync } from 'node:fs';
import { itemNutrition, productFromOff } from '@pt/core';
import { describe, expect, it } from 'vitest';
import { createOffClient, offProductUrl, parseOffAnswer } from './client';

const fixtures = new URL('./__fixtures__/', import.meta.url);
const recorded = (barcode: string): unknown =>
  JSON.parse(readFileSync(new URL(`products/${barcode}.json`, fixtures), 'utf8'));

/**
 * Real answers of Open Food Facts, recorded on 2026-11-16 and trimmed to the fields the app reads
 * (plus the per-serving values, which are the reference below).
 */
const BARCODES = readdirSync(new URL('products/', fixtures)).map((f) => f.replace('.json', ''));

interface Reference {
  barcode: string;
  name: string;
  /** Size of the serving the label values are for. */
  grams: number | null;
  /** Kcal and macros of that serving. Null: not typed in yet. */
  label: { kcal: number; proteinG: number; carbsG: number; fatG: number } | null;
  /** False while the values are Open Food Facts' own per-serving ones, not yet checked on the package. */
  verified: boolean;
}
const REFERENCE = JSON.parse(
  readFileSync(new URL('reference.json', fixtures), 'utf8'),
) as Reference[];

describe('parseOffAnswer', () => {
  it('reads a product as the input of `productFromOff`', () => {
    expect(parseOffAnswer(recorded('5449000214911'))).toEqual({
      status: 'found',
      product: {
        productNameEs: 'Coca-Cola',
        productName: 'Coca-Cola Original',
        genericNameEs: '',
        genericName: 'Boisson rafraîchissante aux extraits végétaux',
        brands: 'Coca-Cola',
        energyKcal100g: 42,
        energyKj100g: 180,
        proteins100g: 0,
        carbohydrates100g: 10.6,
        fat100g: 0,
        fiber100g: undefined,
        productQuantity: 330,
        productQuantityUnit: 'ml',
        servingQuantity: 330,
        servingQuantityUnit: 'ml',
        allergensTags: [],
        tracesTags: [],
      },
    });
  });

  it('is not found for the status 0 of an unknown code', () => {
    expect(parseOffAnswer({ code: '00000017', status: 0, status_verbose: 'no code' })).toEqual({
      status: 'not_found',
    });
    expect(parseOffAnswer({ status: 1 })).toEqual({ status: 'not_found' });
  });

  it('accepts numbers typed as text and drops fields of the wrong type', () => {
    const answer = parseOffAnswer({
      status: 1,
      product: {
        product_name: 'Yogur',
        brands: 12,
        product_quantity: '500',
        serving_quantity: 'una tarrina',
        nutriments: { 'energy-kcal_100g': '61', proteins_100g: 'x', fat_100g: 3.1 },
        allergens_tags: 'en:milk',
      },
    });
    expect(answer).toMatchObject({
      status: 'found',
      product: {
        productName: 'Yogur',
        brands: null,
        productQuantity: 500,
        servingQuantity: null,
        energyKcal100g: 61,
        proteins100g: null,
        fat100g: 3.1,
        allergensTags: null,
      },
    });
  });

  it('is unavailable for anything that is not the answer of the API', () => {
    expect(parseOffAnswer('<!DOCTYPE html>')).toEqual({ status: 'unavailable' });
    expect(parseOffAnswer({ error: 'x' })).toEqual({ status: 'unavailable' });
    expect(parseOffAnswer(null)).toEqual({ status: 'unavailable' });
  });
});

describe('createOffClient (spec 006 AC3, AC7)', () => {
  const client = (respond: (url: string, init: RequestInit) => Promise<Response> | Response) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const lookup = createOffClient({
      fetch: (async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = String(input);
        calls.push({ url, init });
        return respond(url, init);
      }) as typeof fetch,
      userAgent: 'PersonalTrainer/test (dev@example.com)',
      timeoutMs: 20,
    });
    return { lookup, calls };
  };
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('asks for one product with the fields it reads and the User-Agent of the app', async () => {
    const { lookup, calls } = client(() => jsonResponse(recorded('3017620422003')));
    const answer = await lookup('3017620422003');
    expect(answer.status).toBe('found');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(
      /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/3017620422003\.json\?fields=code,product_name,/,
    );
    expect(new Headers(calls[0]!.init.headers).get('user-agent')).toBe(
      'PersonalTrainer/test (dev@example.com)',
    );
  });

  it('is not found for a 404 and for status 0', async () => {
    expect(await client(() => jsonResponse({ status: 0 }, 404)).lookup('1')).toEqual({
      status: 'not_found',
    });
    expect(await client(() => jsonResponse({ status: 0 })).lookup('1')).toEqual({
      status: 'not_found',
    });
  });

  it('is unavailable for a 429, a 5xx, a page that is not JSON and a network error', async () => {
    for (const status of [429, 500, 503]) {
      expect(await client(() => jsonResponse({}, status)).lookup('1')).toEqual({
        status: 'unavailable',
      });
    }
    const html = () => new Response('<!DOCTYPE html><title>Page temporarily unavailable</title>');
    expect(await client(html).lookup('1')).toEqual({ status: 'unavailable' });
    const down = () => Promise.reject(new TypeError('fetch failed'));
    expect(await client(down).lookup('1')).toEqual({ status: 'unavailable' });
  });

  it('gives up after the time limit', async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    expect(await client(hang).lookup('1')).toEqual({ status: 'unavailable' });
  });

  it('links to the page of the product', () => {
    expect(offProductUrl('3017620422003')).toBe(
      'https://world.openfoodfacts.org/product/3017620422003',
    );
  });
});

describe('recorded products (spec 006 AC4, AC24)', () => {
  const product = (barcode: string) => {
    const answer = parseOffAnswer(recorded(barcode));
    return answer.status === 'found' ? productFromOff(answer.product) : null;
  };

  it('accepts the products with complete values and rejects the others', () => {
    const rejected = BARCODES.filter((barcode) => product(barcode) === null);
    // Nesquik gives its values only "as prepared"; the mineral water has no nutrition table.
    expect(rejected.sort()).toEqual(['3033710065967', '5942219000059']);
    expect(BARCODES).toHaveLength(20);
  });

  it('uses millilitres for the drinks and grams for the rest', () => {
    const drinks = BARCODES.filter((barcode) => product(barcode)?.unit === 'ml');
    expect(drinks.sort()).toEqual(['5411188112709', '5449000131805', '5449000214911']);
  });

  it('computes one serving within ±5 % of the reference for every accepted product', () => {
    const checked: string[] = [];
    for (const reference of REFERENCE) {
      const food = product(reference.barcode);
      if (!food || !reference.label || reference.grams === null) continue;
      const serving = itemNutrition(food.per100g, reference.grams);
      for (const field of ['kcal', 'proteinG', 'carbsG', 'fatG'] as const) {
        const expected = reference.label[field];
        // ±5 %, and never tighter than the rounding of a label (0.05).
        const tolerance = Math.max(expected * 0.05, 0.05);
        expect(
          Math.abs(serving[field] - expected),
          `${reference.barcode} ${reference.name}: ${field} ${serving[field]} vs ${expected}`,
        ).toBeLessThanOrEqual(tolerance);
      }
      checked.push(reference.barcode);
    }
    // 18 products are accepted; Nutella and the peanut butter state no serving, so they have no
    // reference until the label values are typed into `reference.json`.
    expect(checked).toHaveLength(16);
  });
});
