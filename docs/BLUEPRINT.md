# Blueprint: AI Nutrition & Fitness App (mobile-first, touch-first)

> Source of truth for product and architecture. Changes get an ADR in `docs/adr/`.
> v2 (2026-11-10): mobile-first with a single Expo universal app, AI as the primary input method, fewer
> services, RevenueCat + Paddle, and a knowledge base built from official data. See ADR 002.
> v3 (2026-11-12): user context as a read model, activity split into job and planned training, weekly
> review and daily check-in in the MVP, beta before payments. See ADR 003.
> v4 (2026-11-12): touch-first input with AI as a shortcut, onboarding by form, a chat for questions in
> the beta, voice messages. See ADR 004.
> v5 (2026-11-16): a week view in E5 and manual planning of meals and sessions (E5c) before the beta.
> See ADR 006.

## 0. Product principles

1. **Mobile-first.** Logging happens at the table and in the gym. One Expo app ships to iOS, Android and
   the web from the same screens. The web build launches first and the stores follow when ready.
2. **Touch first, AI where it is faster.** Structured data is entered with taps and forms. A photo, or a
   typed or spoken sentence, is a shortcut that always produces an editable draft. The chat is for
   questions about the recommendations. The AI does the work behind the screen: matching foods, building
   plans, explaining.
3. **Evidence-based.** The AI answers from a curated knowledge base: official food composition
   databases, exercise databases and published guidelines, with sources cited. It never answers from its
   memory alone.
4. **The AI chooses, the code computes.** Claude picks foods and exercises _from our catalog_ and proposes
   quantities. `@pt/core` computes every number and validates safety rules.
5. **Few services.** Every vendor is an account, an invoice, a DPA and a failure point. Add one only when
   it removes more work than it creates.
6. **Privacy by design (EU).** Health data is GDPR special-category data, so it is stored in the EU,
   collected with explicit consent, and users can export or delete it.
7. **One visible context.** Recommendations come from one typed user context (profile, routine, daily
   signals, logs) that the user can read and edit. Every datum we ask for must change something the user
   can see.

## 1. Stack

| Layer                     | Choice                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Monorepo                  | pnpm workspaces + Turborepo                                                                                                    |
| App (iOS, Android, web)   | **Expo SDK 58 + Expo Router** (universal), web output `single` (SPA)                                                           |
| Landing (SEO, at launch)  | **Astro** static site (`apps/landing`, created in stage E9)                                                                    |
| API                       | **Hono** + `@hono/zod-openapi` on Vercel (Node, region `fra1`)                                                                 |
| Data                      | **Supabase** (EU): Postgres, Auth, Storage, Edge Functions, Cron, Queues, pgvector                                             |
| ORM                       | Drizzle                                                                                                                        |
| AI                        | Anthropic API via `@anthropic-ai/sdk`: **Claude Opus 5.5** (deep reasoning) + **Claude Haiku 5.5** (fast, high volume, vision) |
| Payments                  | **RevenueCat** (App Store / Google Play in-app + single entitlement source) + **Paddle** (web checkout, merchant of record)    |
| Builds & store submission | Expo EAS (build, submit, OTA updates)                                                                                          |
| Errors                    | Sentry (`@sentry/react-native` + API)                                                                                          |
| Product analytics         | PostHog EU, added only when there are users to measure                                                                         |
| Tests                     | Vitest · Playwright (web build) · Maestro (native E2E, before store launch)                                                    |

### Services (7) and what was dropped

| Keep       | Why                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| Supabase   | DB, auth, files, cron and queues in one EU vendor                                                     |
| Vercel     | Hosts the API, and later the web app and landing                                                      |
| Expo EAS   | Native builds and store submission without Xcode/Android Studio                                       |
| RevenueCat | In-app purchases on both stores; unifies web + app entitlements                                       |
| Paddle     | Web payments as merchant of record: handles EU VAT, invoices, Apple Pay / Google Pay / cards / PayPal |
| Anthropic  | AI                                                                                                    |
| Sentry     | Crash and error reporting (free tier)                                                                 |

