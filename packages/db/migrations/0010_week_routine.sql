CREATE TYPE "public"."equipment_access" AS ENUM('full_gym', 'home_dumbbells', 'bodyweight');--> statement-breakpoint
CREATE TYPE "public"."program_origin" AS ENUM('template', 'user');--> statement-breakpoint
CREATE TYPE "public"."training_experience" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."work_pattern" AS ENUM('fixed', 'shifts', 'irregular', 'none');--> statement-breakpoint
ALTER TYPE "public"."workout_input_method" ADD VALUE 'program';--> statement-breakpoint
CREATE TABLE "planned_activity_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint,
	"is_match" boolean DEFAULT false NOT NULL,
	CONSTRAINT "planned_activity_days_weekday_key" UNIQUE("activity_id","weekday"),
	CONSTRAINT "planned_activity_days_weekday_range" CHECK ("planned_activity_days"."weekday" between 1 and 7),
	CONSTRAINT "planned_activity_days_start_range" CHECK ("planned_activity_days"."start_minute" is null or "planned_activity_days"."start_minute" between 0 and 1439)
);
--> statement-breakpoint
ALTER TABLE "planned_activity_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_blocks" (
	"user_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	CONSTRAINT "work_blocks_user_id_weekday_pk" PRIMARY KEY("user_id","weekday"),
	CONSTRAINT "work_blocks_weekday_range" CHECK ("work_blocks"."weekday" between 1 and 7),
	CONSTRAINT "work_blocks_minutes_range" CHECK ("work_blocks"."start_minute" between 0 and 1439 and "work_blocks"."end_minute" between 0 and 1439 and "work_blocks"."start_minute" <> "work_blocks"."end_minute")
);
--> statement-breakpoint
ALTER TABLE "work_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"exercise_id" uuid,
	"exercise_label" text NOT NULL,
	"tracking" "exercise_tracking" NOT NULL,
	"sets" smallint NOT NULL,
	"reps_min" smallint,
	"reps_max" smallint,
	"duration_s" integer,
	"rest_s" smallint,
	CONSTRAINT "program_exercises_sets_range" CHECK ("program_exercises"."sets" between 1 and 10),
	CONSTRAINT "program_exercises_reps_range" CHECK (("program_exercises"."reps_min" is null and "program_exercises"."reps_max" is null) or ("program_exercises"."reps_min" between 1 and 100 and "program_exercises"."reps_max" between "program_exercises"."reps_min" and 100)),
	CONSTRAINT "program_exercises_duration_range" CHECK ("program_exercises"."duration_s" is null or "program_exercises"."duration_s" between 1 and 10800),
	CONSTRAINT "program_exercises_rest_range" CHECK ("program_exercises"."rest_s" is null or "program_exercises"."rest_s" between 0 and 900)
);
--> statement-breakpoint
ALTER TABLE "program_exercises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"program_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "program_sessions_name_length" CHECK (length("program_sessions"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "program_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workout_programs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"origin" "program_origin" NOT NULL,
	"template_key" text,
	"recorded_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_programs_name_length" CHECK (length("workout_programs"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "workout_programs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lifestyle_profiles" ADD COLUMN "work_pattern" "work_pattern";--> statement-breakpoint
ALTER TABLE "lifestyle_profiles" ADD COLUMN "day_start_minute" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "training_profiles" ADD COLUMN "experience" "training_experience";--> statement-breakpoint
ALTER TABLE "training_profiles" ADD COLUMN "equipment" "equipment_access";--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "program_session_id" uuid;--> statement-breakpoint
ALTER TABLE "planned_activity_days" ADD CONSTRAINT "planned_activity_days_activity_id_planned_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."planned_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_activity_days" ADD CONSTRAINT "planned_activity_days_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_blocks" ADD CONSTRAINT "work_blocks_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_session_id_program_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."program_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_sessions" ADD CONSTRAINT "program_sessions_program_id_workout_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."workout_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_sessions" ADD CONSTRAINT "program_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_programs" ADD CONSTRAINT "workout_programs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_activity_days_user_id_idx" ON "planned_activity_days" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "program_exercises_session_id_idx" ON "program_exercises" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "program_exercises_user_id_idx" ON "program_exercises" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "program_sessions_program_id_idx" ON "program_sessions" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_programs_one_active_idx" ON "workout_programs" USING btree ("user_id") WHERE "workout_programs"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_program_session_id_program_sessions_id_fk" FOREIGN KEY ("program_session_id") REFERENCES "public"."program_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workouts_user_program_session_idx" ON "workouts" USING btree ("user_id","program_session_id");--> statement-breakpoint
ALTER TABLE "lifestyle_profiles" ADD CONSTRAINT "lifestyle_profiles_day_start_range" CHECK ("lifestyle_profiles"."day_start_minute" between 0 and 360 and "lifestyle_profiles"."day_start_minute" % 30 = 0);--> statement-breakpoint
CREATE POLICY "planned_activity_days_select_own" ON "planned_activity_days" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("planned_activity_days"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "work_blocks_select_own" ON "work_blocks" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("work_blocks"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "program_exercises_select_own" ON "program_exercises" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("program_exercises"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "program_sessions_select_own" ON "program_sessions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("program_sessions"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "workout_programs_select_own" ON "workout_programs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("workout_programs"."user_id" = (select auth.uid()));