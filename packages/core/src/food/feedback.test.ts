import {
  CATALOG_FOOD_FIELDS,
  FEEDBACK_LIMITS,
  type FeedbackObservation,
  type FeedbackReading,
  type Food,
  type MealItem,
  type MealType,
  type Nutrients,
  type RecentFood,
} from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import {
  COMPENSATION_TERMS,
  FEEDBACK_CITATIONS,
  dailyObservations,
  feedbackAvailable,
  feedbackCandidates,
  feedbackFingerprint,
  hasCompensationTerm,
  minuteOfDay,
  templateNotes,
  validateFeedback,
  type FeedbackBreakdown,
  type FeedbackDay,
  type FeedbackTargets,
} from './feedback';

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────

const TODAY = '2026-11-18';
const targets: FeedbackTargets = { kcal: 2000, proteinG: 140, carbsG: 220, fiberG: 28 };
const breakdown: FeedbackBreakdown = {
  referenceWeightKg: 80,
  trainingFocus: 'general_fitness',
  carbsMinGPerKg: null,
};
const context = { safetyFlags: [] };

const n = (over: Partial<Nutrients>): Nutrients => ({
  kcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  ...over,
});
const meal = (mealType: MealType, over: Partial<Nutrients>) => ({ mealType, nutrients: n(over) });

/** A full, balanced day: 2000 kcal, 140 g protein, 220 g carbs, 28 g fiber, in three meals. */
const balanced = [
  meal('breakfast', { kcal: 500, proteinG: 35, carbsG: 60, fiberG: 7 }),
  meal('lunch', { kcal: 800, proteinG: 55, carbsG: 90, fiberG: 11 }),
  meal('dinner', { kcal: 700, proteinG: 50, carbsG: 70, fiberG: 10 }),
];

const pastDay = (items: FeedbackDay['items'], over: Partial<FeedbackDay> = {}): FeedbackDay => ({
  localDate: '2026-11-17',
  items,
  trainingDay: false,
  ...over,
});
const today = (items: FeedbackDay['items'], over: Partial<FeedbackDay> = {}): FeedbackDay => ({
  localDate: TODAY,
  items,
  trainingDay: false,
  ...over,
});
const at = (hhmm: string) => ({ today: TODAY, minuteOfDay: minuteOfDay(hhmm) });
const LATE = at('23:00');

const kinds = (result: { observations: FeedbackObservation[] }) =>
  result.observations.map((o) => o.kind);
const only = (result: { observations: FeedbackObservation[] }, kind: string) =>
  result.observations.find((o) => o.kind === kind);

// ── AC4 state ─────────────────────────────────────────────────────────────────────────────────────

describe('dailyObservations: state and meals left (AC4)', () => {
  const lunchOnly = [meal('breakfast', { kcal: 400, proteinG: 20 })];

  it('is in progress today before 22:00 while the dinner has no items', () => {
    const result = dailyObservations(today(lunchOnly), targets, breakdown, context, at('12:30'));
    expect(result.state).toBe('in_progress');
    expect(result.mealsLeft).toEqual(['lunch', 'dinner']);
  });

  it('drops a main meal whose slot has ended, even without items', () => {
    const result = dailyObservations(today([]), targets, breakdown, context, at('17:00'));
    expect(result.mealsLeft).toEqual(['dinner']);
    const morning = dailyObservations(today([]), targets, breakdown, context, at('10:59'));
    expect(morning.mealsLeft).toEqual(['breakfast', 'lunch', 'dinner']);
  });

  it('is closed at 22:00, once the dinner has items, or for a past day', () => {
    expect(
      dailyObservations(today(lunchOnly), targets, breakdown, context, at('22:00')).state,
    ).toBe('closed');
    expect(dailyObservations(today(balanced), targets, breakdown, context, at('21:00')).state).toBe(
      'closed',
    );
    expect(
      dailyObservations(pastDay(lunchOnly), targets, breakdown, context, at('09:00')).state,
    ).toBe('closed');
  });

  it('has no meals left on a closed day', () => {
    expect(
      dailyObservations(pastDay(balanced), targets, breakdown, context, LATE).mealsLeft,
    ).toEqual([]);
  });
});

