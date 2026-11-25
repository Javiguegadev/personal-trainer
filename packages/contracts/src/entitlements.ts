import { z } from 'zod';

/**
 * The plans a user can be on (spec 014 AC14). Only `beta` until E6 adds the paid plans and the
 * `entitlements` table; `canUse()` in @pt/core holds what each plan allows.
 */
export const PlanIdSchema = z.enum(['beta']);
export type PlanId = z.infer<typeof PlanIdSchema>;

/**
 * The AI features with a daily cap per user and UTC day. The names are the ones stored in
 * `ai_usage.feature` (`AiFeature` in @pt/ai), so the usage of a day is counted by name.
 */
export const CappedFeatureSchema = z.enum([
  'label_scan',
  'meal_photo',
  'meal_text',
  'daily_feedback',
  'workout_text',
]);
export type CappedFeature = z.infer<typeof CappedFeatureSchema>;
