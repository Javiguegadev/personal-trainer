CREATE TABLE "body_measurements" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"weight_kg" numeric(5, 2) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_measurements_user_id_local_date_pk" PRIMARY KEY("user_id","local_date"),
	CONSTRAINT "body_measurements_weight_kg_range" CHECK ("body_measurements"."weight_kg" between 30 and 300)
);
--> statement-breakpoint
ALTER TABLE "body_measurements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "body_measurements_select_own" ON "body_measurements" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("body_measurements"."user_id" = (select auth.uid()));--> statement-breakpoint
-- Spec 003 AC27: every existing profile gets one entry, its profile weight, dated on the day (UTC) the
-- profile was last updated.
INSERT INTO "body_measurements" ("user_id", "local_date", "weight_kg", "recorded_at")
SELECT "id", ("updated_at" AT TIME ZONE 'UTC')::date, "weight_kg", "updated_at" FROM "profiles";