// ── AC5 incomplete ────────────────────────────────────────────────────────────────────────────────

describe('dailyObservations: an incomplete day (AC5)', () => {
  it('gives only day_incomplete with fewer than 2 meals', () => {
    const items = [meal('lunch', { kcal: 1600, proteinG: 20 })];
    expect(kinds(dailyObservations(pastDay(items), targets, breakdown, context, LATE))).toEqual([
      'day_incomplete',
    ]);
  });

  it('gives only day_incomplete below 50 % of the kcal', () => {
    const items = [meal('breakfast', { kcal: 400 }), meal('lunch', { kcal: 590 })];
    const result = dailyObservations(pastDay(items), targets, breakdown, context, LATE);
    expect(kinds(result)).toEqual(['day_incomplete']);
    expect(result.observations[0]).toEqual({
      kind: 'day_incomplete',
      numbers: {
        nutrient: null,
        eaten: null,
        target: null,
        left: null,
        mealsLeft: [],
        perMeal: [],
      },
      citation: 'own_targets',
    });
  });

  it('never applies to a day in progress', () => {
    const items = [meal('breakfast', { kcal: 300, proteinG: 10 })];
    const result = dailyObservations(today(items), targets, breakdown, context, at('11:30'));
    expect(kinds(result)).not.toContain('day_incomplete');
  });
});

// ── AC6 protein ───────────────────────────────────────────────────────────────────────────────────

describe('dailyObservations: protein (AC6)', () => {
  it('gives protein_low on a closed day below 80 %', () => {
    const items = [
      meal('breakfast', { kcal: 900, proteinG: 30, carbsG: 200, fiberG: 14 }),
      meal('dinner', { kcal: 1100, proteinG: 81, carbsG: 120, fiberG: 14 }),
    ];
    const result = dailyObservations(pastDay(items), targets, breakdown, context, LATE);
    expect(only(result, 'protein_low')).toEqual({
      kind: 'protein_low',
      numbers: {
        nutrient: 'protein',
        eaten: 111,
        target: 140,
        left: 29,
        mealsLeft: [],
        perMeal: [],
      },
      citation: 'issn_protein_2017',
    });
  });

  it('gives no protein note at 80 % or more', () => {
    const items = [
      meal('breakfast', { kcal: 900, proteinG: 30, carbsG: 200, fiberG: 14 }),
      meal('dinner', { kcal: 1100, proteinG: 82, carbsG: 120, fiberG: 14 }),
    ];
    expect(kinds(dailyObservations(pastDay(items), targets, breakdown, context, LATE))).toEqual([
      'on_track',
    ]);
  });

  it('gives protein_gap in progress with ≥ 20 g and ≥ 30 % left and a meal left', () => {
    const items = [
      meal('breakfast', { kcal: 500, proteinG: 20 }),
      meal('lunch', { kcal: 700, proteinG: 40 }),
    ];
    const result = dailyObservations(today(items), targets, breakdown, context, at('17:00'));
    expect(only(result, 'protein_gap')?.numbers).toEqual({
      nutrient: 'protein',
      eaten: 60,
      target: 140,
      left: 80,
      mealsLeft: ['dinner'],
      perMeal: [],
    });
  });

  it('gives no protein_gap below 30 % left, or without a meal left', () => {
    const near = [
      meal('breakfast', { kcal: 500, proteinG: 50 }),
      meal('lunch', { kcal: 700, proteinG: 50 }),
    ];
    expect(
      kinds(dailyObservations(today(near), targets, breakdown, context, at('17:00'))),
    ).not.toContain('protein_gap');
    // 21:59 with breakfast and lunch but no dinner: dinner still left.
    const low = [meal('breakfast', { kcal: 500, proteinG: 10 })];
    expect(
      kinds(dailyObservations(today(low), targets, breakdown, context, at('21:59'))),
    ).toContain('protein_gap');
  });

  it('gives no kcal or spread note on a day in progress', () => {
    const items = [meal('breakfast', { kcal: 300, proteinG: 10 })];
    const result = dailyObservations(
      today(items),
      targets,
      { ...breakdown, trainingFocus: 'hypertrophy' },
      context,
      at('12:00'),
    );
    expect(kinds(result).some((k) => k.startsWith('kcal') || k === 'protein_uneven')).toBe(false);
  });
});

