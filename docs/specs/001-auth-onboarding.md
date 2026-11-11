# 001 — Auth & conversational onboarding

- Status: draft
- Phase: E2
- Tier: free (everything in this spec is free; it is the entry point for every user)

## Problem / user story

As a new user, I want to sign in in seconds and tell the app about myself in a short chat (or a form),
so that I get safe, personalised daily calorie and macro targets from day one, and I stay in control
of my health data (consent, export, delete).

## Decisions (taken with the human, 2026-11-11)

- Email sign-in uses a **6-digit one-time code** (Supabase email OTP): no passwords, no deep links.
- **Google** sign-in now. **Apple** sign-in is added before the first iOS release (App Store rule 4.8),
  in a later spec, once the Apple Developer account exists.
- **Minors:** under 16 → blocked. **16–17 → limited mode**: no calorie deficit, no surplus above
  maintenance + 10 %, no aggressive goals.

## Acceptance criteria

### Auth

- **AC1** — Given a signed-out user on any platform, when they enter a valid email and then the 6-digit
  code they received, then they are signed in and land on the consent screen (first time) or on Home
  (onboarding completed). _(free)_
- **AC2** — Given a wrong or expired code, when the user submits it, then they see a translated error and
  can request a new code; resending is disabled for 60 s. _(free)_
- **AC3** — Given a signed-out user, when they choose "Continue with Google" on web, iOS or Android
  (Expo Go / dev build), then they are signed in with the same outcome as AC1. _(free)_
- **AC4** — Given a signed-in user, when they reopen the app, then the session is restored without
  signing in again; when they sign out, the session is removed from the device. _(free)_
- **AC5** — Given a request to any `/me/*` or `/onboarding/*` route without a valid Supabase access
  token, then the API returns 401. _(free)_

### Consent

- **AC6** — Given a signed-in user without health-data consent, when they open the app, then they see
  the consent screen (what is stored, that answers are processed by an AI provider in the EU/US under a
  DPA, "not medical advice"), and cannot continue without ticking the explicit checkbox. _(free)_
- **AC7** — Given a user without consent, when they call `/onboarding/*`, `PUT /me/profile` or any route
  that stores health data, then the API returns 403 `consent_required`. _(free)_

### Conversational onboarding

- **AC8** — Given a consented user, when they chat (text or keyboard dictation) about themselves, then
  the AI fills a profile draft (sex, birth date, height, weight, activity level, goal, diet type,
  allergies, dislikes, injuries) and asks only for missing fields, one or two at a time. _(free)_
- **AC9** — Given the user writes in imperial units ("5 ft 10", "180 lb") or Spanish formats
  ("1,75", "80 kilos"), then the draft stores metric values converted by `@pt/core/units`, not by the AI.
  _(free)_
- **AC10** — Given the draft is complete, then the user sees a summary card with every field editable
  and their computed targets, and must confirm before anything is saved. _(free)_
- **AC11** — Given the AI is unavailable or the user prefers it, when they choose "Use a form instead",
  then a manual form with the same fields completes onboarding with the same result (manual fallback).
  _(free)_
- **AC12** — Given a user sends more than 40 onboarding chat messages in 24 h, then the API returns 429
  and the UI offers the form. _(free)_

### Targets (computed in `@pt/core`, never by the AI)

