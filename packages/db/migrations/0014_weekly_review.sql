CREATE TYPE "public"."review_status" AS ENUM('proposed', 'no_change', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "weekly_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" "review_status" NOT NULL,
	"kcal_delta" smallint,
	"from_kcal" smallint,
	"to_kcal" smallint,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"inputs" jsonb NOT NULL,
	"rules_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "weekly_reviews_user_week_unique" UNIQUE("user_id","week_start"),
	CONSTRAINT "weekly_reviews_proposal" CHECK (("weekly_reviews"."kcal_delta" is null and "weekly_reviews"."from_kcal" is null and "weekly_reviews"."to_kcal" is null) or ("weekly_reviews"."kcal_delta" <> 0 and "weekly_reviews"."kcal_delta" between -300 and 300 and "weekly_reviews"."from_kcal" > 0 and "weekly_reviews"."to_kcal" > 0)),
	CONSTRAINT "weekly_reviews_status" CHECK (case when "weekly_reviews"."status" = 'no_change' then "weekly_reviews"."kcal_delta" is null else "weekly_reviews"."kcal_delta" is not null end),
	CONSTRAINT "weekly_reviews_week_start_monday" CHECK (extract(isodow from "weekly_reviews"."week_start") = 1)
);
--> statement-breakpoint
ALTER TABLE "weekly_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "energy_calibration_kcal" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_energy_calibration_range" CHECK ("profiles"."energy_calibration_kcal" between -300 and 300);--> statement-breakpoint
CREATE POLICY "weekly_reviews_select_own" ON "weekly_reviews" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("weekly_reviews"."user_id" = (select auth.uid()));