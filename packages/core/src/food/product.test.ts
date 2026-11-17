import { describe, expect, it } from 'vitest';
import {
  allergenNames,
  energyMismatch,
  kcalFromKj,
  per100gOutOfRange,
  productEnergyMismatch,
  productFromOff,
  type OffProductInput,
} from './product';

const nutella: OffProductInput = {
  productNameEs: 'Nutella',
  productName: 'Nutella',
  genericNameEs: 'Crema de avellanas con cacao',
  brands: 'Ferrero, Nutella',
  energyKcal100g: 539,
  energyKj100g: 2252,
  proteins100g: 6.3,
  carbohydrates100g: 57.5,
  fat100g: 30.9,
  fiber100g: 0,
  productQuantity: 400,
  productQuantityUnit: 'g',
  servingQuantity: 15,
  servingQuantityUnit: 'g',
  allergensTags: ['en:milk', 'en:nuts', 'en:soybeans'],
  tracesTags: [],
};

describe('productFromOff (spec 006 AC4)', () => {
  it('keeps the values of the source, the first brand and both servings', () => {
    expect(productFromOff(nutella)).toEqual({
      name: 'Nutella',
      brand: 'Ferrero',
      unit: 'g',
      per100g: { kcal: 539, proteinG: 6.3, carbsG: 57.5, fatG: 30.9, fiberG: 0 },
      servings: [
        { kind: 'serving', grams: 15 },
        { kind: 'package', grams: 400 },
      ],
      allergens: ['en:milk', 'en:nuts', 'en:soybeans'],
      traces: [],
    });
  });

  it('prefers the Spanish name, then the product name, then the generic ones', () => {
    const named = (over: Partial<OffProductInput>) =>
      productFromOff({
        ...nutella,
        productNameEs: null,
        productName: null,
        genericNameEs: null,
        genericName: null,
        ...over,
      })?.name ?? null;
    expect(named({ productNameEs: ' Crema  de cacao ', productName: 'Spread' })).toBe(
      'Crema de cacao',
    );
    expect(named({ productName: 'Spread', genericNameEs: 'Crema' })).toBe('Spread');
    expect(named({ genericNameEs: 'Crema', genericName: 'Cream' })).toBe('Crema');
    expect(named({ genericName: 'Cream' })).toBe('Cream');
    expect(named({ productNameEs: '   ' })).toBeNull();
    expect(named({ productName: 'x'.repeat(200) })).toHaveLength(80);
  });

  it('converts kJ when there are no kcal', () => {
    const product = productFromOff({ ...nutella, energyKcal100g: null });
    expect(product?.per100g.kcal).toBe(538.24);
    expect(kcalFromKj(4184)).toBe(1000);
  });

  it('rejects a product without energy, protein, carbohydrates or fat', () => {
    expect(productFromOff({ ...nutella, energyKcal100g: null, energyKj100g: null })).toBeNull();
    expect(productFromOff({ ...nutella, proteins100g: undefined })).toBeNull();
    expect(productFromOff({ ...nutella, carbohydrates100g: null })).toBeNull();
    expect(productFromOff({ ...nutella, fat100g: Number.NaN })).toBeNull();
  });

  it('keeps a missing fiber as null', () => {
    expect(productFromOff({ ...nutella, fiber100g: null })?.per100g.fiberG).toBeNull();
  });

  it('rejects impossible values', () => {
    expect(productFromOff({ ...nutella, energyKcal100g: 910 })).toBeNull();
    expect(productFromOff({ ...nutella, fat100g: 100.5 })).toBeNull();
    expect(productFromOff({ ...nutella, proteins100g: -1 })).toBeNull();
    expect(productFromOff({ ...nutella, fiber100g: 120 })).toBeNull();
    // 6.3 + 70 + 30.9 = 107.2 g per 100 g
    expect(productFromOff({ ...nutella, carbohydrates100g: 70 })).toBeNull();
    // Labels round each value, so a little above 100 g is accepted: 6.3 + 67 + 30.9 = 104.2
    expect(productFromOff({ ...nutella, carbohydrates100g: 67 })).not.toBeNull();
  });

  it('uses millilitres when the package or the serving is in ml', () => {
    const cola = productFromOff({
      productName: 'Coca-Cola Original',
      brands: 'Coca-Cola',
      energyKcal100g: 44,
      proteins100g: 0,
      carbohydrates100g: 10.9,
      fat100g: 0,
      productQuantity: 330,
      productQuantityUnit: 'ml',
      servingQuantity: 330,
      servingQuantityUnit: 'ml',
    });
    expect(cola?.unit).toBe('ml');
    // The serving is the whole can: one serving, not two.
    expect(cola?.servings).toEqual([{ kind: 'serving', grams: 330 }]);
    expect(cola?.allergens).toEqual([]);
  });

  it('drops servings outside 1–2000 and has none when the source gives none', () => {
    expect(
      productFromOff({ ...nutella, servingQuantity: 0, productQuantity: 5000 })?.servings,
    ).toEqual([]);
    expect(
      productFromOff({ ...nutella, servingQuantity: null, productQuantity: 400 })?.servings,
    ).toEqual([{ kind: 'package', grams: 400 }]);
  });

  it('never drops a declared allergen, whatever the form of its tag', () => {
    const product = productFromOff({
      ...nutella,
      allergensTags: ['en:milk', 'en:milk', 'leche', ' es:frutos-secos ', 'EN:NUTS', '  '],
      tracesTags: ['en:peanuts', 'de:Schalenfrüchte (keine Erdnüsse)'],
    });
    expect(product?.allergens).toEqual(['en:milk', 'leche', 'es:frutos-secos', 'EN:NUTS']);
    expect(product?.traces).toEqual(['en:peanuts', 'de:Schalenfrüchte (keine Erdnüsse)']);
    expect(productFromOff({ ...nutella, allergensTags: ['x'.repeat(200)] })?.allergens).toEqual([
      'x'.repeat(80),
    ]);
  });

  it('drops a serving or a package that is in another unit than the food', () => {
    // A cocoa powder sold in grams whose serving is "200 ml prepared": 200 is not grams of powder.
    const powder = productFromOff({
      ...nutella,
      productQuantity: 400,
      productQuantityUnit: 'g',
      servingQuantity: 200,
      servingQuantityUnit: 'ml',
    });
    expect(powder?.unit).toBe('g');
    expect(powder?.servings).toEqual([{ kind: 'package', grams: 400 }]);

    // A drink sold in millilitres with a serving stated in grams.
    const drink = productFromOff({
      ...nutella,
      productQuantity: 1000,
      productQuantityUnit: 'ml',
      servingQuantity: 100,
      servingQuantityUnit: 'g',
    });
    expect(drink?.unit).toBe('ml');
    expect(drink?.servings).toEqual([{ kind: 'package', grams: 1000 }]);
  });

  it('takes the unit of the serving when the package has none', () => {
    const product = productFromOff({
      ...nutella,
      productQuantity: null,
      productQuantityUnit: null,
      servingQuantity: 250,
      servingQuantityUnit: 'ml',
    });
    expect(product?.unit).toBe('ml');
    expect(product?.servings).toEqual([{ kind: 'serving', grams: 250 }]);
    // A size without a unit is taken to be in the food's unit.
    expect(
      productFromOff({ ...nutella, servingQuantityUnit: null, productQuantityUnit: 'cl' })
        ?.servings,
    ).toEqual([
      { kind: 'serving', grams: 15 },
      { kind: 'package', grams: 400 },
    ]);
  });

  it('accepts an oil whose kJ convert to a hair above 900 kcal', () => {
    const oil = productFromOff({
      productName: 'Aceite de oliva',
      energyKj100g: 3766,
      proteins100g: 0,
      carbohydrates100g: 0,
      fat100g: 100,
    });
    expect(oil?.per100g.kcal).toBe(900);
    expect(productFromOff({ ...nutella, energyKcal100g: 906 })).toBeNull();
  });

  it('has no brand when the source has none', () => {
    expect(productFromOff({ ...nutella, brands: '' })?.brand).toBeNull();
    expect(productFromOff({ ...nutella, brands: undefined })?.brand).toBeNull();
  });
});

