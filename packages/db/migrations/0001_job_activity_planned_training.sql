CREATE TYPE "public"."activity_kind" AS ENUM('strength', 'cardio', 'sport', 'other');--> statement-breakpoint
CREATE TYPE "public"."intensity" AS ENUM('light', 'moderate', 'hard');--> statement-breakpoint
CREATE TYPE "public"."job_activity" AS ENUM('sedentary', 'standing', 'physical');--> statement-breakpoint
CREATE TABLE "lifestyle_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"job_activity" "job_activity" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lifestyle_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "planned_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "activity_kind" NOT NULL,
	"label" text,
	"sessions_per_week" smallint NOT NULL,
	"minutes_per_session" smallint NOT NULL,
	"intensity" "intensity" NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_activities_sessions_range" CHECK ("planned_activities"."sessions_per_week" between 1 and 14),
	CONSTRAINT "planned_activities_minutes_range" CHECK ("planned_activities"."minutes_per_session" between 10 and 240),
	CONSTRAINT "planned_activities_label_length" CHECK ("planned_activities"."label" is null or length("planned_activities"."label") <= 40)
);
--> statement-breakpoint
ALTER TABLE "planned_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lifestyle_profiles" ADD CONSTRAINT "lifestyle_profiles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_activities" ADD CONSTRAINT "planned_activities_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_activities_user_id_idx" ON "planned_activities" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "lifestyle_profiles_select_own" ON "lifestyle_profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("lifestyle_profiles"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "planned_activities_select_own" ON "planned_activities" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("planned_activities"."user_id" = (select auth.uid()));