// ── AC7 kcal ──────────────────────────────────────────────────────────────────────────────────────

describe('dailyObservations: kcal (AC7)', () => {
  const day = (kcal: number) => [
    meal('breakfast', { kcal: kcal / 2, proteinG: 70, carbsG: 110, fiberG: 14 }),
    meal('dinner', { kcal: kcal / 2, proteinG: 70, carbsG: 110, fiberG: 14 }),
  ];

  it('gives kcal_low between 50 % and 80 %', () => {
    const result = dailyObservations(pastDay(day(1400)), targets, breakdown, context, LATE);
    expect(only(result, 'kcal_low')?.numbers).toMatchObject({
      nutrient: 'kcal',
      eaten: 1400,
      target: 2000,
      left: 600,
    });
    expect(only(result, 'kcal_low')?.citation).toBe('own_targets');
    expect(kinds(dailyObservations(pastDay(day(1600)), targets, breakdown, context, LATE))).toEqual(
      ['on_track'],
    );
  });

  it('gives kcal_above above 115 %, with nothing left', () => {
    const result = dailyObservations(pastDay(day(2400)), targets, breakdown, context, LATE);
    expect(only(result, 'kcal_above')?.numbers).toMatchObject({
      eaten: 2400,
      target: 2000,
      left: 0,
    });
    expect(kinds(dailyObservations(pastDay(day(2300)), targets, breakdown, context, LATE))).toEqual(
      ['on_track'],
    );
  });

  it('never gives kcal_above to a teen', () => {
    const teen = { safetyFlags: ['teen_limited' as const] };
    expect(kinds(dailyObservations(pastDay(day(2400)), targets, breakdown, teen, LATE))).toEqual([
      'on_track',
    ]);
  });
});

// ── AC8 fiber ─────────────────────────────────────────────────────────────────────────────────────

describe('dailyObservations: fiber (AC8)', () => {
  const day = (fiber: number | null, unknownKcal = 0) => [
    meal('breakfast', { kcal: 1000 - unknownKcal, proteinG: 70, carbsG: 110, fiberG: fiber }),
    meal('dinner', { kcal: 1000, proteinG: 70, carbsG: 110, fiberG: 0 }),
    ...(unknownKcal > 0 ? [meal('lunch', { kcal: unknownKcal, fiberG: null })] : []),
  ];

  it('gives fiber_low on a closed day below 70 %', () => {
    const result = dailyObservations(pastDay(day(19)), targets, breakdown, context, LATE);
    expect(only(result, 'fiber_low')).toEqual({
      kind: 'fiber_low',
      numbers: { nutrient: 'fiber', eaten: 19, target: 28, left: 9, mealsLeft: [], perMeal: [] },
      citation: 'efsa_fibre_2010',
    });
    expect(kinds(dailyObservations(pastDay(day(20)), targets, breakdown, context, LATE))).toEqual([
      'on_track',
    ]);
  });

  it('gives no fiber note when items without fiber hold more than 25 % of the kcal', () => {
    expect(
      kinds(dailyObservations(pastDay(day(5, 501)), targets, breakdown, context, LATE)),
    ).not.toContain('fiber_low');
    expect(
      kinds(dailyObservations(pastDay(day(5, 500)), targets, breakdown, context, LATE)),
    ).toContain('fiber_low');
  });

  it('gives fiber_gap in progress with ≥ 10 g and ≥ 50 % left and a meal left', () => {
    const items = [meal('breakfast', { kcal: 500, proteinG: 40, fiberG: 4 })];
    const result = dailyObservations(today(items), targets, breakdown, context, at('12:00'));
    expect(only(result, 'fiber_gap')?.numbers).toMatchObject({
      eaten: 4,
      left: 24,
      mealsLeft: ['lunch', 'dinner'],
    });
    const enough = [meal('breakfast', { kcal: 500, proteinG: 100, fiberG: 15 })];
    expect(
      kinds(dailyObservations(today(enough), targets, breakdown, context, at('12:00'))),
    ).not.toContain('fiber_gap');
  });
});

