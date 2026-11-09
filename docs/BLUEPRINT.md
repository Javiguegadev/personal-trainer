# Blueprint — AI Nutrition & Fitness App (Web-first, Mobile-ready)

> Source of truth for architecture and roadmap. Decisions that change it get an ADR in `docs/adr/`.

## 0. Executive decisions

| Area           | Choice                                                    | Why                                                                                   |
| -------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Monorepo       | pnpm workspaces + Turborepo                               | Fast cached builds, clear package boundaries                                          |
| Web            | Next.js 16 (App Router) + Tailwind 4 + shadcn/ui          | SSR marketing/SEO plus the app in one project                                         |
| Mobile (later) | Expo (React Native) + Expo Router + NativeWind            | Reuses all shared packages, same styling approach                                     |
| API            | Hono + `@hono/zod-openapi` in its own app (`apps/api`)    | Web and mobile call the same typed API; logic isn't locked inside Next                |
| DB             | Supabase Postgres (EU region) + Drizzle ORM               | Managed Postgres, RLS, Auth, Storage, Cron; typed migrations                          |
| Auth           | Supabase Auth (email/OTP, Google, Apple)                  | Works on web and Expo; Apple sign-in is mandatory on iOS if you offer social logins   |
| Payments       | Stripe Billing (web) → RevenueCat (mobile)                | Stores require in-app purchases on mobile; RevenueCat unifies the "is premium" status |
| AI             | Anthropic API via `@anthropic-ai/sdk`, server-side only   | Structured outputs, prompt caching, Batch API                                         |
| Jobs           | Inngest (or Trigger.dev)                                  | Weekly adaptation, nightly batches, webhook fan-out                                   |
| Food data      | USDA FoodData Central + Open Food Facts, cached in our DB | Free; OFF is ODbL (attribution)                                                       |
| Hosting        | Vercel (web) · Fly.io / Vercel Functions (API) · Supabase | Low ops, preview deploys per PR                                                       |
| Observability  | Sentry + PostHog                                          | Errors, funnels, feature flags                                                        |
| Testing        | Vitest · Playwright · Maestro (mobile)                    |                                                                                       |

**AI billing note:** end users' Claude.ai subscriptions can't power the app. Every AI call uses our API key
from our server, so Premium pricing must cover token costs. Metering per user starts on day one.

## 1. Stack details

- TypeScript strict everywhere (pinned to 6.0.x until typescript-eslint supports 7).
- TanStack Query (server state) + Zustand (small client state), shared by web and mobile.
- Zod schemas in `packages/contracts` are the single source of truth.
- Charts: Recharts (web) / Victory Native (mobile); only data-shaping hooks are shared.
- i18n from day one: es (reference) + en.
- Rate limiting for AI endpoints: Upstash Redis. Leaderboards: Postgres until about 100k users.

**AI (Anthropic)**

- Default model `claude-opus-5-5` with adaptive thinking, tuning `output_config.effort` per route
  (e.g. `medium` for meal plans, `low` for swaps). Cheaper models such as `claude-haiku-5-5` for
  high-volume, simple routes (natural-language food parsing) are a product decision backed by evals.
- Structured outputs (`messages.parse()` with Zod) for every AI response.
- Prompt caching on the stable system prompt. Message Batches API (50% cheaper) for bulk weekly adaptation.
- Always check `stop_reason` (`refusal`, `max_tokens`). Enable server-side `fallbacks: "default"`.

## 2. Monorepo structure

```
apps/
  web/          Next.js — (marketing) public pages, (app) authenticated app
  api/          Hono — every business endpoint, AI, webhooks, jobs
  mobile/       Expo — Phase 10
packages/
  core/         pure domain logic: nutrition, training, gamification, entitlements
  contracts/    Zod schemas + inferred types (API DTOs, AI output schemas)
  db/           Drizzle schema, migrations, seed
  api-client/   typed client + TanStack Query hooks (web & mobile)
  ai/           prompts, Claude wrapper, evals, cost meter
  ui/           design tokens + cross-platform primitives
  i18n/         translations
  config/       tsconfig presets
docs/ specs/ adr/ BLUEPRINT.md
.claude/ skills/ agents/ hooks/ settings.json
```

