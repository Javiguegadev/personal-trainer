CREATE TYPE "public"."activity_level" AS ENUM('sedentary', 'light', 'moderate', 'active', 'very_active');--> statement-breakpoint
CREATE TYPE "public"."consent_kind" AS ENUM('health_data');--> statement-breakpoint
CREATE TYPE "public"."diet_type" AS ENUM('omnivore', 'vegetarian', 'vegan', 'pescatarian', 'other');--> statement-breakpoint
CREATE TYPE "public"."goal" AS ENUM('lose', 'maintain', 'gain');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('es', 'en');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('female', 'male', 'other');--> statement-breakpoint
CREATE TYPE "public"."units" AS ENUM('metric', 'imperial');--> statement-breakpoint
CREATE TABLE "dietary_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"diet_type" "diet_type" NOT NULL,
	"allergies" text[] DEFAULT '{}'::text[] NOT NULL,
	"dislikes" text[] DEFAULT '{}'::text[] NOT NULL,
	"restrictions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dietary_prefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sex" "sex" NOT NULL,
	"birth_date" date NOT NULL,
	"height_cm" numeric(5, 1) NOT NULL,
	"weight_kg" numeric(5, 2) NOT NULL,
	"target_weight_kg" numeric(5, 2),
	"activity_level" "activity_level" NOT NULL,
	"goal" "goal" NOT NULL,
	"requested_goal" "goal" NOT NULL,
	"safety_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"injuries" text,
	"units" "units" DEFAULT 'metric' NOT NULL,
	"locale" "locale" DEFAULT 'es' NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_height_cm_range" CHECK ("profiles"."height_cm" between 120 and 230),
	CONSTRAINT "profiles_weight_kg_range" CHECK ("profiles"."weight_kg" between 30 and 300),
	CONSTRAINT "profiles_target_weight_kg_range" CHECK ("profiles"."target_weight_kg" is null or "profiles"."target_weight_kg" between 30 and 300)
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "nutrition_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kcal" integer NOT NULL,
	"protein_g" integer NOT NULL,
	"carbs_g" integer NOT NULL,
	"fat_g" integer NOT NULL,
	"fiber_g" integer NOT NULL,
	"formula_version" text NOT NULL,
	"clamped_reason" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "nutrition_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "consent_kind" NOT NULL,
	"version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dietary_prefs" ADD CONSTRAINT "dietary_prefs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nutrition_targets_user_valid_from_idx" ON "nutrition_targets" USING btree ("user_id","valid_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "consents_user_kind_idx" ON "consents" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "ai_usage_user_feature_created_idx" ON "ai_usage" USING btree ("user_id","feature","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "dietary_prefs_select_own" ON "dietary_prefs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("dietary_prefs"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profiles_select_own" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("profiles"."id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "nutrition_targets_select_own" ON "nutrition_targets" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("nutrition_targets"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "consents_select_own" ON "consents" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("consents"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "ai_usage_select_own" ON "ai_usage" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("ai_usage"."user_id" = (select auth.uid()));