// ── AC9 protein spread ────────────────────────────────────────────────────────────────────────────

describe('dailyObservations: protein spread (AC9)', () => {
  const muscle: FeedbackBreakdown = { ...breakdown, trainingFocus: 'hypertrophy' };
  // 0.25 g/kg × 80 kg = 20 g per meal.
  const uneven = [
    meal('breakfast', { kcal: 500, proteinG: 10, carbsG: 70, fiberG: 9 }),
    meal('lunch', { kcal: 700, proteinG: 15, carbsG: 80, fiberG: 10 }),
    meal('dinner', { kcal: 800, proteinG: 95, carbsG: 70, fiberG: 9 }),
  ];

  it('gives protein_uneven with the grams per meal for muscle and strength', () => {
    for (const trainingFocus of ['hypertrophy', 'strength'] as const) {
      const result = dailyObservations(
        pastDay(uneven),
        targets,
        { ...breakdown, trainingFocus },
        context,
        LATE,
      );
      expect(only(result, 'protein_uneven')).toEqual({
        kind: 'protein_uneven',
        numbers: {
          nutrient: 'protein',
          eaten: 120,
          target: 140,
          left: 20,
          mealsLeft: [],
          perMeal: [
            { mealType: 'breakfast', grams: 10 },
            { mealType: 'lunch', grams: 15 },
            { mealType: 'dinner', grams: 95 },
          ],
        },
        citation: 'issn_protein_2017',
      });
    }
  });

  it('is not given for other focuses, below 80 % protein, or when two meals reach the threshold', () => {
    expect(kinds(dailyObservations(pastDay(uneven), targets, breakdown, context, LATE))).toEqual([
      'on_track',
    ]);
    const low = uneven.map((m) => ({
      ...m,
      nutrients: { ...m.nutrients, proteinG: m.nutrients.proteinG / 2 },
    }));
    expect(kinds(dailyObservations(pastDay(low), targets, muscle, context, LATE))).not.toContain(
      'protein_uneven',
    );
    const two = [
      meal('breakfast', { kcal: 500, proteinG: 20, carbsG: 70, fiberG: 9 }),
      meal('lunch', { kcal: 700, proteinG: 5, carbsG: 80, fiberG: 10 }),
      meal('dinner', { kcal: 800, proteinG: 95, carbsG: 70, fiberG: 9 }),
    ];
    expect(kinds(dailyObservations(pastDay(two), targets, muscle, context, LATE))).toEqual([
      'on_track',
    ]);
  });

  it('uses at least 20 g per meal for a light reference weight', () => {
    const light = { ...muscle, referenceWeightKg: 50 }; // 12.5 g → 20 g
    const two = [
      meal('breakfast', { kcal: 500, proteinG: 15, carbsG: 70, fiberG: 9 }),
      meal('lunch', { kcal: 700, proteinG: 15, carbsG: 80, fiberG: 10 }),
      meal('dinner', { kcal: 800, proteinG: 90, carbsG: 70, fiberG: 9 }),
    ];
    expect(kinds(dailyObservations(pastDay(two), targets, light, context, LATE))).toContain(
      'protein_uneven',
    );
  });
});

// ── AC10 carbohydrates ────────────────────────────────────────────────────────────────────────────

