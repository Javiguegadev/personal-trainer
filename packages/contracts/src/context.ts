import { z } from 'zod';
import {
  GoalSchema,
  IsoDateSchema,
  JobActivitySchema,
  PlannedActivitySchema,
  SafetyFlagSchema,
  SexSchema,
  TrainingFocusSchema,
} from './profile';

export const CONTEXT_VERSION = 'context-v3';

/**
 * The user context (ADR 003): one versioned, read-only view of what the app knows about the user on a
 * given day. It is built by `buildContextSnapshot` in @pt/core from the stored rows and never stored
 * itself. Targets, and later plans and the questions assistant, read it instead of the tables.
 */
export const ContextSnapshotSchema = z.object({
  version: z.literal(CONTEXT_VERSION),
  /** The user's local date the snapshot was built for. */
  date: IsoDateSchema,
  profile: z.object({
    sex: SexSchema,
    ageYears: z.number().int(),
    heightCm: z.number(),
    weightKg: z.number(),
    targetWeightKg: z.number().nullable(),
    /** The goal the user asked for; safety rules may apply a different one. */
    goal: GoalSchema,
  }),
  safetyFlags: z.array(SafetyFlagSchema),
  job: z.object({
    activity: JobActivitySchema,
    factor: z.number(),
  }),
  training: z.object({
    activities: z.array(PlannedActivitySchema),
    sessionsPerWeek: z.number().int(),
    minutesPerWeek: z.number().int(),
    /** Share of the BMR added by the planned training (see `trainingFactor` in @pt/core). */
    factor: z.number(),
    /** What the user trains for (spec 004 AC11). Added by `context-v3`. */
    focus: TrainingFocusSchema,
  }),
  /** The weight log (spec 003 AC25). Added by `context-v2`. */
  weight: z.object({
    lastKg: z.number().nullable(),
    lastDate: IsoDateSchema.nullable(),
    /** 7-day average and its change per week; null without enough entries or when `trendHidden`. */
    averageKg: z.number().nullable(),
    changePerWeekKg: z.number().nullable(),
    fastLoss: z.boolean(),
    /**
     * True with an eating-disorder signal or pregnancy: the trend is not shown to the user and is not
     * given to any AI feature (`averageKg`, `changePerWeekKg` null, `fastLoss` false).
     */
    trendHidden: z.boolean(),
  }),
});
export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>;
