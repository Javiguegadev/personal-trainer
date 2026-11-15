import { z } from 'zod';
import { IsoDateSchema, LocaleSchema } from './profile';

/** Limits of the food catalog and the food log (spec 005). */
export const FOOD_LOG_LIMITS = {
  gramsMin: 1,
  gramsMax: 2000,
  servingsMin: 0.5,
  servingsMax: 20,
  servingsStep: 0.5,
  quickAddKcalMax: 5000,
  quickAddMacroMax: 500,
  labelMax: 80,
  /** Abuse guard: more items than this in one day are rejected. */
  itemsPerDayMax: 150,
  /** Longest range one `GET /me/food-log` can ask for, in days. */
  listDaysMax: 31,
  /** How far back an item can be dated, in days. */
  historyDays: 366,
  recentsDays: 60,
  recentsMax: 20,
  searchMinLength: 2,
  searchMaxLength: 60,
  searchResultsMax: 25,
  /** Quick add: macro energy above the kcal by more than this share asks for confirmation (AC10). */
  quickAddEnergyTolerance: 0.2,
} as const;

const datetime = z.iso.datetime({ offset: true });

/** The five Spanish meals plus "other", in the order of the day (AC15). */
export const MEAL_TYPES = [
  'breakfast',
  'mid_morning',
  'lunch',
  'afternoon_snack',
  'dinner',
  'other',
] as const;
export const MealTypeSchema = z.enum(MEAL_TYPES);
export type MealType = z.infer<typeof MealTypeSchema>;

/** How an item reached the log. Slices (b) and (c) add barcode, label, photo and text. */
export const FoodInputMethodSchema = z.enum([
  'search',
  'recent',
  'favourite',
  'repeat',
  'quick_add',
]);
export type FoodInputMethod = z.infer<typeof FoodInputMethodSchema>;

/** Energy and macros: per 100 g on a food, the snapshot of the portion on a log item. */
export const NutrientsSchema = z.object({
  kcal: z.number().min(0),
  proteinG: z.number().min(0),
  carbsG: z.number().min(0),
  fatG: z.number().min(0),
  /** Null when the source has no value. */
  fiberG: z.number().min(0).nullable(),
});
export type Nutrients = z.infer<typeof NutrientsSchema>;

export const FoodServingSchema = z.object({
  id: z.uuid(),
  /** In the requested locale ("1 huevo mediano"). */
  label: z.string(),
  grams: z.number().positive(),
});
export type FoodServing = z.infer<typeof FoodServingSchema>;

/** A catalog food in the requested locale. */
export const FoodSchema = z.object({
  id: z.uuid(),
  /** Stable curated key (`huevo-entero`), used by the eval and the fixtures. */
  key: z.string(),
  name: z.string(),
  per100g: NutrientsSchema,
  /** Household servings, most common first. Grams are always available as well. */
  servings: z.array(FoodServingSchema),
  /** `knowledge_sources.id` (AC3). */
  source: z.string(),
});
export type Food = z.infer<typeof FoodSchema>;

export const FoodSearchQuerySchema = z.object({
  q: z.string().trim().min(FOOD_LOG_LIMITS.searchMinLength).max(FOOD_LOG_LIMITS.searchMaxLength),
  locale: LocaleSchema.default('es'),
});
export type FoodSearchQuery = z.infer<typeof FoodSearchQuerySchema>;

export const FoodSearchResponseSchema = z.object({
  /** Best match first, at most `searchResultsMax`. */
  foods: z.array(FoodSchema),
});
export type FoodSearchResponse = z.infer<typeof FoodSearchResponseSchema>;

/** A portion of a catalog food: a number of household servings, or grams (AC8). */
export const PortionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('serving'),
    servingId: z.uuid(),
    servings: z
      .number()
      .min(FOOD_LOG_LIMITS.servingsMin)
      .max(FOOD_LOG_LIMITS.servingsMax)
      .multipleOf(FOOD_LOG_LIMITS.servingsStep),
  }),
  z.object({
    kind: z.literal('grams'),
    grams: z.number().min(FOOD_LOG_LIMITS.gramsMin).max(FOOD_LOG_LIMITS.gramsMax),
  }),
]);
export type Portion = z.infer<typeof PortionSchema>;

const macro = z.number().min(0).max(FOOD_LOG_LIMITS.quickAddMacroMax);