- **AC13** — Given a confirmed profile, then targets are computed as (formula version `targets-v1`):
  - BMR: Mifflin-St Jeor (male: 10·kg + 6.25·cm − 5·age + 5; female: … − 161; "other / prefer not to
    say": mean of both).
  - TDEE = BMR × activity factor (sedentary 1.2 · light 1.375 · moderate 1.55 · active 1.725 ·
    very active 1.9).
  - Goal: lose → TDEE − min(20 % TDEE, 500 kcal); maintain → TDEE; gain → TDEE + min(10 % TDEE, 300 kcal).
  - Protein: 1.8 g/kg (lose), 1.6 g/kg (maintain, gain). Fat: 25 % of kcal, at least 0.6 g/kg.
    Carbs: the remaining kcal (never negative). Fibre: 14 g per 1000 kcal.
  - kcal rounded to the nearest 10, grams to the nearest 1.
    and they match a hand calculation for at least 6 fixture profiles (es/en, male/female/other, each goal).
    _(free)_
- **AC14** — Given any profile, then kcal is never below the floor max(BMR, 1200 female / 1500 male /
  1350 other); if the goal would go below it, targets are clamped and the user sees why. _(free)_
- **AC15** — Given the summary screen, when the user taps "How is this calculated?", then they see the
  formula, their numbers and the sources (Mifflin-St Jeor 1990, ISSN protein position stand, EFSA
  dietary reference values). _(free)_
- **AC16** — Given a completed profile, when the user edits height, weight, activity or goal in Settings,
  then targets are recomputed and stored as a new row (old targets kept with `valid_to`). _(free)_

### Safety (enforced in `@pt/core`, also mentioned in the prompt)

- **AC17** — Given an age under 16, then the profile is rejected (422 `age_blocked`), nothing is stored
  beyond the auth user, and the user sees a kind message and can delete the account. _(free)_
- **AC18** — Given an age of 16–17, then the goal "lose" is converted to "maintain", "gain" is capped at
  +10 %, and the summary explains why (limited mode). _(free)_
- **AC19** — Given BMI < 18.5 with goal "lose", or a target weight implying BMI < 18.5, or the user
  reports pregnancy/breastfeeding, then no deficit is applied (maintain) and the app recommends
  professional advice. _(free)_
- **AC20** — Given the user mentions an eating disorder, purging, extreme restriction or self-harm in the
  chat, then the AI stops collecting goals, the API flags `ed_soft_stop`, no deficit is ever applied,
  and the UI shows support resources (es/en) with the option to continue with maintenance targets. _(free)_
- **AC21** — Given the user reports an injury or medical condition, then it is stored as free text, the
  summary shows "see a professional before training through pain", and no medical advice is given.
  _(free)_
- **AC22** — Given implausible values (height outside 120–230 cm, weight outside 30–300 kg, birth date in
  the future), then the API returns 400 with a field error and the AI asks again. _(free)_

### Privacy (GDPR)

- **AC23** — Given a signed-in user, when they tap "Download my data" in Settings → Privacy, then they
  get a JSON file with every row linked to their account (profile, preferences, targets, consents,
  AI usage). _(free)_
- **AC24** — Given a signed-in user, when they confirm "Delete my account" (type DELETE / ELIMINAR),
  then the auth user and every user row are deleted (cascade), `ai_usage` rows lose their `user_id`,
  the session ends, and a test asserts no row references that user afterwards. _(free)_
- **AC25** — Onboarding prompts never contain the user's email or name; the AI receives only the chat
  text and the current draft. Transcripts are **not stored** server-side. _(free)_

## Data changes

| Table             | Column                                                                                                                                     | Type                                                   | Notes                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------- |
| profiles          | id                                                                                                                                         | uuid PK                                                | = `auth.users.id`, FK `on delete cascade`                   |
|                   | sex                                                                                                                                        | enum `sex` (female, male, other)                       | "other" covers "prefer not to say"                          |
|                   | birth_date                                                                                                                                 | date                                                   |                                                             |
|                   | height_cm                                                                                                                                  | numeric(5,1)                                           | check 120–230                                               |
|                   | weight_kg                                                                                                                                  | numeric(5,2)                                           | check 30–300                                                |
|                   | target_weight_kg                                                                                                                           | numeric(5,2) null                                      | optional                                                    |
|                   | activity_level                                                                                                                             | enum (sedentary, light, moderate, active, very_active) |                                                             |
|                   | goal                                                                                                                                       | enum (lose, maintain, gain)                            | the goal **applied** after safety rules                     |
|                   | requested_goal                                                                                                                             | enum (lose, maintain, gain)                            | what the user asked for                                     |
|                   | safety_flags                                                                                                                               | text[] default '{}'                                    | e.g. `teen_limited`, `low_bmi`, `pregnancy`, `ed_soft_stop` |
|                   | injuries                                                                                                                                   | text null                                              | free text                                                   |
|                   | units                                                                                                                                      | enum (metric, imperial)                                | display only                                                |
|                   | locale                                                                                                                                     | text                                                   | `es` / `en`                                                 |
|                   | onboarding_completed_at                                                                                                                    | timestamptz null                                       |                                                             |
|                   | created_at / updated_at                                                                                                                    | timestamptz                                            |                                                             |
| dietary_prefs     | user_id                                                                                                                                    | uuid PK FK profiles `on delete cascade`                |                                                             |
|                   | diet_type                                                                                                                                  | enum (omnivore, vegetarian, vegan, pescatarian, other) |                                                             |
|                   | allergies                                                                                                                                  | text[]                                                 | normalised list (EU 14 allergens) + free text               |
|                   | dislikes / restrictions                                                                                                                    | text[]                                                 |                                                             |
| nutrition_targets | id                                                                                                                                         | uuid PK                                                |                                                             |
|                   | user_id                                                                                                                                    | uuid FK profiles `on delete cascade`                   | index (user_id, valid_from desc)                            |
|                   | kcal, protein_g, carbs_g, fat_g, fiber_g                                                                                                   | integer                                                |                                                             |
|                   | formula_version                                                                                                                            | text                                                   | `targets-v1`                                                |
|                   | clamped_reason                                                                                                                             | text null                                              | e.g. `calorie_floor`                                        |
|                   | valid_from / valid_to                                                                                                                      | timestamptz / timestamptz null                         |                                                             |
| consents          | id                                                                                                                                         | uuid PK                                                | append-only                                                 |
|                   | user_id                                                                                                                                    | uuid FK `auth.users` `on delete cascade`               |                                                             |
|                   | kind                                                                                                                                       | enum (health_data)                                     | more kinds later (marketing…)                               |
|                   | version                                                                                                                                    | text                                                   | text version shown, e.g. `2026-11`                          |
|                   | granted_at / revoked_at                                                                                                                    | timestamptz / timestamptz null                         |                                                             |
| ai_usage          | id, user_id (FK `on delete set null`), feature, model, input_tokens, output_tokens, cost_usd numeric(10,6), latency_ms, status, created_at |                                                        | from BLUEPRINT §5; used by AC12 rate limit                  |

RLS: enabled on every table; `authenticated` may `select` only rows where `user_id` (or `id`) = `auth.uid()`;
no insert/update/delete policies (all writes go through the API with the server role); `anon` gets nothing.

## API contracts

- Schemas to add to `@pt/contracts` (`src/profile.ts`, `src/onboarding.ts`, `src/privacy.ts`):
  `SexSchema`, `ActivityLevelSchema`, `GoalSchema`, `DietTypeSchema`, `MeasurementSchema`
  (`{ value, unit: 'cm' | 'in' | 'ft_in' | 'kg' | 'lb' }`), `ProfileInputSchema`, `ProfileSchema`,
  `DietaryPrefsSchema`, `TargetsSchema`, `SafetyFlagSchema`, `MeResponseSchema`,
  `ConsentRequestSchema`, `OnboardingDraftSchema` (all fields optional), `OnboardingChatRequestSchema`
  (`{ messages: max 40, draft }`), `OnboardingChatResponseSchema` (`{ reply, draft, missing[], safety }`),
  `TargetsPreviewResponseSchema`, `ExportResponseSchema`, `ApiErrorSchema` (`{ code, message, fields? }`).
- `GET /me` → 200 `MeResponse` (profile, prefs, current targets, consent status, onboarding status) / 401
- `POST /me/consent` → 204 / 400 / 401
- `POST /onboarding/chat` → 200 / 400 / 401 / 403 `consent_required` / 429 `rate_limited` / 503 `ai_unavailable`
- `POST /onboarding/targets-preview` → 200 `TargetsPreviewResponse` (targets + applied safety rules, nothing
  stored) / 400 / 401 / 403 / 422 `age_blocked`
- `PUT /me/profile` → 200 `MeResponse` (stores profile + prefs + new targets) / 400 / 401 / 403 / 422 `age_blocked`
- `GET /me/export` → 200 `ExportResponse` (`Content-Disposition: attachment`) / 401
- `DELETE /me` → 204 / 401

Auth middleware: verify the Supabase access token (JWT) against the project's JWKS
(`/auth/v1/.well-known/jwks.json`); `userId = sub`. Deleting the auth user uses the service key, only in
`apps/api`.

AI (`packages/ai`): feature `onboarding`, **Claude Haiku 5.5**, one tool `update_profile_draft`
(input = `OnboardingDraftSchema` with `MeasurementSchema` for height/weight) plus a `flag_safety` tool
(`ed_soft_stop`, `pregnancy`, `medical_condition`). Every call is metered in `ai_usage`. Evals: at least
20 conversations (es/en, imperial units, teens, ED mention, injuries); ≥ 95 % correct drafts and 100 % of
safety flags raised.

`@pt/core`: `computeAge(birthDate, today)`, `computeTargets(profile, today)` (`targets-v1`),
`evaluateProfileSafety(profile, today, flags)` → `{ status: 'ok' | 'teen_limited' | 'blocked', appliedGoal,
flags, reasons }`, `toMetric(measurement)`. Test-first, with the 6 hand-calculated fixtures from AC13.

## UI

Routes (`apps/app/src/app/`), mobile-first (360–430 px), light/dark:

- `(auth)/sign-in` — email field + "Continue with Google"; states: idle, sending, error.
- `(auth)/verify` — 6-digit code input (paste and autofill `one-time-code`), resend timer; states:
  verifying, wrong code, expired.
- `onboarding/consent` — plain-language text, checkbox, links to privacy policy (placeholder until E9).
- `onboarding/chat` — chat with text input (keyboard dictation works), typing indicator, live draft
  chips, "Use a form instead"; states: loading, AI error (retry + form), rate limited (form).
- `onboarding/form` — manual fallback; metric/imperial toggle.
- `onboarding/summary` — editable fields, targets card, "How is this calculated?", limited-mode / safety
  notices, disclaimer, "Confirm".
- `settings/profile` (edit → recompute) and `settings/privacy` (download data, delete account with
  typed confirmation).
- Root layout guard: signed out → `(auth)`; no consent → consent; onboarding incomplete → onboarding; else Home.

i18n namespaces (es reference + en): `auth.*`, `consent.*`, `onboarding.*`, `targets.*`, `safety.*`,
`privacy.*`, `errors.*`.

## Safety & edge cases

- All safety rules from AC14, AC17–AC22 live in `@pt/core` and run on both `targets-preview` and
  `PUT /me/profile`, whatever the AI said.
- Age is computed from `birth_date` with an injected `today` (user's local date sent by the client,
  validated to ±1 day of server UTC).
- 16–17-year-olds: in Spain the age of digital consent is 14 (LOPDGDD art. 7), so they can give their own
  consent; still no deficit (AC18). Revisit for other EU countries (13–16) before launch outside Spain.
- Rounding: kcal to 10, grams to 1; carbs never negative (if fat + protein exceed kcal, protein is kept and
  fat goes down to its 0.6 g/kg minimum, then the floor applies).
- Imperial input is converted once on input; values are stored metric.
- Disclaimer "This is not medical advice" on consent, summary and settings.
- The onboarding prompt treats user text as data (prompt-injection safe): the model can only call the two
  tools; the API validates their input with Zod.

## Out of scope

- Sign in with Apple (separate spec before the iOS release), passwords, magic links, phone/SMS login.
- Custom SMTP for auth emails (Supabase's built-in sender is rate-limited; needed before the beta).
- Weight history, progress charts, recomputing targets automatically over time.
- Meal plans, workout programs, food logging (E4+), entitlements/paywall (E6).
- Storing onboarding transcripts; editing the profile through chat after onboarding.
- Final legal texts (privacy policy, terms): placeholders until E9.

## Open questions

- Who reviews the targets formula and the safety thresholds (dietitian)? Until then, `domain-reviewer`
  reviews `targets-v1`.
- Support resources for AC20 (Spain: ACAB / FEACAB helpline; English: Beat / NEDA): confirm numbers
  before launch.

## Prerequisites (human, before implementation)

- Supabase dev: enable **Email OTP** (Auth → Providers → Email; edit the "Magic link" email template to
  show `{{ .Token }}`), and set the OTP length to 6.
- Google Cloud: OAuth client IDs (web; Android; iOS later) and enable the Google provider in Supabase.
- Supabase Auth → URL configuration: add `http://localhost:8081` and `personaltrainer://` redirect URLs.

## Progress

- [ ] contracts · [ ] db · [ ] core · [ ] api · [ ] client · [ ] ui · [ ] e2e
- Decisions taken during implementation:
