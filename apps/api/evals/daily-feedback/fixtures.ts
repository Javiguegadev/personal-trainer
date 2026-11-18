/**
 * Fixtures of the daily feedback eval (spec 008 AC19): profiles, the foods each one logs, and day
 * scenarios built to produce every observation kind. The cases are their combinations, both locales.
 */
import {
  CATALOG_FOOD_FIELDS,
  type DietType,
  type Food,
  type Locale,
  type MealType,
  type Nutrients,
  type RecentFood,
  type SafetyFlag,
  type TrainingFocus,
} from '@pt/contracts';
import type { FeedbackBreakdown, FeedbackTargets } from '@pt/core';

let nextId = 1;
const uuid = () => `e0000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;

function food(
  name: string,
  nameEn: string,
  per100g: Partial<Nutrients>,
  serving: [string, string, number] | null,
  tags: string[],
): Food & { nameEn: string; servingEn: string | null; tags: string[] } {
  return {
    id: uuid(),
    key: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    nameEn,
    per100g: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, ...per100g },
    servings: serving ? [{ id: uuid(), label: serving[0], grams: serving[2] }] : [],
    servingEn: serving?.[1] ?? null,
    source: 'eval',
    ...CATALOG_FOOD_FIELDS,
    tags,
  };
}

/** Tags: `meat`, `fish`, `dairy`, `egg`, `nuts`. A vegetarian never logs meat or fish, and so on. */
export const FOODS = [
  food(
    'Pechuga de pollo a la plancha',
    'Grilled chicken breast',
    { kcal: 150, proteinG: 30, fatG: 3 },
    null,
    ['meat'],
  ),
  food('Salmón a la plancha', 'Grilled salmon', { kcal: 200, proteinG: 22, fatG: 12 }, null, [
    'fish',
  ]),
  food(
    'Atún en lata al natural',
    'Canned tuna in water',
    { kcal: 110, proteinG: 25, fatG: 1 },
    ['1 lata', '1 can', 80],
    ['fish'],
  ),
  food(
    'Yogur griego natural',
    'Plain Greek yogurt',
    { kcal: 120, proteinG: 9, carbsG: 4, fatG: 8 },
    ['1 yogur', '1 yogurt', 125],
    ['dairy'],
  ),
  food(
    'Queso fresco batido',
    'Quark',
    { kcal: 60, proteinG: 8, carbsG: 4, fatG: 0.2 },
    ['1 tarrina', '1 tub', 250],
    ['dairy'],
  ),
  food(
    'Huevo',
    'Egg',
    { kcal: 140, proteinG: 12.7, carbsG: 0.3, fatG: 9.8 },
    ['1 huevo mediano', '1 medium egg', 55],
    ['egg'],
  ),
  food(
    'Tofu firme',
    'Firm tofu',
    { kcal: 145, proteinG: 15, carbsG: 2, fatG: 9, fiberG: 2 },
    null,
    [],
  ),
  food(
    'Lentejas cocidas',
    'Cooked lentils',
    { kcal: 115, proteinG: 9, carbsG: 17, fatG: 0.4, fiberG: 8 },
    ['1 plato', '1 plate', 250],
    [],
  ),
  food(
    'Garbanzos cocidos',
    'Cooked chickpeas',
    { kcal: 140, proteinG: 8, carbsG: 20, fatG: 2.5, fiberG: 7 },
    ['1 plato', '1 plate', 250],
    [],
  ),
  food(
    'Arroz blanco cocido',
    'Cooked white rice',
    { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, fiberG: 0.4 },
    ['1 plato', '1 plate', 200],
    [],
  ),
  food(
    'Pasta cocida',
    'Cooked pasta',
    { kcal: 155, proteinG: 5.5, carbsG: 30, fatG: 0.9, fiberG: 1.8 },
    ['1 plato', '1 plate', 220],
    [],
  ),
  food(
    'Pan integral',
    'Wholemeal bread',
    { kcal: 250, proteinG: 10, carbsG: 41, fatG: 3, fiberG: 7 },
    ['1 rebanada', '1 slice', 30],
    [],
  ),
  food(
    'Copos de avena',
    'Rolled oats',
    { kcal: 370, proteinG: 13, carbsG: 59, fatG: 7, fiberG: 10 },
    ['1 cuenco', '1 bowl', 40],
    [],
  ),
  food(
    'Plátano',
    'Banana',
    { kcal: 95, proteinG: 1.2, carbsG: 21, fatG: 0.3, fiberG: 2.6 },
    ['1 plátano', '1 banana', 120],
    [],
  ),
  food(
    'Manzana',
    'Apple',
    { kcal: 52, proteinG: 0.3, carbsG: 12, fatG: 0.2, fiberG: 2.4 },
    ['1 manzana', '1 apple', 180],
    [],
  ),
  food(
    'Almendras',
    'Almonds',
    { kcal: 600, proteinG: 21, carbsG: 7, fatG: 52, fiberG: 12 },
    ['1 puñado', '1 handful', 25],
    ['nuts'],
  ),
  food(
    'Leche semidesnatada',
    'Semi-skimmed milk',
    { kcal: 46, proteinG: 3.3, carbsG: 4.8, fatG: 1.6, fiberG: null },
    ['1 vaso', '1 glass', 200],
    ['dairy'],
  ),
  food(
    'Bebida de soja',
    'Soy drink',
    { kcal: 40, proteinG: 3.3, carbsG: 2.5, fatG: 1.8, fiberG: 0.5 },
    ['1 vaso', '1 glass', 200],
    [],
  ),
];

export interface EvalProfile {
  id: string;
  focus: TrainingFocus;
  dietType: DietType;
  allergies: string[];
  dislikes: string[];
  flags: SafetyFlag[];
  targets: FeedbackTargets;
  breakdown: FeedbackBreakdown;
  /** Tags of the foods this person never logs. */
  avoids: string[];
}

export const PROFILES: EvalProfile[] = [
  {
    id: 'omnivore-hypertrophy',
    focus: 'hypertrophy',
    dietType: 'omnivore',
    allergies: [],
    dislikes: ['brócoli'],
    flags: [],
    targets: { kcal: 2600, proteinG: 150, carbsG: 320, fiberG: 36 },
    breakdown: { referenceWeightKg: 80, trainingFocus: 'hypertrophy', carbsMinGPerKg: null },
    avoids: [],
  },
  {
    id: 'vegetarian-general-nuts',
    focus: 'general_fitness',
    dietType: 'vegetarian',
    allergies: ['frutos secos'],
    dislikes: [],
    flags: [],
    targets: { kcal: 1800, proteinG: 105, carbsG: 210, fiberG: 25 },
    breakdown: { referenceWeightKg: 62, trainingFocus: 'general_fitness', carbsMinGPerKg: null },
    avoids: ['meat', 'fish', 'nuts'],
  },
  {
    id: 'vegan-sport',
    focus: 'sport_performance',
    dietType: 'vegan',
    allergies: [],
    dislikes: ['setas'],
    flags: [],
    targets: { kcal: 2700, proteinG: 120, carbsG: 380, fiberG: 38 },
    breakdown: { referenceWeightKg: 70, trainingFocus: 'sport_performance', carbsMinGPerKg: 5 },
    avoids: ['meat', 'fish', 'dairy', 'egg'],
  },
  {
    id: 'pescatarian-strength-lactose',
    focus: 'strength',
    dietType: 'pescatarian',
    allergies: ['lactosa'],
    dislikes: [],
    flags: [],
    targets: { kcal: 2400, proteinG: 160, carbsG: 260, fiberG: 34 },
    breakdown: { referenceWeightKg: 85, trainingFocus: 'strength', carbsMinGPerKg: null },
    avoids: ['meat', 'dairy'],
  },
  {
    id: 'teen-general',
    focus: 'general_fitness',
    dietType: 'omnivore',
    allergies: ['huevo'],
    dislikes: [],
    flags: ['teen_limited'],
    targets: { kcal: 2300, proteinG: 95, carbsG: 300, fiberG: 32 },
    breakdown: { referenceWeightKg: 60, trainingFocus: 'general_fitness', carbsMinGPerKg: null },
    avoids: ['egg'],
  },
];

/** The foods a profile logs, as recents with their usual portion and as favourites. */
export function userFoods(profile: EvalProfile, locale: Locale) {
  const mine = FOODS.filter((f) => !f.tags.some((tag) => profile.avoids.includes(tag))).map(
    ({ nameEn, servingEn, tags: _tags, ...f }): Food =>
      locale === 'en'
        ? {
            ...f,
            name: nameEn,
            servings: f.servings.map((s) => ({ ...s, label: servingEn ?? s.label })),
          }
        : f,
  );
  const recents: RecentFood[] = mine.slice(0, 10).map((f) => ({
    food: f,
    lastPortion: f.servings[0]
      ? { kind: 'serving', servingId: f.servings[0].id, servings: 1 }
      : { kind: 'grams', grams: 150 },
  }));
  return { recents, favourites: mine.slice(10) };
}

type Meal = { mealType: MealType; nutrients: Nutrients };
const meal = (mealType: MealType, share: Partial<Nutrients>): Meal => ({
  mealType,
  nutrients: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, ...share },
});

/**
 * A day as shares of the targets: each meal gets that share of kcal, protein, carbs and fiber. The
 * scenario says what it is built to produce; core decides what it really gives.
 */
export interface Scenario {
  id: string;
  /** `today` at `time`, or a past day. */
  when: { today: true; time: string } | { today: false };
  trainingDay: boolean;
  meals: (t: FeedbackTargets) => Meal[];
}

const part = (t: FeedbackTargets, mealType: MealType, k: number, p: number, c: number, f: number) =>
  meal(mealType, {
    kcal: t.kcal * k,
    proteinG: t.proteinG * p,
    carbsG: t.carbsG * c,
    fiberG: t.fiberG * f,
    fatG: (t.kcal * k * 0.3) / 9,
  });

export const SCENARIOS: Scenario[] = [
  {
    id: 'protein-gap-morning',
    when: { today: true, time: '11:30' },
    trainingDay: false,
    meals: (t) => [part(t, 'breakfast', 0.25, 0.1, 0.3, 0.3)],
  },
  {
    id: 'protein-fiber-gap-afternoon',
    when: { today: true, time: '17:30' },
    trainingDay: false,
    meals: (t) => [
      part(t, 'breakfast', 0.25, 0.15, 0.3, 0.1),
      part(t, 'lunch', 0.35, 0.2, 0.35, 0.15),
    ],
  },
  {
    id: 'carbs-gap-training',
    when: { today: true, time: '14:30' },
    trainingDay: true,
    meals: (t) => [
      part(t, 'breakfast', 0.2, 0.3, 0.15, 0.3),
      part(t, 'mid_morning', 0.1, 0.15, 0.05, 0.2),
    ],
  },
  {
    id: 'protein-low',
    when: { today: false },
    trainingDay: false,
    meals: (t) => [
      part(t, 'breakfast', 0.3, 0.15, 0.35, 0.3),
      part(t, 'lunch', 0.4, 0.3, 0.35, 0.4),
      part(t, 'dinner', 0.3, 0.2, 0.3, 0.3),
    ],
  },
  {
    id: 'fiber-low',
    when: { today: false },
    trainingDay: false,
    meals: (t) => [
      part(t, 'breakfast', 0.3, 0.3, 0.3, 0.1),
      part(t, 'lunch', 0.4, 0.4, 0.4, 0.2),
      part(t, 'dinner', 0.3, 0.3, 0.3, 0.2),
    ],
  },
  {
    id: 'kcal-low',
    when: { today: false },
    trainingDay: false,
    meals: (t) => [
      part(t, 'breakfast', 0.2, 0.3, 0.3, 0.3),
      part(t, 'lunch', 0.25, 0.35, 0.4, 0.4),
      part(t, 'dinner', 0.25, 0.35, 0.3, 0.3),
    ],
  },
  {
    id: 'kcal-above',
    when: { today: false },
    trainingDay: false,
    meals: (t) => [
      part(t, 'breakfast', 0.4, 0.3, 0.3, 0.3),
      part(t, 'lunch', 0.5, 0.4, 0.4, 0.4),
      part(t, 'dinner', 0.4, 0.3, 0.3, 0.3),
    ],
  },
  {
    id: 'protein-uneven',
    when: { today: false },
    trainingDay: false,
    meals: (t) => [
      part(t, 'breakfast', 0.3, 0.05, 0.35, 0.3),
      part(t, 'lunch', 0.35, 0.1, 0.35, 0.4),
      part(t, 'dinner', 0.35, 0.8, 0.3, 0.3),
    ],
  },
  {
    id: 'day-incomplete',
    when: { today: false },
    trainingDay: false,
    meals: (t) => [part(t, 'lunch', 0.35, 0.3, 0.4, 0.3)],
  },
  {
    id: 'on-track',
    when: { today: false },
    trainingDay: false,
    meals: (t) => [
      part(t, 'breakfast', 0.3, 0.3, 0.3, 0.3),
      part(t, 'lunch', 0.4, 0.4, 0.4, 0.4),
      part(t, 'dinner', 0.3, 0.3, 0.3, 0.3),
    ],
  },
  {
    id: 'carbs-low-training',
    when: { today: false },
    trainingDay: true,
    meals: (t) => [
      part(t, 'breakfast', 0.3, 0.35, 0.2, 0.3),
      part(t, 'lunch', 0.4, 0.4, 0.25, 0.4),
      part(t, 'dinner', 0.3, 0.3, 0.2, 0.3),
    ],
  },
  {
    id: 'on-track-in-progress',
    when: { today: true, time: '16:00' },
    trainingDay: false,
    meals: (t) => [
      part(t, 'breakfast', 0.25, 0.3, 0.3, 0.3),
      part(t, 'lunch', 0.4, 0.45, 0.4, 0.5),
    ],
  },
];