describe('dailyObservations: carbohydrates on a training day (AC10)', () => {
  const day = (carbs: number) => [
    meal('breakfast', { kcal: 1000, proteinG: 70, carbsG: carbs / 2, fiberG: 14 }),
    meal('dinner', { kcal: 1000, proteinG: 70, carbsG: carbs / 2, fiberG: 14 }),
  ];

  it('gives carbs_low_training below 75 % only with the chip on', () => {
    const result = dailyObservations(
      pastDay(day(160), { trainingDay: true }),
      targets,
      breakdown,
      context,
      LATE,
    );
    expect(only(result, 'carbs_low_training')).toEqual({
      kind: 'carbs_low_training',
      numbers: { nutrient: 'carbs', eaten: 160, target: 220, left: 60, mealsLeft: [], perMeal: [] },
      citation: 'acsm_and_dc_2016',
    });
    expect(kinds(dailyObservations(pastDay(day(160)), targets, breakdown, context, LATE))).toEqual([
      'on_track',
    ]);
    expect(
      kinds(
        dailyObservations(
          pastDay(day(166), { trainingDay: true }),
          targets,
          breakdown,
          context,
          LATE,
        ),
      ),
    ).toEqual(['on_track']);
  });

  it('gives carbs_low_training below the sport minimum, with the minimum as target', () => {
    const sport: FeedbackBreakdown = {
      referenceWeightKg: 80,
      trainingFocus: 'sport_performance',
      carbsMinGPerKg: 3,
    };
    // 3 g/kg × 80 = 240 g minimum; 200 g is above 75 % of 220 but below the minimum.
    const result = dailyObservations(
      pastDay(day(200), { trainingDay: true }),
      targets,
      sport,
      context,
      LATE,
    );
    expect(only(result, 'carbs_low_training')?.numbers).toMatchObject({
      eaten: 200,
      target: 240,
      left: 40,
    });
    expect(
      kinds(dailyObservations(pastDay(day(200)), targets, sport, context, LATE)),
    ).not.toContain('carbs_low_training');
  });

  it('gives carbs_gap_training in progress with ≥ 50 g and ≥ 40 % left and a meal left', () => {
    const items = [meal('breakfast', { kcal: 500, proteinG: 100, carbsG: 60, fiberG: 20 })];
    const result = dailyObservations(
      today(items, { trainingDay: true }),
      targets,
      breakdown,
      context,
      at('12:00'),
    );
    expect(only(result, 'carbs_gap_training')?.numbers).toMatchObject({
      eaten: 60,
      left: 160,
      mealsLeft: ['lunch', 'dinner'],
    });
    expect(
      kinds(dailyObservations(today(items), targets, breakdown, context, at('12:00'))),
    ).not.toContain('carbs_gap_training');
  });
});

// ── AC11 order and cap ────────────────────────────────────────────────────────────────────────────

describe('dailyObservations: order, cap and on_track (AC11)', () => {
  it('keeps at most 3 observations in the fixed order', () => {
    const items = [
      meal('breakfast', { kcal: 600, proteinG: 15, carbsG: 50, fiberG: 3 }),
      meal('dinner', { kcal: 700, proteinG: 80, carbsG: 60, fiberG: 3 }),
    ];
    const result = dailyObservations(
      pastDay(items, { trainingDay: true }),
      targets,
      { ...breakdown, trainingFocus: 'strength' },
      context,
      LATE,
    );
    // protein_low, carbs_low_training, fiber_low, kcal_low → kcal_low is dropped.
    expect(kinds(result)).toEqual(['protein_low', 'carbs_low_training', 'fiber_low']);
  });

  it('orders kcal_low before protein_uneven before kcal_above', () => {
    const items = [
      meal('breakfast', { kcal: 600, proteinG: 10, carbsG: 110, fiberG: 14 }),
      meal('dinner', { kcal: 700, proteinG: 110, carbsG: 110, fiberG: 14 }),
    ];
    expect(
      kinds(
        dailyObservations(
          pastDay(items),
          targets,
          { ...breakdown, trainingFocus: 'hypertrophy' },
          context,
          LATE,
        ),
      ),
    ).toEqual(['kcal_low', 'protein_uneven']);
  });

  it('gives a single on_track when nothing stands out', () => {
    const result = dailyObservations(pastDay(balanced), targets, breakdown, context, LATE);
    expect(result.observations).toEqual([
      {
        kind: 'on_track',
        numbers: {
          nutrient: null,
          eaten: null,
          target: null,
          left: null,
          mealsLeft: [],
          perMeal: [],
        },
        citation: 'own_targets',
      },
    ]);
  });
});

