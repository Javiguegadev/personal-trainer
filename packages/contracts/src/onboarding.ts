import { z } from 'zod';
import { SafetyEvaluationSchema, TargetsBreakdownSchema, TargetsSchema } from './profile';

export const TargetsPreviewResponseSchema = z.object({
  /** Null when `safety.targetsAllowed` is false (pregnancy/breastfeeding: no numbers, AC19). */
  targets: TargetsSchema.nullable(),
  breakdown: TargetsBreakdownSchema.nullable(),
  safety: SafetyEvaluationSchema,
});
export type TargetsPreviewResponse = z.infer<typeof TargetsPreviewResponseSchema>;