Dependency rules (enforced by ESLint `no-restricted-imports`):

- `contracts` → zod only. `core` → contracts only, with no I/O.
- Only `apps/api` imports `db` and `ai`. Apps reach data only through `api-client`.

## 3. Architecture principles

### 3.1 Data model (first version)

```
profiles(id, sex, birth_date, height_cm, weight_kg, activity_level, goal, units, locale, consent_health_at)
dietary_prefs(user_id, diet_type, allergies[], dislikes[], restrictions[])
foods(id, source, external_id, name, brand, per_100g kcal/protein/carbs/fat/fiber, barcode)
food_servings(food_id, label, grams)
meal_entries(id, user_id, date, meal_type, food_id, grams, kcal/p/c/f snapshot)
exercises(id, name, category[strength|cardio|sport|mobility], muscle_groups[], met_value)
workouts(id, user_id, started_at, duration, type, notes, source[manual|ai_program])
workout_sets(workout_id, exercise_id, set_no, reps, weight, rpe, distance, duration)
personal_records(user_id, exercise_id, metric, value, workout_set_id, achieved_at)
points_ledger(user_id, event_type, points, ref_id, created_at)   -- append-only
achievements / user_achievements / leaderboard_snapshots(period, league, user_id, rank, points)
subscriptions(user_id, provider[stripe|revenuecat], status, plan, current_period_end)
ai_generations(id, user_id, feature, model, input_tokens, output_tokens, cost_usd, status, output_json)
meal_plans / workout_programs (+ weeks, sessions)
```

### 3.2 The AI chooses, core computes

The AI picks foods and exercises **from our catalog by ID** and chooses quantities. `@pt/core` computes
macros and volume and validates them (kcal ±5%, zero allergens, calorie floor, volume increase ≤ 10% per
week). On failure it retries once with the errors fed back, then fails gracefully.

### 3.3 AI request pipeline

auth → entitlement (`core/entitlements`) → rate limit → build context (profile, prefs, last 4 weeks)
→ Claude (structured output, cached system prompt) → Zod → core validation → persist → meter cost → respond.
Long generations run as background jobs.

### 3.4 Freemium gating

| Feature                                            | Free        | Premium                          |
| -------------------------------------------------- | ----------- | -------------------------------- |
| Meal/workout logging, basic dashboard, leaderboard | ✅          | ✅                               |
| Advanced insights (trends, adherence)              | last 7 days | ✅                               |
| AI meal plans / swaps / workout programs           | 1 preview   | ✅ (fair-use cap, e.g. 30/month) |

`canUse()` lives in `core`. The UI uses it for display and the API enforces it.

### 3.5 Gamification and anti-cheat

Append-only points ledger. Rank by consistency points, not raw strength. Daily caps. Weekly leagues by
tier. PR jumps above 20% are flagged and excluded until confirmed. Leaderboards are opt-in with a nickname.

### 3.6 Compliance (EU)

Health data is GDPR Art. 9 special-category data. Requirements: explicit consent, EU region, export and
delete endpoints, DPAs with sub-processors. Guardrails: calorie floor, under-18 gate, eating-disorder
soft-stop, "not medical advice" disclaimer.

## 4. MCP servers

Configured in `.mcp.json`: context7 (docs), playwright (browser verification), github, stripe (test mode).
Add once you have the dev project ref:

```bash
claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp?project_ref=<DEV_REF>&read_only=true"
claude mcp add --scope project --transport http sentry https://mcp.sentry.dev/mcp   # Phase 9
```

Claude Code already handles files and git natively, so Filesystem and Git MCP servers aren't needed. No
MCP server ever gets production write access.

## 5. Claude Code setup

- `CLAUDE.md` (root + `apps/api` + `apps/web`).
- Skills (`.claude/skills`): feature-spec, implement-spec, db-migration, api-endpoint, ui-screen,
  ai-feature, release-check.