// ── AC2 availability ──────────────────────────────────────────────────────────────────────────────

describe('feedbackAvailable (AC2)', () => {
  it('needs numeric targets and no ed_soft_stop', () => {
    expect(feedbackAvailable([], true)).toBe(true);
    expect(feedbackAvailable(['teen_limited'], true)).toBe(true);
    expect(feedbackAvailable(['ed_soft_stop'], true)).toBe(false);
    expect(feedbackAvailable(['pregnancy'], false)).toBe(false);
  });
});

// ── AC12 candidates ───────────────────────────────────────────────────────────────────────────────

const SERVING = (i: number) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`;
const food = (i: number, per100g: Partial<Nutrients>, servingGrams: number | null = 100): Food => ({
  id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`,
  key: `food-${i}`,
  name: `Food ${i}`,
  per100g: n(per100g),
  servings:
    servingGrams === null ? [] : [{ id: SERVING(i), label: `1 ración ${i}`, grams: servingGrams }],
  source: 'bedca',
  ...CATALOG_FOOD_FIELDS,
});
const recent = (f: Food, grams: number): RecentFood => ({
  food: f,
  lastPortion: { kind: 'grams', grams },
});

const obs = (kind: FeedbackObservation['kind']): FeedbackObservation => ({
  kind,
  numbers: { nutrient: null, eaten: null, target: null, left: null, mealsLeft: [], perMeal: [] },
  citation: FEEDBACK_CITATIONS[kind],
});

