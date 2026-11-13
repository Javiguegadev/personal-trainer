CREATE TYPE "public"."training_focus" AS ENUM('hypertrophy', 'strength', 'sport_performance', 'general_fitness');--> statement-breakpoint
CREATE TABLE "training_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"focus" "training_focus" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_profiles" ADD CONSTRAINT "training_profiles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "training_profiles_select_own" ON "training_profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("training_profiles"."user_id" = (select auth.uid()));