- Agents (`.claude/agents`): test-writer, domain-reviewer, boundary-guard.
- Hooks (`.claude/hooks`): block `.env*` edits, block edits to applied migrations, block remote DB
  pushes, force-push and prod deploys; Prettier on every edit; typecheck on Stop.

Per-feature loop: `/clear` → feature-spec → human review → plan mode → implement-spec → Playwright
verification → `/code-review` (+ `/security-review` for auth/billing/AI) → PR.

## 6. Roadmap (phases and gates)

| Phase                        | Scope                                                                                                                               | Gate                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 0 Decisions & accounts       | GitHub, Supabase dev+prod (EU), Vercel, Stripe test, Anthropic (dev/prod keys with spend limits), Sentry, PostHog, Inngest, Upstash | Accounts exist; secrets in a password manager / env vars only       |
| 1 Foundation (wk 1)          | Monorepo, CI, preview deploys, Claude config                                                                                        | PR shows green CI + preview URL; deployed `/health` responds        |
| 2 Auth & onboarding (wk 2)   | Supabase Auth, onboarding wizard, consent, TDEE/macro targets, GDPR export/delete                                                   | Targets match a hand calculation; account delete removes all rows   |
| 3 Nutrition MVP (wk 3–4)     | Food seed + search, servings, meal logging, recents/favorites/copy day, barcode                                                     | A full day is logged in < 2 min; totals correct                     |
| 4 Fitness MVP (wk 5–6)       | Exercise library, workout logger, rest timer, e1RM/volume/MET, PR detection                                                         | PRs detected correctly; cardio kcal within ±10%                     |
| 5 Analytics (wk 7)           | Trends, adherence, macro split, volume per muscle, weight moving average                                                            | < 1 s on 6 months of seed data                                      |
| 6 Gamification (wk 8)        | Ledger, streaks, achievements, leagues, anti-cheat                                                                                  | 500 simulated users rank correctly; cheated PR excluded             |
| **MVP closed beta**          |                                                                                                                                     |                                                                     |
| 7 Payments (wk 9)            | Stripe Checkout + Portal, webhooks, entitlements, paywall, Stripe Tax                                                               | Stripe CLI lifecycle events update access correctly                 |
| 8 AI premium (wk 10–12)      | NL food logging, swaps, meal plans, workout programs, weekly adaptation (Batch), cost dashboard, evals in CI                        | ≥ 95% valid, 0 allergen violations, AI cost < 15% of price per user |
| 9 Hardening & launch (wk 13) | Sentry, rate limits, k6, RLS audit, security review, legal, a11y, SEO                                                               | release-check all green                                             |
| 10 Mobile (wk 14–18)         | Expo app, native barcode, push, HealthKit/Health Connect, RevenueCat, EAS                                                           | One account and one Premium status on web, iOS and Android          |

## 7. Human guide

**Decisions to make:** brand/domain, markets and languages, pricing and trial, free-tier limits, food data
provider (free vs. paid for better Spanish coverage), scoring rules, AI model/effort per feature (from
evals), legal entity / GDPR approach, and an expert reviewer for nutrition and training rules.

**Testing ownership:** Claude writes the core unit tests (≥ 90%, test-first), API integration tests, and
Playwright tests for the 6 critical journeys. You run the critical journeys manually before each
release, approve eval thresholds and spend, and replay Stripe webhooks.

**Working with Claude Code:** you own the spec and Claude owns the implementation. Use plan mode for
changes over 3 files, one feature per session, and small PRs. Review migrations, RLS, webhooks,
entitlements and prompts line by line. After 2 failed attempts, `/clear` and narrow the request. Update
`CLAUDE.md` weekly.

**Risks:** AI cost (metering, caps, caching, batch), unsafe advice (core validators, expert review), weak
Spanish food data (curated seed, user foods), store rejection (in-app purchases via RevenueCat),
leaderboard cheating (consistency scoring, caps, flags).
