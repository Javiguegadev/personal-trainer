CREATE TYPE "public"."food_input_method" AS ENUM('search', 'recent', 'favourite', 'repeat', 'quick_add');--> statement-breakpoint
CREATE TYPE "public"."meal_type" AS ENUM('breakfast', 'mid_morning', 'lunch', 'afternoon_snack', 'dinner', 'other');--> statement-breakpoint
CREATE TABLE "favourite_foods" (
	"user_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favourite_foods_user_id_food_id_pk" PRIMARY KEY("user_id","food_id")
);
--> statement-breakpoint
ALTER TABLE "favourite_foods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "food_servings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"food_id" uuid NOT NULL,
	"label_es" text NOT NULL,
	"label_en" text NOT NULL,
	"grams" numeric(6, 1) NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "food_servings_grams_positive" CHECK ("food_servings"."grams" > 0)
);
--> statement-breakpoint
ALTER TABLE "food_servings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"name_es" text NOT NULL,
	"name_en" text NOT NULL,
	"synonyms_es" text[] DEFAULT '{}'::text[] NOT NULL,
	"popularity" smallint DEFAULT 0 NOT NULL,
	"kcal_100g" numeric(6, 2) NOT NULL,
	"protein_g_100g" numeric(6, 2) NOT NULL,
	"carbs_g_100g" numeric(6, 2) NOT NULL,
	"fat_g_100g" numeric(6, 2) NOT NULL,
	"fiber_g_100g" numeric(6, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foods_key_unique" UNIQUE("key"),
	CONSTRAINT "foods_source_source_id_key" UNIQUE("source","source_id"),
	CONSTRAINT "foods_nutrients_non_negative" CHECK ("foods"."kcal_100g" >= 0 and "foods"."protein_g_100g" >= 0 and "foods"."carbs_g_100g" >= 0 and "foods"."fat_g_100g" >= 0 and ("foods"."fiber_g_100g" is null or "foods"."fiber_g_100g" >= 0))
);
--> statement-breakpoint
ALTER TABLE "foods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"license" text NOT NULL,
	"version" text NOT NULL,
	"attribution_es" text NOT NULL,
	"attribution_en" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meal_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"food_id" uuid,
	"serving_id" uuid,
	"servings" numeric(4, 2),
	"serving_label" text,
	"label" text NOT NULL,
	"grams" numeric(6, 1),
	"kcal" numeric(7, 2) NOT NULL,
	"protein_g" numeric(7, 2) NOT NULL,
	"carbs_g" numeric(7, 2) NOT NULL,
	"fat_g" numeric(7, 2) NOT NULL,
	"fiber_g" numeric(7, 2),
	"input_method" "food_input_method" NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_items_grams_range" CHECK ("meal_items"."grams" is null or "meal_items"."grams" between 1 and 2000),
	CONSTRAINT "meal_items_nutrients_non_negative" CHECK ("meal_items"."kcal" >= 0 and "meal_items"."protein_g" >= 0 and "meal_items"."carbs_g" >= 0 and "meal_items"."fat_g" >= 0 and ("meal_items"."fiber_g" is null or "meal_items"."fiber_g" >= 0))
);
--> statement-breakpoint
ALTER TABLE "meal_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "favourite_foods" ADD CONSTRAINT "favourite_foods_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourite_foods" ADD CONSTRAINT "favourite_foods_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_source_knowledge_sources_id_fk" FOREIGN KEY ("source") REFERENCES "public"."knowledge_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_serving_id_food_servings_id_fk" FOREIGN KEY ("serving_id") REFERENCES "public"."food_servings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_servings_food_id_idx" ON "food_servings" USING btree ("food_id","sort");--> statement-breakpoint
CREATE INDEX "meal_items_user_date_idx" ON "meal_items" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "meal_items_user_food_recorded_idx" ON "meal_items" USING btree ("user_id","food_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "favourite_foods_select_own" ON "favourite_foods" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("favourite_foods"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "food_servings_select_all" ON "food_servings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "foods_select_all" ON "foods" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "knowledge_sources_select_all" ON "knowledge_sources" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "meal_items_select_own" ON "meal_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("meal_items"."user_id" = (select auth.uid()));