**Dropped:** Next.js (replaced by Expo universal), Fly.io, Stripe direct, Inngest (replaced by Supabase
Cron + Queues), Upstash (rate limits live in Postgres). **Considered:** Lemon Squeezy supports Apple Pay
(Safari) and Google Pay (Chrome), but has no RevenueCat integration, so web and app entitlements would need
a custom bridge.

## 2. Monorepo structure

```
apps/
  app/          Expo Router universal app: iOS, Android, web (src/app = routes)
  api/          Hono API: business endpoints, AI orchestration, payment webhooks
  landing/      Astro marketing site (stage E9)
packages/
  core/         Pure domain logic: nutrition, training, scoring, entitlements, safety rules
  contracts/    Zod schemas: API payloads, AI tool inputs/outputs
  api-client/   Typed API client (+ TanStack Query hooks)
  db/           Drizzle schema, migrations, seeds, knowledge-base importers
  ai/           Prompts, Claude client, tools, retrieval, evals, cost metering
  ui/ · i18n/   Design tokens · translations (es, en)
  config/       TS presets
```

Dependency rules are unchanged and enforced by ESLint: `core` is pure, `contracts` is zod-only, and only
`apps/api` imports `db` and `ai`.

## 3. Feature map

| Feature                 | How the user does it                                                                                | Model           | Free         | Premium   |
| ----------------------- | --------------------------------------------------------------------------------------------------- | --------------- | ------------ | --------- |
| Onboarding              | A form with taps; `core` computes the targets                                                       | none (`core`)   | ✅           | ✅        |
| Typical week            | A week grid edited with taps; a one-sentence shortcut is optional                                   | Haiku           | ✅           | ✅        |
| **Food logging**        | Search, recents, favourites and barcode first; a **photo of the plate** or a sentence as a shortcut | Haiku (vision)  | ✅ daily cap | Unlimited |
| Nutrition label reading | Photo of the label when a barcode isn't in the database                                             | Haiku (vision)  | ✅           | ✅        |
| **Week view**           | Seven days at a glance (work, training, meals); a tap opens the day (ADR 006)                       | none            | ✅           | ✅        |
| **Manual planning**     | Meals and sessions planned for the days ahead with taps; a planned item is logged in one tap        | none            | ✅           | ✅        |
| **Workout logging**     | Steppers for sets, reps and weight; a typed or spoken sentence as a shortcut                        | Haiku           | ✅           | ✅        |
| Daily feedback          | Short notes on what you logged ("protein low today, try…")                                          | Haiku           | ✅           | ✅        |
| Weekly insights         | Readable summary of habits and trends, with sources                                                 | Haiku (Batch)   | Basic        | Detailed  |
| Healthy swaps           | "Something lighter than this?" → alternatives from the catalog                                      | Haiku           | 3 per week   | ✅        |
| **Meal plans**          | Weekly plan tailored to goals, allergies and taste, plus shopping list                              | Opus            | Preview      | ✅        |
| **Workout programs**    | Program built from goal, days, equipment and experience, scheduled around work and sport            | Opus            | Preview      | ✅        |
| Daily readiness         | Two-tap check-in (sleep, stress); today's session adjusts and shows the reason                      | none (`core`)   | §10          | §10       |
| Weekly review           | Weight trend and adherence → proposed target change (accept/reject)                                 | none (`core`)   | §10          | §10       |
| **Questions assistant** | Chat about your targets, today's session and adjustments, by text or voice message, with citations  | Eval decides    | §10          | §10       |
| AI memory               | The AI proposes facts worth remembering; the user confirms, edits or deletes them                   | Calling feature | §10          | §10       |
| **Adaptive training**   | Weekly adjustment from adherence, RPE and PRs (accept/reject)                                       | Opus (Batch)    | –            | ✅        |
| **AI coach chat**       | Open coaching on your data, plans and programs, answered with citations                             | Opus + tools    | –            | ✅        |
| Personal challenges     | Weekly challenges generated from your history                                                       | Haiku           | ✅           | ✅        |

