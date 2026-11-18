import { z } from 'zod';
import { FoodSchema, MealTypeSchema, PortionSchema } from './food';
import { IsoDateSchema, LocaleSchema } from './profile';

/**
 * Limits and thresholds of the daily feedback (spec 008). Every threshold is PROVISIONAL: it needs the
 * professional reviewer before the beta, and a change means an eval run (AC19).
 */
export const FEEDBACK_LIMITS = {
  /** Notes of one feedback (AC11). */
  notesMax: 3,
  /** Characters of one AI note (AC13, AC14). */
  textMax: 200,
  /** Foods suggested per note (AC13). */
  suggestionsPerNote: 2,
  /** Foods core offers the model per observation (AC12). */
  candidatesPerObservation: 5,
  /** AI requests per user and UTC day; past it the notes use fixed wording (AC15). */
  aiPerDay: 10,
  timeoutMs: 10_000,
  /** How far back a day can be asked for, besides today (AC1). */
  daysBack: 6,
  /** A day is in progress before this local time, in minutes after midnight (AC4). */
  inProgressUntilMinute: 22 * 60,
  /** A closed day with fewer meals, or below this share of the kcal, is incomplete (AC5). */
  incompleteMealsMin: 2,
  incompleteKcalRatio: 0.5,
  /** Protein (AC6). */
  proteinLowRatio: 0.8,
  proteinGapMinG: 20,
  proteinGapMinRatio: 0.3,
  /** Kcal (AC7). */
  kcalLowRatio: 0.8,
  kcalAboveRatio: 1.15,
  /** Fiber (AC8): items without a fiber value above this share of the kcal hide the fiber notes. */
  fiberUnknownKcalRatio: 0.25,
  fiberLowRatio: 0.7,
  fiberGapMinG: 10,
  fiberGapMinRatio: 0.5,
  /** Protein spread (AC9). */
  unevenGPerKg: 0.25,
  unevenMinG: 20,
  unevenMealsMin: 2,
  unevenTopShare: 0.5,
  /** Carbohydrates on a training day (AC10). */
  carbsLowRatio: 0.75,
  carbsGapMinG: 50,
  carbsGapMinRatio: 0.4,
  /** A candidate portion above this share of the day's kcal target is dropped (AC12). */
  candidateKcalShareMax: 0.5,
  /** Days of recents the candidates come from (AC12, spec 005 recents). */
  candidateDays: 60,
} as const;

export const FEEDBACK_OBSERVATION_KINDS = [
  'day_incomplete',
  'protein_low',
  'protein_gap',
  'kcal_low',
  'kcal_above',
  'fiber_low',
  'fiber_gap',
  'protein_uneven',
  'carbs_low_training',
  'carbs_gap_training',
  'on_track',
] as const;
export const FeedbackObservationKindSchema = z.enum(FEEDBACK_OBSERVATION_KINDS);
export type FeedbackObservationKind = z.infer<typeof FeedbackObservationKindSchema>;

/** One citation per observation kind, fixed in core (AC18, "Sources" of the spec). */
export const FeedbackCitationIdSchema = z.enum([
  'issn_protein_2017',
  'efsa_fibre_2010',
  'acsm_and_dc_2016',
  'own_targets',
]);
export type FeedbackCitationId = z.infer<typeof FeedbackCitationIdSchema>;

export const FeedbackNutrientSchema = z.enum(['kcal', 'protein', 'fiber', 'carbs']);
export type FeedbackNutrient = z.infer<typeof FeedbackNutrientSchema>;

/** The numbers of an observation, all computed by core and rounded to whole units (AC13). */
export const FeedbackNumbersSchema = z.object({
  /** What `eaten`, `target` and `left` measure; null for `day_incomplete` and `on_track`. */
  nutrient: FeedbackNutrientSchema.nullable(),
  /** Grams, or kcal for `kcal`. */
  eaten: z.number().nullable(),
  target: z.number().nullable(),
  left: z.number().nullable(),
  /** The main meals still to come on a day in progress (AC4), in the order of the day. */
  mealsLeft: z.array(MealTypeSchema),
  /** Protein grams of each meal with items (`protein_uneven`, AC9), in the order of the day. */
  perMeal: z.array(z.object({ mealType: MealTypeSchema, grams: z.number() })),
});
export type FeedbackNumbers = z.infer<typeof FeedbackNumbersSchema>;

export const FeedbackObservationSchema = z.object({
  kind: FeedbackObservationKindSchema,
  numbers: FeedbackNumbersSchema,
  citation: FeedbackCitationIdSchema,
});
export type FeedbackObservation = z.infer<typeof FeedbackObservationSchema>;

/** `POST /me/food-log/feedback` (AC1, AC10). */
export const DailyFeedbackRequestSchema = z.object({
  /** The day asked for: today or up to `daysBack` days before. */
  localDate: IsoDateSchema,
  /** The user's local date. The API accepts it only within ±1 day of server UTC. */
  today: IsoDateSchema,
  /** The device's local time, only to tell a day in progress from a closed one (AC4). */
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** "Hoy entreno" / "Ese día entrené": sent, never stored (AC10). */
  trainingDay: z.boolean(),
  locale: LocaleSchema.default('es'),
});
export type DailyFeedbackRequest = z.infer<typeof DailyFeedbackRequestSchema>;

/** What the model returns (structured output): one note per observation, with candidate refs. */
export const FeedbackReadingSchema = z.object({
  notes: z.array(
    z.object({
      observation: FeedbackObservationKindSchema,
      text: z.string(),
      /** Refs of that observation's candidates (`c1`, `c2`…), at most `suggestionsPerNote`. */
      suggestionRefs: z.array(z.string()),
    }),
  ),
});
export type FeedbackReading = z.infer<typeof FeedbackReadingSchema>;

/** A food the user already eats, with the portion they use (AC12, AC16). */
export const FeedbackSuggestionSchema = z.object({
  food: FoodSchema,
  portion: PortionSchema,
});
export type FeedbackSuggestion = z.infer<typeof FeedbackSuggestionSchema>;

export const FeedbackNoteSourceSchema = z.enum(['ai', 'template']);
export type FeedbackNoteSource = z.infer<typeof FeedbackNoteSourceSchema>;

export const FeedbackNoteSchema = z.object({
  observation: FeedbackObservationSchema,
  /**
   * The AI wording, in the user's language and without digits. Null with `source: template`: the app
   * shows the fixed i18n wording of the kind (`feedback.template.<kind>`) with core's numbers (AC14).
   */
  text: z.string().max(FEEDBACK_LIMITS.textMax).nullable(),
  source: FeedbackNoteSourceSchema,
  suggestions: z.array(FeedbackSuggestionSchema).max(FEEDBACK_LIMITS.suggestionsPerNote),
});
export type FeedbackNote = z.infer<typeof FeedbackNoteSchema>;

export const FeedbackStateSchema = z.enum(['in_progress', 'closed']);
export type FeedbackState = z.infer<typeof FeedbackStateSchema>;

export const DailyFeedbackResponseSchema = z.object({
  localDate: IsoDateSchema,
  state: FeedbackStateSchema,
  /** At most `notesMax`, in the order of AC11. */
  notes: z.array(FeedbackNoteSchema).min(1).max(FEEDBACK_LIMITS.notesMax),
  /** One per citation kind used, in the order of the notes (AC18). */
  citations: z.array(FeedbackCitationIdSchema),
  /** `feedbackFingerprint` of the items the API read (AC17). */
  fingerprint: z.string(),
});
export type DailyFeedbackResponse = z.infer<typeof DailyFeedbackResponseSchema>;
