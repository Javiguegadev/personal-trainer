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

/**
 * How an item reached the log. `barcode`: a scanned product; `label` and `custom`: the first log of a
 * food the user created from a label photo or by hand (spec 006). Slice (c) adds photo and text.
 */
export const FoodInputMethodSchema = z.enum([
  'search',
  'recent',
  'favourite',
  'repeat',
  'quick_add',
  'barcode',
  'label',
  'custom',
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

/** The unit of a food's "per 100" values and of its portions: the one its label uses (spec 006). */
export const QUANTITY_UNITS = ['g', 'ml'] as const;
export const QuantityUnitSchema = z.enum(QUANTITY_UNITS);
export type QuantityUnit = z.infer<typeof QuantityUnitSchema>;

/**
 * Where a food comes from: the curated catalog, Open Food Facts (a scanned product), or the user, who
 * typed it (`manual`) or checked the draft of a label photo (`label`). The last two are private.
 */
export const FoodOriginSchema = z.enum(['catalog', 'off', 'manual', 'label']);
export type FoodOrigin = z.infer<typeof FoodOriginSchema>;

/** A barcode in its canonical form (`normalizeBarcode` in core): EAN-8, or EAN-13 (UPC with zeros). */
export const BarcodeSchema = z.string().regex(/^(\d{8}|\d{13})$/);
export type Barcode = z.infer<typeof BarcodeSchema>;

/** `GET /foods/barcode/:code`: the digits as read or typed; the API normalizes them. */
export const BarcodeParamSchema = z.object({ code: z.string().regex(/^\d{8,14}$/) });

/** A food in the requested locale: of the catalog, a scanned product or one of the user's own. */
export const FoodSchema = z.object({
  id: z.uuid(),
  /** Stable key: curated (`huevo-entero`), `off-<barcode>` or `user-<id>`. */
  key: z.string(),
  name: z.string(),
  /** Values per 100 g, or per 100 ml when `unit` is `ml`. */
  per100g: NutrientsSchema,
  /** Household servings, most common first, in `unit`. The quantity itself is always available. */
  servings: z.array(FoodServingSchema),
  /** `knowledge_sources.id` (AC3). */
  source: z.string(),
  origin: FoodOriginSchema,
  unit: QuantityUnitSchema,
  brand: z.string().nullable(),
  barcode: BarcodeSchema.nullable(),
  /** Declared allergens and traces as Open Food Facts tags (`en:milk`). Empty means "no data". */
  allergens: z.array(z.string()),
  traces: z.array(z.string()),
  /** The product's page at the source, for the attribution link (spec 006 AC5). */
  sourceUrl: z.string().nullable(),
  /** The energy does not match the macros: "check these values with the package" (spec 006 AC5). */
  energyMismatch: z.boolean(),
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
  /** Language of the name and serving snapshots (AC9). */
  locale: LocaleSchema.default('es'),
};

/** `PUT /me/food-log/items/:id`. The API computes the snapshot of a catalog item itself (AC9). */
export const MealItemUpsertRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('food'),
    foodId: z.uuid(),
    portion: PortionSchema,
    inputMethod: z.enum(['search', 'recent', 'favourite', 'repeat', 'barcode', 'label', 'custom']),
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
  /** Null for a quick add. In `unit`: grams, or millilitres for a food labelled per 100 ml. */
  grams: z.number().nullable(),
  /** Snapshot of the food's unit, so an item whose food is gone still shows "250 ml". */
  unit: QuantityUnitSchema,
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

/** `GET /foods/:foodId` (to edit a logged portion, AC11) and the favourite routes. */
export const FoodIdParamSchema = z.object({ foodId: z.uuid() });
export const FavouriteFoodParamSchema = FoodIdParamSchema;

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

// ── Scanned products, custom foods and the label photo (spec 006) ─────────────────────────────────

/** Limits of scanned products and custom foods (spec 006 AC4, AC9, AC12). */
export const CUSTOM_FOOD_LIMITS = {
  nameMax: FOOD_LOG_LIMITS.labelMax,
  brandMax: 60,
  servingLabelMax: 40,
  /** Per 100 g or ml: pure fat has about 900 kcal. */
  kcalMax: 900,
  macroMax: 100,
  /** Protein + carbohydrates + fat per 100 g; above 100 because labels round each value. */
  macroSumMax: 105,
  /** Energy away from the macros by more than this share asks for confirmation (AC10). */
  energyTolerance: 0.2,
  foodsMax: 200,
} as const;

export const PRODUCT_LIMITS = {
  /** A product whose energy is this far from its macros gets a "check the package" note (AC5). */
  energyMismatch: 0.25,
  /** A cached product older than this is read again from Open Food Facts (AC3). */
  cacheDays: 90,
  /** An unknown barcode is not asked again before this (AC6). */
  missHours: 24,
  /** Live lookups per user and minute (AC7). */
  lookupsPerMinute: 10,
  timeoutMs: 4000,
} as const;

export const LABEL_SCAN_LIMITS = {
  /**
   * Decoded bytes of the image, after the resize on the device (AC14). In base64 it is 4 MB, which fits
   * the 4.5 MB request limit of the API's host with room for the rest of the body.
   */
  imageBytesMax: 3 * 1024 * 1024,
  /** Longest side the app resizes the photo to, in pixels. */
  imageSideMax: 1568,
  /** Reads per user and UTC day (AC18). */
  perDay: 20,
} as const;

const per100 = (max: number) => z.number().min(0).max(max);

/** `PUT /me/foods/:id`: a food of the user's own, typed by hand or checked from a label photo. */
export const CustomFoodUpsertRequestSchema = z.object({
  name: z.string().trim().min(1).max(CUSTOM_FOOD_LIMITS.nameMax),
  brand: z.string().trim().min(1).max(CUSTOM_FOOD_LIMITS.brandMax).nullable(),
  unit: QuantityUnitSchema,
  /** Per 100 g or ml. */
  per100g: z.object({
    kcal: per100(CUSTOM_FOOD_LIMITS.kcalMax),
    proteinG: per100(CUSTOM_FOOD_LIMITS.macroMax),
    carbsG: per100(CUSTOM_FOOD_LIMITS.macroMax),
    fatG: per100(CUSTOM_FOOD_LIMITS.macroMax),
    fiberG: per100(CUSTOM_FOOD_LIMITS.macroMax).nullable(),
  }),
  /** One optional serving. Its id comes from the device, so an item can use it before the sync. */
  serving: z
    .object({
      id: z.uuid(),
      label: z.string().trim().min(1).max(CUSTOM_FOOD_LIMITS.servingLabelMax),
      grams: z.number().min(FOOD_LOG_LIMITS.gramsMin).max(FOOD_LOG_LIMITS.gramsMax),
    })
    .nullable(),
  barcode: BarcodeSchema.nullable(),
  origin: z.enum(['manual', 'label']),
});
export type CustomFoodUpsertRequest = z.infer<typeof CustomFoodUpsertRequestSchema>;

export const CustomFoodsResponseSchema = z.object({
  /** The user's own foods, most recently changed first. */
  foods: z.array(FoodSchema),
});
export type CustomFoodsResponse = z.infer<typeof CustomFoodsResponseSchema>;

export const LabelImageSchema = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** Base64 without the `data:` prefix. */
  data: z.string().min(1),
});
export type LabelImage = z.infer<typeof LabelImageSchema>;

/** `POST /me/foods/label-scan`. */
export const LabelScanRequestSchema = z.object({
  image: LabelImageSchema,
  locale: LocaleSchema.default('es'),
});
export type LabelScanRequest = z.infer<typeof LabelScanRequestSchema>;

export const LabelUnreadableReasonSchema = z.enum(['not_a_label', 'blurry', 'cut_off']);
export type LabelUnreadableReason = z.infer<typeof LabelUnreadableReasonSchema>;

/**
 * What the model returns for a label photo (AC15): a transcription of what is printed, never an
 * estimate. A value that is not printed, or cannot be read, is null. `core` turns it into a draft.
 */
export const LabelReadingSchema = z.object({
  status: z.enum(['ok', 'not_a_label', 'blurry', 'cut_off']),
  /** The column the values were copied from. The "per 100" column wins when the label has both. */
  basis: z.enum(['per_100g', 'per_100ml', 'per_serving']).nullable(),
  /** The size of one serving as printed, when the label states it. */
  servingSize: z.number().nullable(),
  servingUnit: QuantityUnitSchema.nullable(),
  energyKcal: z.number().nullable(),
  energyKj: z.number().nullable(),
  fatG: z.number().nullable(),
  carbsG: z.number().nullable(),
  proteinG: z.number().nullable(),
  fiberG: z.number().nullable(),
  productName: z.string().nullable(),
  brand: z.string().nullable(),
});
export type LabelReading = z.infer<typeof LabelReadingSchema>;

/** The editable draft of a label photo (AC16). Null means "not read": the user fills it in. */
export const LabelDraftSchema = z.object({
  name: z.string().nullable(),
  brand: z.string().nullable(),
  unit: QuantityUnitSchema,
  kcal: z.number().nullable(),
  proteinG: z.number().nullable(),
  carbsG: z.number().nullable(),
  fatG: z.number().nullable(),
  fiberG: z.number().nullable(),
  /** The size of one serving, in `unit`. */
  servingGrams: z.number().nullable(),
});
export type LabelDraft = z.infer<typeof LabelDraftSchema>;

export const LabelScanResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), draft: LabelDraftSchema }),
  z.object({ status: z.literal('unreadable'), reason: LabelUnreadableReasonSchema }),
]);
export type LabelScanResponse = z.infer<typeof LabelScanResponseSchema>;

/** The fields of spec 006 for a food of the curated catalog: in grams, no brand, no barcode. */
export const CATALOG_FOOD_FIELDS = {
  origin: 'catalog',
  unit: 'g',
  brand: null,
  barcode: null,
  allergens: [] as string[],
  traces: [] as string[],
  sourceUrl: null,
  energyMismatch: false,
} satisfies Partial<Food>;
