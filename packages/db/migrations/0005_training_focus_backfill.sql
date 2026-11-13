-- Spec 004 AC13: every existing account gets a focus. Gaining weight most likely means building muscle;
-- everyone else keeps the numbers of targets-v2 (health and general fitness). Their targets move to
-- targets-v3 on the next profile save or weight entry.
INSERT INTO "training_profiles" ("user_id", "focus")
SELECT "id", CASE WHEN "requested_goal" = 'gain' THEN 'hypertrophy'::"training_focus" ELSE 'general_fitness'::"training_focus" END
FROM "profiles"
ON CONFLICT ("user_id") DO NOTHING;