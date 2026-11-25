import { z } from 'zod';

/** Machine-readable error codes. The app maps each code to an i18n key (`errors.<code>`). */
export const ApiErrorCodeSchema = z.enum([
  'unauthorized',
  'consent_required',
  'validation_error',
  'age_blocked',
  'rate_limited',
  'ai_unavailable',
  'not_found',
  'internal_error',
  // Scanned products, custom foods and the label photo (spec 006)
  'product_not_found',
  'product_incomplete',
  'lookup_unavailable',
  'ai_cap_reached',
  'image_too_large',
  'food_limit_reached',
  // Daily feedback (spec 008)
  'feedback_unavailable',
  // Custom exercises (spec 009)
  'exercise_limit_reached',
  'id_taken',
  // Routine (spec 010)
  'program_exists',
  // Weekly review (spec 014)
  'review_decided',
  'review_stale',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string(),
  /** Field path → error code, for form validation (e.g. `{ heightCm: 'too_small' }`). */
  fields: z.record(z.string(), z.string()).optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;
