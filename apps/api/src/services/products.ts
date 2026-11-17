import { PRODUCT_LIMITS } from '@pt/contracts';
import { isInStoreBarcode, productFromOff, type ScannedProduct } from '@pt/core';
import type { CatalogFood, Deps, ProductWrite } from '../deps';
import { createRateLimiter } from './rate-limit';

export type BarcodeLookup =
  | { status: 'found'; food: CatalogFood }
  | { status: 'not_found' | 'incomplete' | 'unavailable' | 'rate_limited' };

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const SERVING_LABELS = {
  serving: { labelEs: '1 ración', labelEn: '1 serving' },
  package: { labelEs: '1 envase', labelEn: '1 package' },
} as const;

function toProductWrite(barcode: string, product: ScannedProduct): ProductWrite {
  return {
    barcode,
    name: product.name,
    brand: product.brand,
    unit: product.unit,
    per100g: product.per100g,
    servings: product.servings.map((s) => ({ ...SERVING_LABELS[s.kind], grams: s.grams })),
    allergens: product.allergens,
    traces: product.traces,
  };
}

/**
 * The food for a scanned barcode (spec 006 AC3, AC6, AC7), in this order: the user's own food; the
 * product cached less than 90 days ago; Open Food Facts, whose answer is stored. A code that gave
 * nothing is not asked again for 24 hours. When Open Food Facts cannot be asked (down, limit reached)
 * a product cached long ago is still better than nothing, so it is returned.
 */
export function createBarcodeLookup(deps: Pick<Deps, 'store' | 'lookupProduct' | 'now'>) {
  const limiter = createRateLimiter(PRODUCT_LIMITS.lookupsPerMinute, 60_000);

  return async function lookupBarcode(userId: string, barcode: string): Promise<BarcodeLookup> {
    const now = deps.now();
    const { own, product } = await deps.store.findFoodsByBarcode(userId, barcode);
    if (own) return { status: 'found', food: own };
    const cacheMs = PRODUCT_LIMITS.cacheDays * DAY_MS;
    const fresh =
      product?.fetchedAt != null && now.getTime() - Date.parse(product.fetchedAt) < cacheMs;
    if (product && fresh) return { status: 'found', food: product };
    const fallback = (status: Exclude<BarcodeLookup['status'], 'found'>): BarcodeLookup =>
      product ? { status: 'found', food: product } : { status };

    // Printed by the shop (weighed products, coupons): no database knows them.
    if (isInStoreBarcode(barcode)) return fallback('not_found');
    const since = new Date(now.getTime() - PRODUCT_LIMITS.missHours * HOUR_MS);
    const miss = await deps.store.getBarcodeMiss(barcode, since);
    if (miss) return fallback(miss);
    if (!limiter.allow(userId, now.getTime())) return fallback('rate_limited');

    const answer = await deps.lookupProduct(barcode);
    if (answer.status === 'unavailable') return fallback('unavailable');
    const scanned = answer.status === 'found' ? productFromOff(answer.product) : null;
    if (!scanned) {
      const reason = answer.status === 'found' ? 'incomplete' : 'not_found';
      await deps.store.recordBarcodeMiss(barcode, reason, now);
      return fallback(reason);
    }
    return {
      status: 'found',
      food: await deps.store.saveProduct(toProductWrite(barcode, scanned), now),
    };
  };
}
