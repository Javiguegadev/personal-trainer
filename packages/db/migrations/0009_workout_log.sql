CREATE TYPE "public"."activity_type" AS ENUM('football', 'padel', 'running', 'cycling', 'swimming', 'walking', 'group_class', 'other');--> statement-breakpoint
CREATE TYPE "public"."equipment" AS ENUM('barbell', 'dumbbell', 'machine', 'cable', 'kettlebell', 'band', 'bodyweight', 'other');--> statement-breakpoint
CREATE TYPE "public"."exercise_category" AS ENUM('strength', 'cardio', 'mobility', 'plyometrics', 'other');--> statement-breakpoint
CREATE TYPE "public"."exercise_origin" AS ENUM('catalog', 'user');--> statement-breakpoint
CREATE TYPE "public"."exercise_tracking" AS ENUM('weight_reps', 'reps', 'duration', 'distance_duration');--> statement-breakpoint
CREATE TYPE "public"."muscle_group" AS ENUM('chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core', 'full_body');--> statement-breakpoint
CREATE TYPE "public"."workout_input_method" AS ENUM('live', 'manual', 'repeat', 'activity');--> statement-breakpoint
CREATE TYPE "public"."workout_kind" AS ENUM('gym', 'sport', 'cardio', 'other');--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text,
	"origin" "exercise_origin" DEFAULT 'catalog' NOT NULL,
	"owner_id" uuid,
	"source" text,
	"source_id" text,
	"name_es" text NOT NULL,
	"name_en" text NOT NULL,
	"synonyms_es" text[] DEFAULT '{}'::text[] NOT NULL,
	"synonyms_en" text[] DEFAULT '{}'::text[] NOT NULL,
	"tracking" "exercise_tracking" NOT NULL,
	"category" "exercise_category" NOT NULL,
	"primary_muscles" "muscle_group"[] DEFAULT '{}' NOT NULL,
	"secondary_muscles" "muscle_group"[] DEFAULT '{}' NOT NULL,
	"equipment" "equipment"[] DEFAULT '{}' NOT NULL,
	"popularity" smallint DEFAULT 0 NOT NULL,
	"recorded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercises_key_unique" UNIQUE("key"),
	CONSTRAINT "exercises_source_record_key" UNIQUE("source","source_id"),
	CONSTRAINT "exercises_owner_matches_origin" CHECK (("exercises"."owner_id" is null) = ("exercises"."origin" = 'catalog')),
	CONSTRAINT "exercises_custom_recorded" CHECK ("exercises"."origin" = 'catalog' or "exercises"."recorded_at" is not null),
	CONSTRAINT "exercises_name_length" CHECK (length("exercises"."name_es") between 1 and 80 and length("exercises"."name_en") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "exercises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workout_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_id" uuid,
	"exercise_label" text NOT NULL,
	"tracking" "exercise_tracking" NOT NULL,
	"position" smallint NOT NULL,
	"set_number" smallint NOT NULL,
	"reps" smallint,
	"weight_kg" numeric(5, 2),
	"duration_s" integer,
	"distance_m" integer,
	"rest_s" smallint,
	CONSTRAINT "workout_sets_position_key" UNIQUE("workout_id","position","set_number"),
	CONSTRAINT "workout_sets_reps_range" CHECK ("workout_sets"."reps" is null or "workout_sets"."reps" between 1 and 100),
	CONSTRAINT "workout_sets_weight_range" CHECK ("workout_sets"."weight_kg" is null or "workout_sets"."weight_kg" between 0 and 500),
	CONSTRAINT "workout_sets_duration_range" CHECK ("workout_sets"."duration_s" is null or "workout_sets"."duration_s" between 1 and 10800),
	CONSTRAINT "workout_sets_distance_range" CHECK ("workout_sets"."distance_m" is null or "workout_sets"."distance_m" between 1 and 100000),
	CONSTRAINT "workout_sets_rest_range" CHECK ("workout_sets"."rest_s" is null or "workout_sets"."rest_s" between 0 and 900)
);
--> statement-breakpoint
ALTER TABLE "workout_sets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"kind" "workout_kind" NOT NULL,
	"activity" "activity_type",
	"name" text,
	"started_at" timestamp with time zone NOT NULL,
	"minutes" smallint NOT NULL,
	"session_rpe" smallint,
	"input_method" "workout_input_method" NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workouts_minutes_range" CHECK ("workouts"."minutes" between 1 and 600),
	CONSTRAINT "workouts_rpe_range" CHECK ("workouts"."session_rpe" is null or "workouts"."session_rpe" between 1 and 10),
	CONSTRAINT "workouts_name_length" CHECK ("workouts"."name" is null or length("workouts"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "workouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_source_knowledge_sources_id_fk" FOREIGN KEY ("source") REFERENCES "public"."knowledge_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercises_owner_id_idx" ON "exercises" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "workout_sets_workout_id_idx" ON "workout_sets" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "workout_sets_user_exercise_idx" ON "workout_sets" USING btree ("user_id","exercise_id");--> statement-breakpoint
CREATE INDEX "workouts_user_date_idx" ON "workouts" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE POLICY "exercises_select_catalog_or_own" ON "exercises" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("exercises"."owner_id" is null or "exercises"."owner_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "workout_sets_select_own" ON "workout_sets" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("workout_sets"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "workouts_select_own" ON "workouts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("workouts"."user_id" = (select auth.uid()));