**Voice:** Claude takes text, images and PDFs, not audio (checked 2026-11-12). A voice message in the chat
is transcribed on the device (ADR 004) and shown to the user, and only the text reaches Claude: no new
vendor, and the audio is never uploaded or stored. It needs a native speech-recognition module and a
development build; where recognition is unavailable, keyboard dictation remains (it works in every text
field at no cost).

**Model routing:** Haiku 5.5 for high-volume and latency-sensitive tasks; Opus 5.5 for planning, coaching
and adaptation. Evals decide whether a task can move between models. **Claude Fable 5.2** ($8/$40 per M,
2× Opus, slower turns, requires 30-day data retention so no ZDR) is not used in the app by default: only
for a planning feature (meal plans, workout programs, adaptation) whose eval shows a measurable gain over
Opus 5.5, and as a candidate LLM judge for evals and offline knowledge-base review (reviewed 2026-11-11).

**Approximate cost per call** (API list prices):

| Task                        | Tokens (in/out) | Haiku 5.5 ($0.10/$0.50 per M) | Opus 5.5 ($4/$20 per M) |
| --------------------------- | --------------- | ----------------------------- | ----------------------- |
| Food log (text/photo)       | ~1.5k / 0.5k    | ~$0.0004                      | –                       |
| Weekly meal plan            | ~6k / 3k        | –                             | ~$0.08                  |
| Coach answer with retrieval | ~8k / 1k        | –                             | ~$0.05                  |

Target: AI cost under 15% of the subscription price per paying user. Free users run on Haiku, so a
generous free tier stays cheap.

## 4. Knowledge base: grounding the AI in official data

"Training the AI" here means **grounding**, not fine-tuning. Claude is not retrained. Instead it answers
from a curated, versioned knowledge base it queries through tools, and its outputs are validated by
`@pt/core`. This approach is cheaper and auditable, can be updated any day, and cites sources.

### Sources (verify each license before importing)

| Domain             | Source                                                                  | Use                                                                       |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Food composition   | **BEDCA** (Spanish database)                                            | Spanish foods and dishes                                                  |
|                    | **USDA FoodData Central**                                               | Broad generic coverage (public domain)                                    |
|                    | **CIQUAL** (ANSES, France)                                              | European foods                                                            |
|                    | **Open Food Facts**                                                     | Branded products and barcodes (ODbL: attribution + share-alike on the DB) |
| Exercises          | **wger** exercise database                                              | Exercises, muscles, equipment (CC-BY-SA)                                  |
|                    | **free-exercise-db**                                                    | Additional exercises and images                                           |
| Energy expenditure | **Compendium of Physical Activities**                                   | MET values for cardio and sports                                          |
| Guidelines         | **WHO** physical activity guidelines, **EFSA** dietary reference values | Safe targets and limits                                                   |
|                    | **ISSN / ACSM** position stands                                         | Protein, supplements, progression models                                  |
| Studies            | PubMed abstracts and PMC open-access articles                           | Summaries with citations; no full texts without an open license           |

### Pipeline

1. **Importers** (`packages/db/src/knowledge/`) download each source, normalize units (per 100 g, metric)
   and record `source`, `license`, `version` and `imported_at`.
2. **Structured data** (foods, exercises, MET values) goes into regular tables with full-text and trigram
   search. Most queries need exact numbers, not semantic search.
3. **Text knowledge** (guidelines, study summaries) goes into chunks with **pgvector** embeddings, generated
   by Supabase Edge Functions' built-in embedding model, so no extra vendor is needed.
4. **Tools for Claude:** `search_foods`, `get_food`, `search_exercises`, `get_guideline`, `get_user_stats`.
   The model must cite the IDs and sources it used.
5. **Validation:** `@pt/core` recomputes every number and enforces safety rules (calorie floor, allergens,
   volume progression) before anything reaches the user.
6. **Evals** (`packages/ai/evals/`): fixtures reviewed by a nutrition/training professional, run on every
   prompt, model or knowledge-base change.

## 5. Data model and user context

Target model (v3, ADR 003). Each table is created by the stage that needs it, with its own spec and
migration.

