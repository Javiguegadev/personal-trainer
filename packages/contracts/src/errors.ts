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
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string(),
  /** Field path → error code, for form validation (e.g. `{ heightCm: 'too_small' }`). */
  fields: z.record(z.string(), z.string()).optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;
