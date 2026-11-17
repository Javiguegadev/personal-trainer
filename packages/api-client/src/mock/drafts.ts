import type { Food, MealReading, MealReadingItem } from '@pt/contracts';

/**
 * The mock's stand-in for the meal model (spec 007): no AI, a fixed reading of a sentence or a photo
 * that goes through the same `mealDraft` of `@pt/core` as the API. Good enough for the E2E journeys
 * and for trying the draft screen without spending money.
 */

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  medio: 0.5,
  media: 0.5,
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  half: 0.5,
};

const MEASURE =
  /^(vasos?|platos?|tazas?|rebanadas?|cucharadas?|piezas?|glass(es)?|cups?|slices?)\s+(de|of)\s+/;

const item = (
  over: Partial<MealReadingItem> & Pick<MealReadingItem, 'mention'>,
): MealReadingItem => ({
  foodId: null,
  servingId: null,
  servings: null,
  grams: null,
  confidence: 'high',
  quantityAssumed: false,
  inferred: false,
  ...over,
});

/**
 * A sentence split at commas, "y" and "+": each part may start with a count ("dos", "2", "medio") or
 * hold grams ("200 g", "250 ml"), and the rest is searched (`find`, the mock's own search). A part
 * nothing matches is left unresolved; a sentence where nothing matches has no food.
 */
export function mockTextReading(text: string, find: (query: string) => Food | null): MealReading {
  const parts = text
    .toLowerCase()
    .split(/,|;|\s+y\s+|\s+and\s+|\s*\+\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const items = parts.map((mention) => {
    let rest = mention;
    let grams: number | null = null;
    let count: number | null = null;
    const weight = /(\d+(?:[.,]\d+)?)\s*(g|gr|gramos|ml)\b/.exec(rest);
    if (weight?.[1]) {
      grams = Number(weight[1].replace(',', '.'));
      rest = rest.replace(weight[0], ' ');
    }
    const lead = /^(\d+(?:[.,]\d+)?|[a-záéíóú]+)\s+/.exec(rest.trim());
    const leadValue = lead?.[1];
    if (leadValue) {
      const n = /^\d/.test(leadValue)
        ? Number(leadValue.replace(',', '.'))
        : NUMBER_WORDS[leadValue];
      if (n !== undefined) {
        count = n;
        rest = rest.trim().slice(lead[0].length);
      }
    }
    const query = rest
      .trim()
      .replace(/^(de|of)\s+/, '')
      .replace(MEASURE, '')
      .trim();
    const food = query.length >= 2 ? find(query) : null;
    if (!food) return item({ mention });
    return item({
      mention,
      foodId: food.id,
      grams,
      servingId: grams === null && count !== null ? (food.servings[0]?.id ?? null) : null,
      servings: grams === null ? count : null,
      quantityAssumed: grams === null && count === null,
    });
  });
  if (!items.some((i) => i.foodId !== null)) return { status: 'not_food', items: [] };
  return { status: 'ok', items };
}

/** Images shorter than this (a few pixels) count as "no food", as the label mock does. */
export const MOCK_NOT_FOOD_BELOW = 2000;

/**
 * A plate photo: always two fried eggs with chips, and the probable oil (AC5); a tiny image has no
 * food. `byKey` finds a food of the mock catalog.
 */
export function mockPhotoReading(
  dataLength: number,
  byKey: (key: string) => Food | null,
): MealReading {
  if (dataLength < MOCK_NOT_FOOD_BELOW) return { status: 'not_food', items: [] };
  const egg = byKey('d-huevo-plancha');
  const chips = byKey('b-patatas-fritas');
  const oil = byKey('f-aceite-oliva-virgen-extra');
  return {
    status: 'ok',
    items: [
      item({
        mention: 'huevos fritos',
        foodId: egg?.id ?? null,
        servingId: egg?.servings[0]?.id ?? null,
        servings: 2,
        confidence: 'high',
      }),
      item({
        mention: 'patatas fritas',
        foodId: chips?.id ?? null,
        grams: 150,
        confidence: 'medium',
      }),
      item({
        mention: 'aceite',
        foodId: oil?.id ?? null,
        servingId: oil?.servings[0]?.id ?? null,
        servings: 1,
        confidence: 'low',
        inferred: true,
      }),
    ],
  };
}
