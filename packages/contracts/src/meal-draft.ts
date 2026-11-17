import { z } from 'zod';
import { FoodSchema, ImageUploadSchema, PortionSchema } from './food';
import { LocaleSchema } from './profile';

/** Limits of the plate photo and sentence shortcuts (spec 007). */
export const MEAL_DRAFT_LIMITS = {
  textMin: 3,
  textMax: 300,
  /** Items of one draft; more are dropped (AC4, AC5). */
  itemsMax: 15,
  /** The words an item came from, as shown in the draft. */
  mentionMax: 80,
  /** Abuse guard per user and UTC day, one counter per shortcut (AC12). */
  photosPerDay: 20,
  textsPerDay: 40,
  /** The whole draft, tool rounds included (AC11). */
  timeoutMs: 20_000,
  /** Tool rounds before the draft fails as `ai_unavailable` (AC11). */
  toolRoundsMax: 2,
  /** One `search_foods` call: queries, and foods returned per query. */
  toolQueriesMax: 15,
  toolResultsPerQuery: 5,
} as const;

/** `POST /me/food-log/drafts/text`: a typed or dictated sentence (AC2, AC4). */
export const MealTextDraftRequestSchema = z.object({
  text: z.string().trim().min(MEAL_DRAFT_LIMITS.textMin).max(MEAL_DRAFT_LIMITS.textMax),
  locale: LocaleSchema.default('es'),
});
export type MealTextDraftRequest = z.infer<typeof MealTextDraftRequestSchema>;

/** `POST /me/food-log/drafts/photo`: a photo of the plate, resized on the device (AC3, AC5). */
export const MealPhotoDraftRequestSchema = z.object({
  image: ImageUploadSchema,
  locale: LocaleSchema.default('es'),
});
export type MealPhotoDraftRequest = z.infer<typeof MealPhotoDraftRequestSchema>;

/** How sure the model is of a portion estimated from a photo (AC5). A sentence gives `high`. */
export const DraftConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type DraftConfidence = z.infer<typeof DraftConfidenceSchema>;

/** Why a photo or a sentence gave no draft (AC10). */
export const MealUnreadableReasonSchema = z.enum(['not_food', 'blurry', 'unclear']);
export type MealUnreadableReason = z.infer<typeof MealUnreadableReasonSchema>;

/**
 * One food of the model's reading. The ids are the ones the `search_foods` tool returned; `core`
 * (`mealDraft`) drops any other id and checks the portion (AC9). A serving count or grams, not both;
 * neither means "no quantity was said".
 */
export const MealReadingItemSchema = z.object({
  /** The words of the sentence, or a short name of what the photo shows. */
  mention: z.string(),
  foodId: z.string().nullable(),
  servingId: z.string().nullable(),
  servings: z.number().nullable(),
  grams: z.number().nullable(),
  confidence: DraftConfidenceSchema,
  /** No quantity was said: the draft shows "cantidad supuesta" (AC4). */
  quantityAssumed: z.boolean(),
  /** Not seen but likely, such as the oil of a fried dish: the draft shows "Probable" (AC5). */
  inferred: z.boolean(),
});
export type MealReadingItem = z.infer<typeof MealReadingItemSchema>;

/** What the model returns for a photo or a sentence (structured output). */
export const MealReadingSchema = z.object({
  status: z.enum(['ok', 'not_food', 'blurry', 'unclear']),
  /** Empty for any status other than `ok`. */
  items: z.array(MealReadingItemSchema),
});
export type MealReading = z.infer<typeof MealReadingSchema>;

/** One editable item of a draft (AC4, AC5, AC7). Nothing is logged until the user saves the draft. */
export const DraftItemSchema = z.object({
  food: FoodSchema,
  portion: PortionSchema,
  mention: z.string(),
  confidence: DraftConfidenceSchema,
  quantityAssumed: z.boolean(),
  inferred: z.boolean(),
});
export type DraftItem = z.infer<typeof DraftItemSchema>;

/** Words the tool found no food for (AC6): the user searches or quick-adds them. */
export const UnresolvedMentionSchema = z.object({ mention: z.string() });
export type UnresolvedMention = z.infer<typeof UnresolvedMentionSchema>;

export const MealDraftResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    /** In the order said or seen, at most `itemsMax`. */
    items: z.array(DraftItemSchema),
    unresolved: z.array(UnresolvedMentionSchema),
  }),
  z.object({ status: z.literal('unreadable'), reason: MealUnreadableReasonSchema }),
]);
export type MealDraftResponse = z.infer<typeof MealDraftResponseSchema>;