```
Identity, goals and declared context (valid_from / valid_to where history matters)
  profiles(id, sex, birth_date, height_cm, weight_kg*, goal, requested_goal, target_weight_kg, safety_flags[],
           units, locale)                       * copy of the latest body_measurements entry (ADR 005)
  dietary_prefs(user_id, diet_type, allergies[], dislikes[], restrictions[])
  lifestyle_profiles(user_id, job_activity[sedentary|standing|physical], work_pattern[fixed|shifts|irregular],
                     usual_sleep_minutes, day_start_minute, valid_from, valid_to)
  training_profiles(user_id, focus[hypertrophy|strength|sport_performance|general_fitness], experience,
                    days_per_week, session_minutes, equipment[])
  routine_blocks(user_id, weekday, start_minute, end_minute,
                 kind[work|sport_training|sport_match|gym_slot], label, demand)        ← the typical week
  injuries(id, user_id, body_region, severity, note, active)
  nutrition_targets(user_id, kcal, protein_g, carbs_g, fat_g, fiber_g, formula_version, valid_from, valid_to)
  consents(user_id, kind, version, granted_at, revoked_at)

Daily signals (one row per user and local_date, upsert)
  body_measurements(user_id, local_date, weight_kg, recorded_at)               ← spec 003
  daily_checkins(user_id, local_date, sleep_minutes?, stress?, energy?, soreness?, work_shift?,
                 source[manual|health_import])

Logs (instances, client-generated ids)
  meals(id, user_id, local_date, eaten_at, meal_type, input_method[text|photo|barcode|manual|saved|plan])
  meal_items(id, meal_id, food_id?, label, grams, kcal/protein/carbs/fat snapshot)
  saved_meals(id, user_id, name) → saved_meal_items                          (same shape as meal_items)
  workouts(id, user_id, local_date, started_at, kind[gym|sport], program_session_id?, minutes, session_rpe)
  workout_sets(id, workout_id, exercise_id, reps, weight, rpe, distance, duration) / personal_records

Plans (their items have the shape of the logs, so a planned meal or session is logged in one tap; written
by hand from E5c and by the AI from E7, never stored as log rows with a future date: ADR 006)
  meal_plans → plan_meals → plan_items
  workout_programs → program_sessions → planned_sets
  weekly_reviews(user_id, week_start, snapshot, proposal, decision[pending|accepted|rejected])

Catalog and knowledge
  foods(id, source, source_id, name_es, name_en, brand, barcode, per_100g kcal/protein/carbs/fat/fiber, license)
  food_servings(food_id, label, grams)
  exercises(id, source, name_es, name_en, category, muscle_groups[], equipment[], met_value)
  knowledge_sources(id, name, url, license, version, imported_at)
  knowledge_chunks(id, source_id, title, content, citation, embedding vector)

Memory, engagement and business
  user_memories(id, user_id, category, text, source[user|ai], status[proposed|active|archived])   ← stage E7
  coach_messages
  points_ledger / achievements / user_achievements / challenges
  entitlements(user_id, plan, status, provider[app_store|play_store|paddle], expires_at)  ← synced from RevenueCat
  ai_usage(id, user_id, feature, model, input_tokens, output_tokens, cost_usd, latency_ms, status)
```

Changes from v2:

- **Two goal axes:** `profiles.goal` is the weight direction (lose, maintain, gain) and drives calories.
  `training_profiles.focus` is what the training is for.
- **`activity_level` is split** into `lifestyle_profiles.job_activity` (daily life) and the planned
  training in `routine_blocks`. `targets-v2` adds the planned training energy to a daily-life factor, so
  exercise is counted once.
- **Weight is a time series** (`body_measurements`), which makes the trend and the weekly review possible.
  The latest entry is copied to `profiles.weight_kg` and recomputes the targets (ADR 005).
