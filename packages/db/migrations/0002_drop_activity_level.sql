ALTER TABLE "profiles" DROP COLUMN "activity_level";--> statement-breakpoint
DROP TYPE "public"."activity_level";--> statement-breakpoint
-- Spec 002 AC17: accounts created before the job and training split fill in the profile form again
-- (prefilled with their stored values) and get targets-v2 when they confirm it.
UPDATE "profiles" SET "onboarding_completed_at" = NULL;