describe('energyMismatch (AC5, AC10)', () => {
  const values = (kcal: number, proteinG: number, carbsG: number, fatG: number, fiberG = 0) => ({
    kcal,
    proteinG,
    carbsG,
    fatG,
    fiberG,
  });

  it('is false when the energy matches the macros', () => {
    // 4·6.3 + 4·57.5 + 9·30.9 = 533.3
    expect(productEnergyMismatch(values(539, 6.3, 57.5, 30.9))).toBe(false);
  });

  it('is true above the tolerance, in both directions', () => {
    // Macros: 400 kcal. 25 % → 300 to 500.
    expect(energyMismatch(values(520, 0, 100, 0), 0.25)).toBe(true);
    expect(energyMismatch(values(500, 0, 100, 0), 0.25)).toBe(false);
    expect(energyMismatch(values(280, 0, 100, 0), 0.25)).toBe(true);
    expect(energyMismatch(values(300, 0, 100, 0), 0.25)).toBe(false);
    expect(energyMismatch(values(310, 0, 100, 0), 0.2)).toBe(true);
  });

  it('counts fiber at 2 kcal per gram', () => {
    // 4·10 + 4·20 + 9·5 = 165; + 2·40 = 245
    expect(energyMismatch(values(245, 10, 20, 5, 40), 0.25)).toBe(false);
  });

  it('ignores small absolute differences', () => {
    expect(energyMismatch(values(1, 0, 0, 0), 0.25)).toBe(false);
    expect(energyMismatch(values(9, 0.1, 0.5, 0), 0.25)).toBe(false);
  });

  it('flags alcohol, whose energy the macros do not explain', () => {
    // Wine: about 85 kcal, almost no macros.
    expect(productEnergyMismatch(values(85, 0.1, 2.6, 0))).toBe(true);
  });
});

describe('per100gOutOfRange (AC4, AC10)', () => {
  const ok = { kcal: 400, proteinG: 10, carbsG: 50, fatG: 20, fiberG: null };

  it('accepts plausible values', () => {
    expect(per100gOutOfRange(ok)).toBeNull();
    expect(
      per100gOutOfRange({ kcal: 900, proteinG: 0, carbsG: 0, fatG: 100, fiberG: 0 }),
    ).toBeNull();
  });

  it('names the first field out of range', () => {
    expect(per100gOutOfRange({ ...ok, kcal: 900.5 })).toBe('kcal');
    expect(per100gOutOfRange({ ...ok, proteinG: 101 })).toBe('proteinG');
    expect(per100gOutOfRange({ ...ok, fiberG: -1 })).toBe('fiberG');
    expect(per100gOutOfRange({ ...ok, carbsG: 80 })).toBe('macros');
  });
});

describe('allergenNames (AC5)', () => {
  it('translates known tags and keeps unknown ones readable', () => {
    const names = { 'en:milk': 'leche', 'en:nuts': 'frutos de cáscara' };
    expect(allergenNames(['en:milk', 'en:nuts', 'en:sesame-seeds', 'es:altramuz'], names)).toEqual([
      'leche',
      'frutos de cáscara',
      'sesame seeds',
      'altramuz',
    ]);
    expect(allergenNames([], names)).toEqual([]);
  });
});