- **Injuries are structured**, so programs can filter exercises.
- **`meals` → `meal_items`** replaces the flat `meal_entries`: a photo or a sentence is one meal with
  several foods. Until a meal has data of its own (the plate photo, saved meals), spec 005 stores only
  `meal_items` with `user_id`, `local_date` and `meal_type`: a meal is the items of one day and meal
  type. Slice (c) (spec 007) stores no photo, so it adds only the `photo` and `text` input methods;
  the `meals` row arrives with saved meals or with a stored photo.

### User context (read model)

```
typed tables ─► @pt/core context functions (pure) ─► ContextSnapshot (Zod, versioned: context-v1)
                                                     ├─► core: targets, today's session, weekly review
                                                     └─► ai: one slice per feature, after the cached prefix
```

- **Not a store.** `buildContextSnapshot(sources, today)` computes the context from the tables above:
  daily-life factor, planned and actual training load, day readiness, adherence, weight trend,
  availability and preferences. Training and meal history are never entered twice: they are the logs.
- **Computed on read.** Its inputs are per-day aggregates, so a `daily_summaries` table can be added later
  without changing the contract. There is no JSONB context blob and no per-user vector memory (pgvector
  is for the knowledge base).
- **Hard and soft constraints.** Allergies, injuries, work hours and match days are validators in `core`
  that reject an AI output. Sleep, stress and tastes go into the prompt and into bounded deterministic
  rules. The AI explains them and never derives numbers from them.
- **One slice per feature.** Food logging receives tastes and frequent foods; program generation receives
  availability, load and injuries. The coach's `get_user_stats` tool reads from the same snapshot.
- **Traceable.** Every generated plan and weekly review stores the snapshot it was built from.
- **Visible.** The "What I know about you" screen lists every declared and learned item, and the user can
  edit or delete each one. AI-learned memories are proposals until the user confirms them (stage E7).

### Write and media conventions

- **Idempotent, offline-safe writes.** Logs use client-generated UUIDs and `PUT /resource/:id` upserts.
  The app persists the TanStack Query mutation queue, so a write made without coverage is sent once when
  the connection returns. A live workout session is a pure reducer in `core`, persisted on the device.
- **`local_date`.** Every log and daily signal carries the user's day plus a timestamp. The day starts at
  `day_start_minute` (midnight by default), so a shift worker's 02:00 meal counts for the right day.
- **Photos.** They are resized on the device before upload. The AI result is always an editable draft,
  never an automatic entry. Photos are not stored by default; if one is stored, it lives in a private
  bucket and account deletion removes it explicitly through the Storage API.

## 6. Payments

- **iOS / Android:** in-app subscriptions through RevenueCat (`react-native-purchases`). The stores
  charge their commission (15% under the small business programs). Apple Pay is built into the App Store
  sheet, and Google Pay into Play Billing.
- **Web:** Paddle checkout (cards, Apple Pay, Google Pay, PayPal). Paddle is the merchant of record:
  it collects and files VAT in every country and issues invoices.
- **One entitlement:** RevenueCat's Paddle integration imports web purchases, so a subscription bought
  on any platform unlocks Premium everywhere. The API mirrors entitlements into `entitlements` through
  the RevenueCat webhook.
- Check the integration's current limits before building (it supports Paddle Billing only, one product
  per checkout).

## 7. Stages (no dates: done when the criteria pass)

