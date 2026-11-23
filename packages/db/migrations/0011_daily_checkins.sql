CREATE TYPE "public"."checkin_source" AS ENUM('manual', 'health_import');--> statement-breakpoint
CREATE TYPE "public"."stress_level" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."work_shift" AS ENUM('morning', 'afternoon', 'night', 'off');--> statement-breakpoint
CREATE TABLE "daily_checkins" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"sleep_minutes" smallint,
	"stress" "stress_level",
	"work_shift" "work_shift",
	"shift_start_minute" smallint,
	"shift_end_minute" smallint,
	"source" "checkin_source" DEFAULT 'manual' NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_checkins_user_id_local_date_pk" PRIMARY KEY("user_id","local_date"),
	CONSTRAINT "daily_checkins_sleep_range" CHECK ("daily_checkins"."sleep_minutes" is null or "daily_checkins"."sleep_minutes" between 0 and 960),
	CONSTRAINT "daily_checkins_shift_minutes_range" CHECK (("daily_checkins"."shift_start_minute" is null or "daily_checkins"."shift_start_minute" between 0 and 1439) and ("daily_checkins"."shift_end_minute" is null or "daily_checkins"."shift_end_minute" between 0 and 1439)),
	CONSTRAINT "daily_checkins_shift_hours" CHECK (case when "daily_checkins"."work_shift" in ('morning', 'afternoon', 'night') then "daily_checkins"."shift_start_minute" is not null and "daily_checkins"."shift_end_minute" is not null and "daily_checkins"."shift_start_minute" <> "daily_checkins"."shift_end_minute" else "daily_checkins"."shift_start_minute" is null and "daily_checkins"."shift_end_minute" is null end)
);
--> statement-breakpoint
ALTER TABLE "daily_checkins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_checkins" ADD CONSTRAINT "daily_checkins_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "daily_checkins_select_own" ON "daily_checkins" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("daily_checkins"."user_id" = (select auth.uid()));