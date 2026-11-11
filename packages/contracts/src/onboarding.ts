import { z } from 'zod';
import {
  ActivityLevelSchema,
  DietTypeSchema,
  GoalSchema,
  HeightCmSchema,
  IsoDateSchema,
  LengthMeasurementSchema,
  LocaleSchema,
  PROFILE_LIMITS,
  ReportedHealthFlagSchema,
  SafetyEvaluationSchema,
  SexSchema,
  TargetsBreakdownSchema,
  TargetsSchema,
  WeightKgSchema,
  WeightMeasurementSchema,
} from './profile';

export const ONBOARDING_LIMITS = {
  /** Messages per chat request (the client sends the whole conversation; nothing is stored). */
  messagesPerRequest: 40,
  messageChars: 2000,
  /** AC12: chat messages per user per rolling 24 h. */
  messagesPerDay: 40,
} as const;

const list = z
  .array(z.string().trim().min(1).max(PROFILE_LIMITS.listItemMax))
  .max(PROFILE_LIMITS.listMax);

/** The profile collected so far during onboarding. Metric; every field optional. */
export const OnboardingDraftSchema = z.object({
  sex: SexSchema.optional(),
  birthDate: IsoDateSchema.optional(),
  heightCm: HeightCmSchema.optional(),
  weightKg: WeightKgSchema.optional(),
  targetWeightKg: WeightKgSchema.optional(),
  activityLevel: ActivityLevelSchema.optional(),
  goal: GoalSchema.optional(),
  dietType: DietTypeSchema.optional(),
  allergies: list.optional(),
  dislikes: list.optional(),
  restrictions: list.optional(),
  injuries: z.string().trim().max(PROFILE_LIMITS.textMax).optional(),
  healthFlags: z.array(ReportedHealthFlagSchema).max(3).optional(),
});
export type OnboardingDraft = z.infer<typeof OnboardingDraftSchema>;

/** Fields that must be present before the summary can be shown. */
export const REQUIRED_DRAFT_FIELDS = [
  'sex',
  'birthDate',
  'heightCm',
  'weightKg',
  'activityLevel',
  'goal',
  'dietType',
] as const satisfies readonly (keyof OnboardingDraft)[];
export const RequiredDraftFieldSchema = z.enum(REQUIRED_DRAFT_FIELDS);
export type RequiredDraftField = z.infer<typeof RequiredDraftFieldSchema>;

/**
 * Input of the AI tool `update_profile_draft`. Measurements keep the user's unit; @pt/core converts
 * them (the AI chooses, the code computes). Range checks happen after conversion.
 */
export const ProfileDraftToolInputSchema = z.object({
  sex: SexSchema.optional(),
  birthDate: IsoDateSchema.optional(),
  /** When the user gives an age instead of a birth date; @pt/core derives an approximate birth date. */
  ageYears: z.number().int().min(0).max(120).optional(),
  height: LengthMeasurementSchema.optional(),
  weight: WeightMeasurementSchema.optional(),
  targetWeight: WeightMeasurementSchema.optional(),
  activityLevel: ActivityLevelSchema.optional(),
  goal: GoalSchema.optional(),
  dietType: DietTypeSchema.optional(),
  allergies: list.optional(),
  dislikes: list.optional(),
  restrictions: list.optional(),
  injuries: z.string().trim().max(PROFILE_LIMITS.textMax).optional(),
});
export type ProfileDraftToolInput = z.infer<typeof ProfileDraftToolInputSchema>;

/** Input of the AI tool `flag_safety`. */
export const FlagSafetyToolInputSchema = z.object({
  flag: ReportedHealthFlagSchema,
});
export type FlagSafetyToolInput = z.infer<typeof FlagSafetyToolInputSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(ONBOARDING_LIMITS.messageChars),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const OnboardingChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(ONBOARDING_LIMITS.messagesPerRequest),
  draft: OnboardingDraftSchema,
  locale: LocaleSchema,
  /** The user's local date, so the AI can turn "I'm 30" into a birth date. */
  today: IsoDateSchema,
});
export type OnboardingChatRequest = z.infer<typeof OnboardingChatRequestSchema>;

export const OnboardingChatResponseSchema = z.object({
  reply: z.string(),
  draft: OnboardingDraftSchema,
  missing: z.array(RequiredDraftFieldSchema),
  /** True when the AI raised `ed_soft_stop`: the UI shows support resources (AC20). */
  softStop: z.boolean(),
});
export type OnboardingChatResponse = z.infer<typeof OnboardingChatResponseSchema>;

export const TargetsPreviewResponseSchema = z.object({
  targets: TargetsSchema,
  breakdown: TargetsBreakdownSchema,
  safety: SafetyEvaluationSchema,
});
export type TargetsPreviewResponse = z.infer<typeof TargetsPreviewResponseSchema>;