| Stage                                     | Scope                                                                                                     | Done when                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **E0 Accounts** ✅                        | Supabase (EU), Vercel, Expo, Anthropic (dev/prod keys with spend limits), Sentry                          | Accounts exist; secrets in a password manager                                              |
| **E1 Foundation** ✅                      | Monorepo, CI, Expo universal app, typed API                                                               | CI green; the app shows "API: online" on web                                               |
| **E2 Auth & AI onboarding**               | Supabase Auth (email, Google, Apple), conversational onboarding, targets, GDPR consent/export/delete      | Targets match a hand calculation; deleting the account removes all data                    |
| **E2b Logging & context foundations**     | "Today" hub, offline-safe writes, weight series, `targets-v2`, `ContextSnapshot` v1, onboarding by form   | Changing the job type changes the previewed targets; an offline weight entry syncs once    |
| **E4 AI food logging**                    | Food catalog and Spanish search, recents and favourites, barcode and label, then photo and text shortcuts | A full day is logged in under 1 minute; text and barcode totals within ±5% of a reference  |
| **E5 AI workout logging & daily context** | Training profile, typical week, week view, exercise library, live session, set logging, PRs, check-in     | Free-text sessions parse correctly in ≥ 95% of eval cases                                  |
| **E5c Weekly planner**                    | Meals and sessions planned by hand for the days ahead, shown on the week view, logged in one tap          | A planned week shows on the week view; a planned item never counts as eaten or done        |
| **E5b Adaptive loop**                     | Weekly review, streaks, "What I know about you" screen, questions assistant, one beta plan with AI caps   | A simulated four-week history gives the expected proposals; the assistant passes its evals |
| **— Beta (no paywall) —**                 | E2–E5b (E5c included)                                                                                     |                                                                                            |
| **E7 Premium AI**                         | Workout programs, meal plans, adaptive training, coach chat with citations, AI-learned memory             | Evals ≥ 95% valid, 0 allergen violations, hard constraints respected, cost target met      |
| **E6 Payments & limits**                  | RevenueCat + Paddle, entitlements, paywall, plan-based AI caps                                            | Buy on web → Premium in the app and vice versa (sandbox)                                   |
| **E8 Insights & engagement**              | Weekly insights, challenges, notifications                                                                | Weekly summary generated for all test users                                                |
| **E9 Launch**                             | Astro landing, legal pages, Sentry, store listings, TestFlight / Play testing → public                    | `release-check` green; apps approved                                                       |
| **E10 Later**                             | Leaderboards and leagues, HealthKit / Health Connect import, wearables, social                            | —                                                                                          |

- **Order.** The table is in execution order. Stage IDs keep their meaning, so E7 (Premium AI) runs before
  E6 (payments): the beta has no paywall, and payments arrive once there is something to sell.
- **E3 (knowledge base) is no longer a stage of its own.** Each source ships with the stage that needs
  it: foods in E4, exercises and MET values in E5, a first slice of the guidelines in E5b (for the
  questions assistant), the rest and the study summaries in E7.
- **Start now, because they have lead times:** Apple Developer and Google Play accounts, Paddle
  verification, the license review for BEDCA, CIQUAL and wger, and finding the professional reviewer.

Stage details (ADR 003):

- **E2b.** Tab shell with a "Today" hub: remaining calories and macros, today's session and quick actions to
  log a meal or a session. Idempotent offline-safe writes (§5). Weight as a time series. Job activity
  and planned training replace `activity_level`; `targets-v2` uses a small reviewed table of MET values
  from the Compendium until the full import arrives in E5. `ContextSnapshot` v1 built in `core`. Onboarding
  by form: the conversational onboarding is retired (ADR 004). New consent text that covers the beta's context data (job, schedule, sleep, stress).
- **E4.** Three slices: (a) one or two food sources, a Spanish food search with its own eval,
  logging from the search, daily totals, recents, favourites and "repeat yesterday"; (b) barcode and
  label photo; (c) the shortcuts, a plate photo or a sentence, each giving an editable draft, plus daily
  feedback. Plate photos are measured apart
  from the ±5% criterion: food identification and portion error against a weighed reference set (§10).
- **E5.** Training profile and typical week edited on a week grid (work, sport, gym slots). Offline-safe
  live session with steppers for sets, PR detection and rest timer; a typed or spoken sentence is a
  shortcut. Starter routine from templates in `core` (no
  AI), placed in the week. Optional daily check-in (sleep, stress) and a deterministic day readiness that
  adjusts today's session and shows the reason: the same check-in always produces the same adjustment.
  The week grid is also the week view (ADR 006): work, training planned and done, and the meals logged
  for each day, with a tap to open the day; Today gets a Day / Week switch (to confirm in the spec).
- **E5c (ADR 006).** Manual planning: the user fills the days ahead with meals (search, recents,
  favourites, copy from another day) and sessions (templates, exercise library). Planned items are kept
  apart from the logs and are logged in one tap, edited first if needed. Free; the AI of E7 fills the
  same planner.