describe('feedbackCandidates (AC12)', () => {
  const chicken = food(1, { kcal: 110, proteinG: 23 }); // 150 g → 34.5 g protein
  const yogurt = food(2, { kcal: 60, proteinG: 10, fiberG: 0 }, 125); // serving → 12.5 g
  const lentils = food(3, { kcal: 120, proteinG: 9, carbsG: 20, fiberG: 8 }, 250);
  const nuts = food(4, { kcal: 600, proteinG: 20, fiberG: 7 }); // 200 g → 1200 kcal, dropped
  const rice = food(5, { kcal: 130, proteinG: 2.7, carbsG: 28, fiberG: null });

  const sources = {
    recents: [recent(chicken, 150), recent(nuts, 200), recent(rice, 200)],
    favourites: [yogurt, lentils, chicken],
  };

  it('ranks the user foods by the missing nutrient per portion and drops big portions', () => {
    const result = feedbackCandidates([obs('protein_low')], sources, 2000);
    expect(result.protein_low?.map((c) => [c.food.id, c.amount])).toEqual([
      [chicken.id, 34.5],
      [lentils.id, 22.5],
      [yogurt.id, 12.5],
      [rice.id, 5.4],
    ]);
    // Recents keep their last portion; favourites use their first serving.
    expect(result.protein_low?.[0]?.portion).toEqual({ kind: 'grams', grams: 150 });
    expect(result.protein_low?.[1]?.portion).toEqual({
      kind: 'serving',
      servingId: SERVING(3),
      servings: 1,
    });
    expect(result.protein_low?.[0]?.kcal).toBe(165);
  });

  it('skips foods without the nutrient and gives refs unique across observations', () => {
    const result = feedbackCandidates([obs('protein_gap'), obs('fiber_low')], sources, 2000);
    expect(result.fiber_low?.map((c) => c.food.id)).toEqual([lentils.id]);
    const refs = [...(result.protein_gap ?? []), ...(result.fiber_low ?? [])].map((c) => c.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('drops portions that bring almost none of the missing nutrient', () => {
    const egg = food(30, { kcal: 140, proteinG: 12.7, carbsG: 0.3 }); // 100 g → 0.3 g carbs
    const bread = food(31, { kcal: 250, proteinG: 4.9, carbsG: 41, fiberG: 1.4 }); // 100 g
    const result = feedbackCandidates(
      [obs('carbs_gap_training'), obs('protein_gap'), obs('fiber_gap')],
      { recents: [recent(egg, 100), recent(bread, 100)], favourites: [] },
      2000,
    );
    expect(result.carbs_gap_training?.map((c) => c.food.id)).toEqual([bread.id]);
    // 4.9 g of protein and 1.4 g of fiber are below the minimums (5 g, 1.5 g).
    expect(result.protein_gap?.map((c) => c.food.id)).toEqual([egg.id]);
    expect(result.fiber_gap).toEqual([]);
  });

  it('keeps at most 5 candidates and none for observations food cannot fix', () => {
    const many = Array.from({ length: 8 }, (_, i) => food(10 + i, { kcal: 100, proteinG: 5 + i }));
    const result = feedbackCandidates(
      [obs('protein_low'), obs('kcal_low'), obs('day_incomplete')],
      { recents: many.map((f) => recent(f, 100)), favourites: [] },
      2000,
    );
    expect(result.protein_low).toHaveLength(FEEDBACK_LIMITS.candidatesPerObservation);
    expect(result.protein_low?.[0]?.food.id).toBe(many[7]?.id);
    expect(result.kcal_low).toBeUndefined();
    expect(result.day_incomplete).toBeUndefined();
  });
});

// ── AC14 validation ───────────────────────────────────────────────────────────────────────────────

describe('validateFeedback (AC14)', () => {
  const chicken = food(1, { kcal: 110, proteinG: 23 });
  const yogurt = food(2, { kcal: 60, proteinG: 10 });
  const lentils = food(3, { kcal: 120, proteinG: 9, fiberG: 8 });
  const observations = [obs('protein_gap'), obs('fiber_gap')];
  const candidates = feedbackCandidates(
    observations,
    { recents: [recent(chicken, 150), recent(yogurt, 125), recent(lentils, 200)], favourites: [] },
    2000,
  );
  const ref = (kind: 'protein_gap' | 'fiber_gap', foodId: string) =>
    candidates[kind]?.find((c) => c.food.id === foodId)?.ref ?? 'missing';

  const reading = (notes: FeedbackReading['notes']): FeedbackReading => ({ notes });

  it('keeps valid AI notes with their suggestions, in the order of the observations', () => {
    const notes = validateFeedback(
      reading([
        {
          observation: 'fiber_gap',
          text: 'Unas lentejas en la cena suman fibra.',
          suggestionRefs: [ref('fiber_gap', lentils.id)],
        },
        {
          observation: 'protein_gap',
          text: 'Te falta proteína para la cena: un poco de pollo o un yogur ayudan.',
          suggestionRefs: [ref('protein_gap', chicken.id), ref('protein_gap', yogurt.id)],
        },
      ]),
      observations,
      candidates,
    );
    expect(notes.map((note) => [note.observation.kind, note.source])).toEqual([
      ['protein_gap', 'ai'],
      ['fiber_gap', 'ai'],
    ]);
    expect(notes[0]?.text).toBe(
      'Te falta proteína para la cena: un poco de pollo o un yogur ayudan.',
    );
    expect(notes[0]?.suggestions.map((s) => s.food.id)).toEqual([chicken.id, yogurt.id]);
    expect(notes[0]?.suggestions[0]?.portion).toEqual({ kind: 'grams', grams: 150 });
  });

  it('falls back to the fixed wording for digits, long texts and compensation terms', () => {
    const bad = [
      'Te faltan 80 g de proteína.',
      'x'.repeat(FEEDBACK_LIMITS.textMax + 1),
      'Mañana puedes saltarte la cena para compensar.',
      'Try to eat less tomorrow.',
      '   ',
    ];
    for (const text of bad) {
      const [note] = validateFeedback(
        reading([{ observation: 'protein_gap', text, suggestionRefs: [] }]),
        [obs('protein_gap')],
        candidates,
      );
      expect(note?.source).toBe('template');
      expect(note?.text).toBeNull();
    }
  });

  it('drops notes for observations core did not produce and suggestions not among the candidates', () => {
    const notes = validateFeedback(
      reading([
        { observation: 'kcal_above', text: 'Un día no cambia la tendencia.', suggestionRefs: [] },
        {
          observation: 'protein_gap',
          text: 'Algo de pollo en la cena.',
          // A fiber ref, an unknown ref, a duplicate and a third one are dropped.
          suggestionRefs: [
            ref('fiber_gap', lentils.id),
            'c99',
            ref('protein_gap', chicken.id),
            ref('protein_gap', chicken.id),
            ref('protein_gap', yogurt.id),
            ref('protein_gap', lentils.id),
          ],
        },
        { observation: 'protein_gap', text: 'Otra nota.', suggestionRefs: [] },
      ]),
      [obs('protein_gap')],
      candidates,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toBe('Algo de pollo en la cena.');
    expect(notes[0]?.suggestions.map((s) => s.food.id)).toEqual([chicken.id, yogurt.id]);
  });

  it('adds the fixed wording, with core’s best candidates, for an observation the AI left out', () => {
    const notes = validateFeedback(reading([]), observations, candidates);
    expect(notes.map((note) => note.source)).toEqual(['template', 'template']);
    expect(notes[0]?.suggestions.map((s) => s.food.id)).toEqual([chicken.id, lentils.id]);
  });

  it('keeps no suggestions on notes food cannot fix', () => {
    const notes = templateNotes([obs('kcal_above')], {});
    expect(notes).toEqual([
      { observation: obs('kcal_above'), text: null, source: 'template', suggestions: [] },
    ]);
  });
});

describe('the compensation term list (AC14)', () => {
  it('catches restriction and compensation in es and en, accents or not', () => {
    for (const text of [
      'Sáltate la merienda',
      'saltar una comida',
      'haz ayuno mañana',
      'sal a correr para quemarlo',
      'compénsalo mañana',
      'come menos mañana',
      'skip dinner',
      'try fasting',
      'burn it off at the gym',
      'compensate tomorrow',
      'purge',
      'eat less tomorrow',
      'make up for it',
    ]) {
      expect(hasCompensationTerm(text), text).toBe(true);
    }
  });

  it('does not catch normal food words', () => {
    for (const text of [
      'Un desayuno con yogur',
      'A good breakfast helps',
      'Unas lentejas en la comida',
      'Añade algo de queso fresco',
    ]) {
      expect(hasCompensationTerm(text), text).toBe(false);
    }
    expect(COMPENSATION_TERMS.length).toBeGreaterThan(10);
  });
});

// ── AC17 fingerprint ──────────────────────────────────────────────────────────────────────────────

describe('feedbackFingerprint (AC17)', () => {
  const item = (id: string, recordedAt: string): Pick<MealItem, 'id' | 'recordedAt'> => ({
    id,
    recordedAt,
  });
  const a = item('00000000-0000-4000-8000-0000000000a1', '2026-11-18T10:00:00.000Z');
  const b = item('00000000-0000-4000-8000-0000000000b2', '2026-11-18T13:00:00+01:00');

  it('does not depend on the order or the format of recordedAt', () => {
    expect(feedbackFingerprint([a, b])).toBe(feedbackFingerprint([b, a]));
    expect(feedbackFingerprint([a, item(b.id, '2026-11-18T12:00:00Z')])).toBe(
      feedbackFingerprint([a, b]),
    );
  });

  it('changes when an item is added, edited or deleted', () => {
    const base = feedbackFingerprint([a, b]);
    expect(feedbackFingerprint([a])).not.toBe(base);
    expect(feedbackFingerprint([a, item(b.id, '2026-11-18T12:00:01Z')])).not.toBe(base);
    expect(feedbackFingerprint([])).not.toBe(feedbackFingerprint([a]));
  });
});

describe('minuteOfDay', () => {
  it('reads HH:mm', () => {
    expect(minuteOfDay('00:00')).toBe(0);
    expect(minuteOfDay('22:00')).toBe(1320);
    expect(minuteOfDay('07:05')).toBe(425);
  });
});
