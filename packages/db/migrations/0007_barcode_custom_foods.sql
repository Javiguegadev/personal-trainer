CREATE TYPE "public"."food_origin" AS ENUM('catalog', 'off', 'manual', 'label');--> statement-breakpoint
CREATE TYPE "public"."quantity_unit" AS ENUM('g', 'ml');--> statement-breakpoint
ALTER TYPE "public"."food_input_method" ADD VALUE 'barcode';--> statement-breakpoint
ALTER TYPE "public"."food_input_method" ADD VALUE 'label';--> statement-breakpoint
ALTER TYPE "public"."food_input_method" ADD VALUE 'custom';--> statement-breakpoint
CREATE TABLE "barcode_misses" (
	"barcode" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "barcode_misses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "origin" "food_origin" DEFAULT 'catalog' NOT NULL;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "quantity_unit" "quantity_unit" DEFAULT 'g' NOT NULL;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "allergens" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "traces" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meal_items" ADD COLUMN "quantity_unit" "quantity_unit" DEFAULT 'g' NOT NULL;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "foods_barcode_idx" ON "foods" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "foods_owner_id_idx" ON "foods" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "foods_owner_barcode_key" ON "foods" USING btree ("owner_id","barcode") WHERE "foods"."owner_id" is not null and "foods"."barcode" is not null;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_owner_matches_origin" CHECK (("foods"."owner_id" is null) = ("foods"."origin" in ('catalog', 'off')));--> statement-breakpoint
ALTER POLICY "food_servings_select_all" ON "food_servings" TO authenticated USING (exists (select 1 from "foods" f where f.id = "food_servings"."food_id" and (f.owner_id is null or f.owner_id = (select auth.uid()))));--> statement-breakpoint
ALTER POLICY "foods_select_all" ON "foods" TO authenticated USING ("foods"."owner_id" is null or "foods"."owner_id" = (select auth.uid()));