ALTER TYPE "public"."food_input_method" ADD VALUE 'plan';--> statement-breakpoint
CREATE TABLE "planned_meal_items" (
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
	"quantity_unit" "quantity_unit" DEFAULT 'g' NOT NULL,
	"kcal" numeric(7, 2) NOT NULL,
	"protein_g" numeric(7, 2) NOT NULL,
	"carbs_g" numeric(7, 2) NOT NULL,
	"fat_g" numeric(7, 2) NOT NULL,
	"fiber_g" numeric(7, 2),
	"recorded_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_meal_items_grams_range" CHECK ("planned_meal_items"."grams" is null or "planned_meal_items"."grams" between 1 and 2000),
	CONSTRAINT "planned_meal_items_nutrients_non_negative" CHECK ("planned_meal_items"."kcal" >= 0 and "planned_meal_items"."protein_g" >= 0 and "planned_meal_items"."carbs_g" >= 0 and "planned_meal_items"."fat_g" >= 0 and ("planned_meal_items"."fiber_g" is null or "planned_meal_items"."fiber_g" >= 0))
);
--> statement-breakpoint
ALTER TABLE "planned_meal_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "planned_workouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"start_minute" smallint,
	"kind" "workout_kind" NOT NULL,
	"activity" "activity_type",
	"name" text,
	"minutes" smallint,
	"is_match" boolean DEFAULT false NOT NULL,
	"program_session_id" uuid,
	"repeat_workout_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_workouts_start_minute_range" CHECK ("planned_workouts"."start_minute" is null or "planned_workouts"."start_minute" between 0 and 1439),
	CONSTRAINT "planned_workouts_minutes_range" CHECK ("planned_workouts"."minutes" is null or "planned_workouts"."minutes" between 1 and 600),
	CONSTRAINT "planned_workouts_name_length" CHECK ("planned_workouts"."name" is null or length("planned_workouts"."name") between 1 and 60),
	CONSTRAINT "planned_workouts_one_link" CHECK ("planned_workouts"."program_session_id" is null or "planned_workouts"."repeat_workout_id" is null),
	CONSTRAINT "planned_workouts_kind_fields" CHECK (("planned_workouts"."kind" = 'gym' and "planned_workouts"."activity" is null and "planned_workouts"."is_match" = false) or ("planned_workouts"."kind" <> 'gym' and "planned_workouts"."minutes" is not null))
);
--> statement-breakpoint
ALTER TABLE "planned_workouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meal_items" ADD COLUMN "planned_item_id" uuid;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "planned_workout_id" uuid;--> statement-breakpoint
ALTER TABLE "planned_meal_items" ADD CONSTRAINT "planned_meal_items_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_meal_items" ADD CONSTRAINT "planned_meal_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_meal_items" ADD CONSTRAINT "planned_meal_items_serving_id_food_servings_id_fk" FOREIGN KEY ("serving_id") REFERENCES "public"."food_servings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_program_session_id_program_sessions_id_fk" FOREIGN KEY ("program_session_id") REFERENCES "public"."program_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_repeat_workout_id_workouts_id_fk" FOREIGN KEY ("repeat_workout_id") REFERENCES "public"."workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_meal_items_user_date_idx" ON "planned_meal_items" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "planned_workouts_user_date_idx" ON "planned_workouts" USING btree ("user_id","local_date");--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_planned_item_id_planned_meal_items_id_fk" FOREIGN KEY ("planned_item_id") REFERENCES "public"."planned_meal_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_planned_workout_id_planned_workouts_id_fk" FOREIGN KEY ("planned_workout_id") REFERENCES "public"."planned_workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_items_user_planned_item_idx" ON "meal_items" USING btree ("user_id","planned_item_id");--> statement-breakpoint
CREATE INDEX "workouts_user_planned_workout_idx" ON "workouts" USING btree ("user_id","planned_workout_id");--> statement-breakpoint
CREATE POLICY "planned_meal_items_select_own" ON "planned_meal_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("planned_meal_items"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "planned_workouts_select_own" ON "planned_workouts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("planned_workouts"."user_id" = (select auth.uid()));