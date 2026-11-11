import type Anthropic from '@anthropic-ai/sdk';
import { FlagSafetyToolInputSchema, ProfileDraftToolInputSchema } from '@pt/contracts';
import { z } from 'zod';

/** Zod (contracts) → JSON Schema for the Messages API. The API re-validates every input with Zod. */
function inputSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete json.$schema;
  return json as Anthropic.Tool.InputSchema;
}

export const UPDATE_PROFILE_DRAFT = 'update_profile_draft';
export const FLAG_SAFETY = 'flag_safety';

export const ONBOARDING_TOOLS: Anthropic.Tool[] = [
  {
    name: UPDATE_PROFILE_DRAFT,
    description:
      "Save profile facts the user just gave. Send only the fields learned from the latest message; earlier fields are kept. Measurements keep the user's own unit.",
    input_schema: inputSchema(ProfileDraftToolInputSchema),
  },
  {
    name: FLAG_SAFETY,
    description:
      'Report a health situation that changes what the app may recommend: ed_soft_stop (eating disorder or self-harm signals), pregnancy (pregnant or breastfeeding), medical_condition.',
    input_schema: inputSchema(FlagSafetyToolInputSchema),
  },
];