const itemPlacement = {
  /** The user's day of the item. */
  localDate: IsoDateSchema,
  mealType: MealTypeSchema,
  /** Device time of the write. The later one wins, also against a delete (AC20). */
  recordedAt: datetime,
  /** The user's local date. The API accepts it only within ±1 day of server UTC. */
  today: IsoDateSchema,
};

/** `PUT /me/food-log/items/:id`. The API computes the snapshot of a catalog item itself (AC9). */
export const MealItemUpsertRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('food'),
    foodId: z.uuid(),
    portion: PortionSchema,
    inputMethod: z.enum(['search', 'recent', 'favourite', 'repeat']),
    ...itemPlacement,
  }),
  z.object({
    kind: z.literal('quick_add'),
    label: z.string().trim().min(1).max(FOOD_LOG_LIMITS.labelMax),
    kcal: z.number().min(0).max(FOOD_LOG_LIMITS.quickAddKcalMax),
    proteinG: macro.nullable(),
    carbsG: macro.nullable(),
    fatG: macro.nullable(),
    inputMethod: z.enum(['quick_add', 'repeat']),
    ...itemPlacement,
  }),
]);
export type MealItemUpsertRequest = z.infer<typeof MealItemUpsertRequestSchema>;

export const MealItemSchema = z.object({
  id: z.uuid(),
  localDate: IsoDateSchema,
  mealType: MealTypeSchema,
  /** Null for a quick add, or when the food left the catalog. */
  foodId: z.uuid().nullable(),
  /** The portion as entered, to reopen the item as "2 huevos". Null for grams and quick adds. */
  servingId: z.uuid().nullable(),
  servings: z.number().nullable(),
  /** Snapshot of the serving's label, in the user's locale at the time. */
  servingLabel: z.string().nullable(),
  /** Null for a quick add. */
  grams: z.number().nullable(),
  /** Snapshot of the food's name (or the quick-add name). */
  label: z.string(),
  /** Snapshot of the portion's energy and macros (AC9). */
  nutrients: NutrientsSchema,
  inputMethod: FoodInputMethodSchema,
  recordedAt: datetime,
});
export type MealItem = z.infer<typeof MealItemSchema>;

export const MealItemIdParamSchema = z.object({ id: z.uuid() });
export const MealItemDeleteQuerySchema = z.object({ recordedAt: datetime });
export type MealItemDeleteQuery = z.infer<typeof MealItemDeleteQuerySchema>;

export const MealItemSaveResponseSchema = z.object({
  /** The item stored after the write (the newer one if another write won); null when it is deleted. */
  item: MealItemSchema.nullable(),
});
export type MealItemSaveResponse = z.infer<typeof MealItemSaveResponseSchema>;

export const FoodLogQuerySchema = z.object({ from: IsoDateSchema, to: IsoDateSchema });
export type FoodLogQuery = z.infer<typeof FoodLogQuerySchema>;

export const FoodLogResponseSchema = z.object({
  /** Items of the range, by day and then by `recordedAt`. Deleted items are not listed. */
  items: z.array(MealItemSchema),
});
export type FoodLogResponse = z.infer<typeof FoodLogResponseSchema>;

export const FoodLocaleQuerySchema = z.object({ locale: LocaleSchema.default('es') });

export const RecentFoodSchema = z.object({
  food: FoodSchema,
  /** The portion used the last time, preselected in the portion sheet (AC8). */
  lastPortion: PortionSchema,
});
export type RecentFood = z.infer<typeof RecentFoodSchema>;

export const RecentFoodsResponseSchema = z.object({
  /** Most recently logged first (AC7). */
  recents: z.array(RecentFoodSchema),
});
export type RecentFoodsResponse = z.infer<typeof RecentFoodsResponseSchema>;

export const FavouriteFoodsResponseSchema = z.object({
  /** Most recently starred first. */
  foods: z.array(FoodSchema),
});
export type FavouriteFoodsResponse = z.infer<typeof FavouriteFoodsResponseSchema>;

export const FavouriteFoodParamSchema = z.object({ foodId: z.uuid() });

/** One row of the "Fuentes de datos" screen (AC3). */
export const KnowledgeSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  license: z.string(),
  version: z.string(),
  /** In the requested locale. */
  attribution: z.string(),
});
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;

export const KnowledgeSourcesResponseSchema = z.object({
  sources: z.array(KnowledgeSourceSchema),
});
export type KnowledgeSourcesResponse = z.infer<typeof KnowledgeSourcesResponseSchema>;
