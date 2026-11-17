/**
 * Products the mock backend "finds" by barcode (spec 006): ten real answers of Open Food Facts, recorded
 * on 2026-11-16, in the shape `productFromOff` reads. Any other valid code is unknown, except
 * `MOCK_INCOMPLETE_BARCODE`, whose product has no usable values.
 */
import { CATALOG_FOOD_FIELDS, type Food, type Locale } from '@pt/contracts';
import { productEnergyMismatch, productFromOff, type OffProductInput } from '@pt/core';

const product = (
  productNameEs: string,
  brands: string,
  [energyKcal100g, proteins100g, carbohydrates100g, fat100g, fiber100g]: [
    number,
    number,
    number,
    number,
    number | null,
  ],
  [productQuantity, servingQuantity, unit]: [number | null, number | null, 'g' | 'ml'],
  allergensTags: string[] = [],
  tracesTags: string[] = [],
): OffProductInput => ({
  productNameEs,
  brands,
  energyKcal100g,
  proteins100g,
  carbohydrates100g,
  fat100g,
  fiber100g,
  productQuantity,
  productQuantityUnit: unit,
  servingQuantity,
  servingQuantityUnit: unit,
  allergensTags,
  tracesTags,
});

export const MOCK_PRODUCTS: Record<string, OffProductInput> = {
  '3017620422003': product(
    'Nutella',
    'Ferrero',
    [539, 6.3, 57.5, 30.9, 0],
    [400, 15, 'g'],
    ['en:milk', 'en:nuts', 'en:soybeans'],
  ),
  '5449000214911': product('Coca-Cola', 'Coca-Cola', [42, 0, 10.6, 0, null], [330, 330, 'ml']),
  '5449000131805': product('Coca Cola Zero', 'Coca-Cola', [0, 0, 0, 0, null], [330, 330, 'ml']),
  '7622210449283': product(
    'Príncipe Galletas de Chocolate',
    'LU',
    [467, 6.3, 69, 17, 4],
    [300, 20, 'g'],
    ['en:gluten', 'en:milk', 'en:soybeans'],
    ['en:eggs', 'en:nuts'],
  ),
  '5410041001204': product(
    'Tuc Original',
    'Mondelēz',
    [482, 8.3, 67, 19, 2.4],
    [100, 30, 'g'],
    ['en:gluten'],
  ),
  '5411188112709': product(
    'Sin Azúcar Almendras',
    'Alpro',
    [15, 0.5, 0, 1.1, 0.3],
    [1000, 200, 'ml'],
    ['en:nuts'],
  ),
  '8480000671400': product(
    'Crema de cacahuete',
    'Hacendado',
    [618, 30, 7, 50, 9.9],
    [475, null, 'g'],
    ['en:peanuts'],
  ),
  '80052760': product(
    'Kinder Bueno',
    'Kinder',
    [575, 8.6, 52, 37, 2],
    [43, 21.5, 'g'],
    ['en:gluten', 'en:milk', 'en:nuts', 'en:soybeans'],
  ),
  '4008713756661': product(
    'Copos de avena',
    'Brüggen',
    [375, 14, 59, 7, 10],
    [500, 40, 'g'],
    ['en:gluten'],
  ),
  // The energy of wine comes from its alcohol: it gets the "check the package" note (AC5).
  '8410261211015': product(
    'Vino tinto crianza',
    'Bodega de prueba',
    [85, 0.1, 2.6, 0, null],
    [750, 150, 'ml'],
  ),
};

/** A product Open Food Facts knows without energy and macros (AC4, AC6). */
export const MOCK_INCOMPLETE_BARCODE = '3033710065967';

/** Stable ids, so a reload keeps the mock food log valid: the barcode fills the end of a UUID. */
const productId = (barcode: string, group = 'b', index = 0) => {
  const digits = barcode.padStart(13, '0');
  return `0000000${group}-000${index}-4000-a00${digits[0]}-${digits.slice(1)}`;
};

const SERVING_LABELS = {
  serving: { es: '1 ración', en: '1 serving' },
  package: { es: '1 envase', en: '1 package' },
} as const;

/** The product of a barcode as a food, `incomplete`, or null when it is unknown. */
export function mockProduct(barcode: string, locale: Locale): Food | 'incomplete' | null {
  if (barcode === MOCK_INCOMPLETE_BARCODE) return 'incomplete';
  const input = MOCK_PRODUCTS[barcode];
  const scanned = input ? productFromOff(input) : null;
  if (!scanned) return null;
  return {
    ...CATALOG_FOOD_FIELDS,
    id: productId(barcode),
    key: `off-${barcode}`,
    name: scanned.name,
    per100g: scanned.per100g,
    servings: scanned.servings.map((s, index) => ({
      id: productId(barcode, 'c', index),
      label: SERVING_LABELS[s.kind][locale],
      grams: s.grams,
    })),
    source: 'open-food-facts',
    origin: 'off',
    unit: scanned.unit,
    brand: scanned.brand,
    barcode,
    allergens: scanned.allergens,
    traces: scanned.traces,
    sourceUrl: `https://world.openfoodfacts.org/product/${barcode}`,
    energyMismatch: productEnergyMismatch(scanned.per100g),
  };
}

const PRODUCT_IDS = new Map(Object.keys(MOCK_PRODUCTS).map((code) => [productId(code), code]));

/** The product with that food id, or null. */
export function mockProductById(id: string, locale: Locale): Food | null {
  const barcode = PRODUCT_IDS.get(id);
  const food = barcode ? mockProduct(barcode, locale) : null;
  return food && food !== 'incomplete' ? food : null;
}
