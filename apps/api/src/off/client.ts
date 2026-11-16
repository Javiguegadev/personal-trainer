import { PRODUCT_LIMITS } from '@pt/contracts';
import type { OffProductInput } from '@pt/core';
import { z } from 'zod';

/**
 * Open Food Facts, read one product at a time when a user scans a barcode (spec 006 AC3): their terms
 * allow the API "as long as 1 API call = 1 real scan by a user", limit product reads to 15 per minute
 * per IP, and ask for a `User-Agent` of the form `AppName/Version (ContactEmail)`.
 * https://openfoodfacts.github.io/openfoodfacts-server/api/
 */
export type OffLookup =
  | { status: 'found'; product: OffProductInput }
  | { status: 'not_found' }
  /** Timeout, network error, 429, 5xx or an answer that is not the API's JSON: try again later. */
  | { status: 'unavailable' };

export type LookupProduct = (barcode: string) => Promise<OffLookup>;

const OFF_BASE_URL = 'https://world.openfoodfacts.org';

/** Only what the app reads, so the answer stays small. */
const FIELDS = [
  'code',
  'product_name',
  'product_name_es',
  'generic_name',
  'generic_name_es',
  'brands',
  'product_quantity',
  'product_quantity_unit',
  'serving_quantity',
  'serving_quantity_unit',
  'nutriments',
  'allergens_tags',
  'traces_tags',
].join(',');

/** The product's page, for the attribution link (AC5). */
export function offProductUrl(barcode: string): string {
  return `${OFF_BASE_URL}/product/${barcode}`;
}

// Volunteers type the data, so every field may be missing or of another type: a bad field is dropped,
// never a reason to fail the product (core decides what is required).
const text = z.string().nullish().catch(null);
/** Quantities come as numbers or as numeric strings ("400"). */
const amount = z
  .union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)])
  .transform(Number)
  .nullish()
  .catch(null);
const tags = z.array(z.string()).nullish().catch(null);

const OffAnswerSchema = z.object({
  status: z.union([z.literal(0), z.literal(1)]),
  product: z
    .object({
      product_name: text,
      product_name_es: text,
      generic_name: text,
      generic_name_es: text,
      brands: text,
      product_quantity: amount,
      product_quantity_unit: text,
      serving_quantity: amount,
      serving_quantity_unit: text,
      nutriments: z
        .object({
          'energy-kcal_100g': amount,
          'energy-kj_100g': amount,
          proteins_100g: amount,
          carbohydrates_100g: amount,
          fat_100g: amount,
          fiber_100g: amount,
        })
        .nullish()
        .catch(null),
      allergens_tags: tags,
      traces_tags: tags,
    })
    .optional(),
});

/** The answer of `GET /api/v2/product/:barcode` as the lookup result. Exported for the fixtures' test. */
export function parseOffAnswer(body: unknown): OffLookup {
  const parsed = OffAnswerSchema.safeParse(body);
  if (!parsed.success) return { status: 'unavailable' };
  const { status, product } = parsed.data;
  if (status === 0 || !product) return { status: 'not_found' };
  const n = product.nutriments;
  return {
    status: 'found',
    product: {
      productNameEs: product.product_name_es,
      productName: product.product_name,
      genericNameEs: product.generic_name_es,
      genericName: product.generic_name,
      brands: product.brands,
      energyKcal100g: n?.['energy-kcal_100g'],
      energyKj100g: n?.['energy-kj_100g'],
      proteins100g: n?.proteins_100g,
      carbohydrates100g: n?.carbohydrates_100g,
      fat100g: n?.fat_100g,
      fiber100g: n?.fiber_100g,
      productQuantity: product.product_quantity,
      productQuantityUnit: product.product_quantity_unit,
      servingQuantity: product.serving_quantity,
      servingQuantityUnit: product.serving_quantity_unit,
      allergensTags: product.allergens_tags,
      tracesTags: product.traces_tags,
    },
  };
}

export interface OffClientOptions {
  fetch: typeof fetch;
  /** `AppName/Version (ContactEmail)`. */
  userAgent: string;
  timeoutMs?: number;
}

export function createOffClient(options: OffClientOptions): LookupProduct {
  const timeoutMs = options.timeoutMs ?? PRODUCT_LIMITS.timeoutMs;
  return async (barcode) => {
    try {
      const response = await options.fetch(
        `${OFF_BASE_URL}/api/v2/product/${barcode}.json?fields=${FIELDS}`,
        {
          headers: { 'user-agent': options.userAgent, accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (response.status === 404) return { status: 'not_found' };
      if (!response.ok) return { status: 'unavailable' };
      return parseOffAnswer(await response.json());
    } catch {
      // Timeout, network error, or a maintenance page instead of JSON.
      return { status: 'unavailable' };
    }
  };
}