- **E5b.** Weekly review in `core`: weight trend, adherence, sleep and stress produce a proposed target
  change that the user accepts or rejects. "What I know about you" lists the declared context, and every
  item can be edited or deleted. `canUse()` exists with a single beta plan. Questions assistant (ADR
  004): a chat about the user's targets, today's session and adjustments, by text or voice message,
  grounded in the context snapshot and a first slice of the guidelines, with a daily cap.
- **E7.** The AI proposes and `core` validates every hard context constraint (work hours, match days,
  injuries, allergies). A planned meal is logged in one tap. AI-learned memories need visible
  confirmation. Long tasks run on a job queue (§10).
- **E8.** Weekly insights include sleep, stress and adherence patterns.

**E9 option, store and landing videos:** [HyperFrames](https://github.com/heygen-com/hyperframes)
(HeyGen, Apache 2.0) renders MP4 from HTML/CSS animations, with a Claude Code plugin
(`claude plugin marketplace add heygen-com/hyperframes`, then `claude plugin install hyperframes@hyperframes`).
Candidate for App Store / Google Play preview videos, the landing hero video and social clips, rendered per
locale (es/en) from code so they can be re-rendered when the UI changes. Needs Node 22+, FFmpeg and Chrome
on the machine that renders. Not for in-app animations (use Reanimated) or exercise demos (use the
knowledge-base images).

## 8. Safety and compliance

- Calorie floor, maximum deficit, under-18 gate, eating-disorder soft-stop, injury → "see a
  professional". All are enforced in `@pt/core`, not only in prompts.
- "Not medical advice" disclaimer in onboarding, the coach and plans.
- Health data sent to Anthropic: minimize it (no names or emails in prompts), sign the DPA, and document it
  in the privacy policy.
- EU region for Supabase and Vercel functions; DPAs with every service above.
- Profile safety flags (`ed_soft_stop`, `teen_limited`, pregnancy, injuries) apply to the weekly review,
  meal plans and programs, not only to the initial targets.
- Sleep, stress and readiness are wellness signals, not diagnoses. Poor sleep or high stress never
  increases a deficit or a training volume.
- The consent text lists every data category. Adding one (sleep, stress, work schedule, AI-learned memory)
  changes the text and `CONSENT_VERSION`, and consent is asked again.
- Export and deletion cover every user table and every stored file. Their tests derive the table list from
  the schema.
- AI prompts receive only the context slice the feature needs.
- The questions assistant raises the same safety flags as the profile rules (eating-disorder soft stop,
  pregnancy, injuries) and gives no medical advice. Until it exists, a form-only onboarding has no
  eating-disorder soft stop (ADR 004).
- Voice messages are transcribed on the device: the audio is never uploaded or stored.

## 9. Working with Claude Code

Spec-driven loop (`feature-spec` → review → plan mode → `implement-spec` → verify → `/code-review`), with
project skills, agents and hooks in `.claude/`. See `CLAUDE.md`.

## 10. Open decisions

- Pricing (monthly/annual), trial length, exact free-tier caps.
- License review for BEDCA, CIQUAL and wger before importing (attribution text in the app).
- Who reviews the nutrition and training rules and the eval cases (dietitian / coach). Since ADR 003 the
  review also covers daily-life activity factors, MET values, readiness thresholds, weekly-review rules
  and sport + gym scheduling rules.
- Free vs Premium split for the weekly review, daily readiness, the questions assistant and AI memory
  (decide before E6).
- Which on-device speech-recognition module transcribes voice messages, its web support and its accuracy
  in Spanish (E5b spec). A speech-to-text provider is the fallback and would need an ADR.
- Which model answers the questions assistant (an eval decides between Haiku 5.5 and Opus 5.5).
- Accuracy thresholds for plate photos (E4 spec, from a weighed reference set).
- Where long AI jobs run. Recommended: an internal route of the API triggered by Supabase Cron / Queues.
  Decide in the E7 spec.
- App name, bundle identifiers and store accounts (Apple Developer: paid yearly; Google Play: one-time fee).
