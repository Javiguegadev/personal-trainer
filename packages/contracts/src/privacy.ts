import { z } from 'zod';
import { DietaryPrefsSchema, ProfileSchema, StoredTargetsSchema } from './profile';

/**
 * Version of the consent text shown to the user. Bump it when the text changes: a consent given to an
 * older version no longer counts, so the app asks again (spec 002 AC13, AC14).
 */
export const CONSENT_VERSION = '2026-11-v2';

export const ConsentKindSchema = z.enum(['health_data']);
export type ConsentKind = z.infer<typeof ConsentKindSchema>;

export const ConsentRequestSchema = z.object({
  kind: ConsentKindSchema,
  /** Only the current text can be accepted. */
  version: z.literal(CONSENT_VERSION),
});
export type ConsentRequest = z.infer<typeof ConsentRequestSchema>;

const datetime = z.iso.datetime({ offset: true });

export const ExportResponseSchema = z.object({
  exportedAt: datetime,
  userId: z.uuid(),
  email: z.string().nullable(),
  profile: ProfileSchema.nullable(),
  dietaryPrefs: DietaryPrefsSchema.nullable(),
  targets: z.array(StoredTargetsSchema.extend({ validTo: datetime.nullable() })),
  consents: z.array(
    z.object({
      kind: ConsentKindSchema,
      version: z.string(),
      grantedAt: datetime,
      revokedAt: datetime.nullable(),
    }),
  ),
  aiUsage: z.array(
    z.object({
      feature: z.string(),
      model: z.string(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      createdAt: datetime,
    }),
  ),
});
export type ExportResponse = z.infer<typeof ExportResponseSchema>;
