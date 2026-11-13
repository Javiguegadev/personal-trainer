import { z } from 'zod';
import { IsoDateSchema, SafetyEvaluationSchema, TargetsSchema, WeightKgSchema } from './profile';

/** Limits of the weight log (spec 003 AC7, AC14). */
export const WEIGHT_LIMITS = {
  /** How far back an entry can be dated. */
  historyYears: 5,
  /** Longest range one `GET /me/weights` can ask for, in days. */
  listDaysMax: 366,
} as const;

const datetime = z.iso.datetime({ offset: true });

/** One weight per user and day (spec 003 AC8). */
export const WeightEntrySchema = z.object({
  /** The user's day (YYYY-MM-DD). */
  localDate: IsoDateSchema,
  weightKg: WeightKgSchema,
  /** Device time of the write. The later one wins when two devices write the same day (AC20). */
  recordedAt: datetime,
});
export type WeightEntry = z.infer<typeof WeightEntrySchema>;

export const WeightUpsertRequestSchema = z.object({
  weightKg: WeightKgSchema,
  recordedAt: datetime,
  /** The user's local date. The API accepts it only within ±1 day of server UTC. */
  today: IsoDateSchema,
});
export type WeightUpsertRequest = z.infer<typeof WeightUpsertRequestSchema>;

/** Query of `DELETE /me/weights/:localDate`: the targets may be recomputed, which needs the user's day. */
export const WeightDeleteQuerySchema = z.object({ today: IsoDateSchema });
export type WeightDeleteQuery = z.infer<typeof WeightDeleteQuerySchema>;

export const WeightDateParamSchema = z.object({ localDate: IsoDateSchema });

export const WeightListQuerySchema = z.object({ from: IsoDateSchema, to: IsoDateSchema });
export type WeightListQuery = z.infer<typeof WeightListQuerySchema>;

export const WeightListResponseSchema = z.object({
  /** Oldest first. */
  entries: z.array(WeightEntrySchema),
});
export type WeightListResponse = z.infer<typeof WeightListResponseSchema>;

/** The targets before and after a weight entry changed them (spec 003 AC11). Null = no numeric targets. */
export const TargetsChangeSchema = z.object({
  previous: TargetsSchema.nullable(),
  current: TargetsSchema.nullable(),
  /** The safety evaluation behind `current`, so the app can show the matching notices (AC12). */
  safety: SafetyEvaluationSchema,
});
export type TargetsChange = z.infer<typeof TargetsChangeSchema>;

export const WeightSaveResponseSchema = z.object({
  /** The entry stored for that day after the write; null after a delete. */
  entry: WeightEntrySchema.nullable(),
  /** Null when the write did not change the targets (AC10, AC13). */
  targetsChange: TargetsChangeSchema.nullable(),
});
export type WeightSaveResponse = z.infer<typeof WeightSaveResponseSchema>;

/** The weight trend computed by `weightTrend` in @pt/core (spec 003 AC23). */
export const WeightTrendSchema = z.object({
  last: z.object({ localDate: IsoDateSchema, weightKg: z.number() }).nullable(),
  /** Mean of the entries of the last 7 days; null with fewer than 3. */
  averageKg: z.number().nullable(),
  /** Change of that average against the 7 days before, per week; null without enough entries. */
  changePerWeekKg: z.number().nullable(),
  /** The average falls more than 1 % per week (provisional threshold). */
  fastLoss: z.boolean(),
});
export type WeightTrend = z.infer<typeof WeightTrendSchema>;
