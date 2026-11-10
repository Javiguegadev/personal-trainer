# Blueprint: AI Nutrition & Fitness App (mobile-first, AI-first)

> Source of truth for product and architecture. Changes get an ADR in `docs/adr/`.
> v2 (2026-11-10): mobile-first with a single Expo universal app, AI as the primary input method, fewer
> services, RevenueCat + Paddle, and a knowledge base built from official data. See ADR 002.

## 0. Product principles

1. **Mobile-first.** Logging happens at the table and in the gym. One Expo app ships to iOS, Android and
   the web from the same screens. The web build launches first and the stores follow when ready.
2. **AI-first.** Natural language, photos and voice dictation are the default way to log, plan and ask.
   Forms and search remain as a fallback, never as the only path.
3. **Evidence-based.** The AI answers from a curated knowledge base: official food composition
   databases, exercise databases and published guidelines, with sources cited. It never answers from its
   memory alone.
4. **The AI chooses, the code computes.** Claude picks foods and exercises _from our catalog_ and proposes
   quantities. `@pt/core` computes every number and validates safety rules.
5. **Few services.** Every vendor is an account, an invoice, a DPA and a failure point. Add one only when
   it removes more work than it creates.
6. **Privacy by design (EU).** Health data is GDPR special-category data, so it is stored in the EU,
   collected with explicit consent, and users can export or delete it.

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

## 3. AI-first feature map

| Feature                   | How the user does it                                                       | Model          | Free         | Premium   |
| ------------------------- | -------------------------------------------------------------------------- | -------------- | ------------ | --------- |
| Conversational onboarding | Chats about goals, routine, diet and injuries; AI fills the profile        | Haiku          | ✅           | ✅        |
| **Food logging**          | "2 eggs and toast with olive oil", a **photo of the plate**, or a barcode  | Haiku (vision) | ✅ daily cap | Unlimited |
| Nutrition label reading   | Photo of the label when a barcode isn't in the database                    | Haiku (vision) | ✅           | ✅        |
| **Workout logging**       | "Bench press 4×8 at 80 kg, last set RPE 9" by text or dictation            | Haiku          | ✅           | ✅        |
| Daily feedback            | Short notes on what you logged ("protein low today, try…")                 | Haiku          | ✅           | ✅        |
| Weekly insights           | Readable summary of habits and trends, with sources                        | Haiku (Batch)  | Basic        | Detailed  |
| Healthy swaps             | "Something lighter than this?" → alternatives from the catalog             | Haiku          | 3 per week   | ✅        |
| **Meal plans**            | Weekly plan tailored to goals, allergies and taste, plus shopping list     | Opus           | Preview      | ✅        |
| **Workout programs**      | Program built from goal, days, equipment and experience                    | Opus           | Preview      | ✅        |
| **Adaptive training**     | Weekly adjustment from adherence, RPE and PRs (accept/reject)              | Opus (Batch)   | –            | ✅        |
| **AI coach chat**         | Questions about your data, nutrition and training, answered with citations | Opus + tools   | –            | ✅        |
| Personal challenges       | Weekly challenges generated from your history                              | Haiku          | ✅           | ✅        |

**Voice:** Claude receives text. Dictation uses the phone's keyboard dictation (free, no extra library),
and an on-device speech module can be added later if needed.

**Model routing:** Haiku 5.5 for high-volume and latency-sensitive tasks; Opus 5.5 for planning, coaching
and adaptation. Evals decide whether a task can move between models.

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

## 5. Data model (initial)

```
profiles(id, sex, birth_date, height_cm, weight_kg, activity_level, goal, units, locale, consent_health_at)
dietary_prefs(user_id, diet_type, allergies[], dislikes[], restrictions[])
foods(id, source, source_id, name_es, name_en, brand, barcode, per_100g kcal/protein/carbs/fat/fiber, license)
food_servings(food_id, label, grams)
meal_entries(id, user_id, date, meal_type, food_id, grams, kcal/p/c/f snapshot, input_method[text|photo|barcode|manual])
exercises(id, source, name_es, name_en, category, muscle_groups[], equipment[], met_value)
workouts / workout_sets(reps, weight, rpe, distance, duration) / personal_records
knowledge_sources(id, name, url, license, version, imported_at)
knowledge_chunks(id, source_id, title, content, citation, embedding vector)
points_ledger / achievements / user_achievements / challenges
entitlements(user_id, plan, status, provider[app_store|play_store|paddle], expires_at)  ← synced from RevenueCat
ai_usage(id, user_id, feature, model, input_tokens, output_tokens, cost_usd, latency_ms, status)
meal_plans / workout_programs (+ weeks, sessions) / coach_messages
```

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

| Stage                        | Scope                                                                                                | Done when                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **E0 Accounts**              | Supabase (EU), Vercel, Expo, Anthropic (dev/prod keys with spend limits), Sentry                     | Accounts exist; secrets in a password manager                            |
| **E1 Foundation** ✅         | Monorepo, CI, Expo universal app, typed API                                                          | CI green; the app shows "API: online" on web                             |
| **E2 Auth & AI onboarding**  | Supabase Auth (email, Google, Apple), conversational onboarding, targets, GDPR consent/export/delete | Targets match a hand calculation; deleting the account removes all data  |
| **E3 Knowledge base v1**     | Importers for BEDCA, USDA, Open Food Facts, wger, the Compendium; search endpoints                   | Search finds common Spanish foods and gym exercises with correct values  |
| **E4 AI food logging**       | Text / photo / barcode logging, daily totals, daily feedback                                         | A full day is logged in under 1 minute; totals within ±5% of a reference |
| **E5 AI workout logging**    | Text/dictation set logging, exercise library, PR detection, rest timer                               | Free-text sessions parse correctly in ≥ 95% of eval cases                |
| **E6 Payments & limits**     | RevenueCat + Paddle, entitlements, paywall, AI usage caps                                            | Buy on web → Premium in the app and vice versa (sandbox)                 |
| **— MVP (beta) —**           | E2–E6 plus streaks                                                                                   |                                                                          |
| **E7 Premium AI**            | Meal plans, workout programs, adaptive training, coach chat with citations                           | Evals ≥ 95% valid, 0 allergen violations, cost target met                |
| **E8 Insights & engagement** | Weekly insights, challenges, streaks, notifications                                                  | Weekly summary generated for all test users                              |
| **E9 Launch**                | Astro landing, legal pages, Sentry, store listings, TestFlight / Play testing → public               | `release-check` green; apps approved                                     |
| **E10 Later**                | Leaderboards and leagues, HealthKit / Health Connect, wearables, social                              | —                                                                        |

## 8. Safety and compliance

- Calorie floor, maximum deficit, under-18 gate, eating-disorder soft-stop, injury → "see a
  professional". All are enforced in `@pt/core`, not only in prompts.
- "Not medical advice" disclaimer in onboarding, the coach and plans.
- Health data sent to Anthropic: minimize it (no names or emails in prompts), sign the DPA, and document it
  in the privacy policy.
- EU region for Supabase and Vercel functions; DPAs with every service above.

## 9. Working with Claude Code

Spec-driven loop (`feature-spec` → review → plan mode → `implement-spec` → verify → `/code-review`), with
project skills, agents and hooks in `.claude/`. See `CLAUDE.md`.

## 10. Open decisions

- Pricing (monthly/annual), trial length, exact free-tier caps.
- License review for BEDCA, CIQUAL and wger before importing (attribution text in the app).
- Who reviews the nutrition and training rules and the eval cases (dietitian / coach).
- App name, bundle identifiers and store accounts (Apple Developer: paid yearly; Google Play: one-time fee).
