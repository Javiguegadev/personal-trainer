import { z } from 'zod';
import { DietaryPrefsSchema, ProfileSchema, StoredTargetsSchema } from './profile';

/** Version of the consent text shown to the user. Bump it when the text changes. */
export const CONSENT_VERSION = '2026-11';

export const ConsentKindSchema = z.enum(['health_data']);
export type ConsentKind = z.infer<typeof ConsentKindSchema>;

export const ConsentRequestSchema = z.object({
  kind: ConsentKindSchema,
  version: z.string().min(1).max(20),
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
