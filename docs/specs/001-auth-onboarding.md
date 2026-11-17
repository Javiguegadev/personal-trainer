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
- **After the domain review (2026-11-11):** protein on a BMI-25 reference weight when BMI ≥ 30 (capped at
  35 % of kcal); pregnancy/breastfeeding → no numeric targets, refer to a professional; ESPEN/GLIM low-BMI
  thresholds by age; fibre max(25 g, 14 g/1000 kcal). `ed_soft_stop` is sticky once stored.
- **2026-11-12 (ADR 004, touch first):** the form is the onboarding entry. The conversational onboarding
  (AC8, AC12, the chat side of AC9 and AC20) stays in the code and in the API, but nothing in the UI
  links to it, and stage E2b retires it. Until the questions assistant exists (stage E5b) nothing raises
  the eating-disorder soft stop; the other safety rules do not depend on the chat.

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

> Since ADR 004 (2026-11-12) the form of AC11 is the onboarding entry and the chat is not linked from
> the UI. AC10 and AC11 apply to the form; AC8, AC9 and AC12 describe the chat that stage E2b retires.

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
  - Protein: 1.8 g/kg (lose), 1.6 g/kg (maintain, gain), on a **reference weight** (actual weight, or the
    weight at BMI 25 for the user's height when BMI ≥ 30), and never above 35 % of kcal. Fat: 25 % of
    kcal, at least 0.6 g/kg of the reference weight. Carbs: the remaining kcal (never negative).
    Fibre: max(25 g, 14 g per 1000 kcal) (EFSA adequate intake, IOM ratio).
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
- **AC19** — Given a low BMI (ESPEN/GLIM: < 20 under 70 years, < 22 from 70) with goal "lose", or a
  target weight implying such a BMI, then no deficit is applied (maintain) and the app recommends
  professional advice. Given the user reports pregnancy/breastfeeding, then **no numeric targets** are
  computed or shown and the app refers them to their midwife or doctor. _(free)_
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
- `onboarding/form` — the onboarding entry since ADR 004 (first screen after consent, no back link);
  metric/imperial toggle. `onboarding/chat` above is still served but nothing links to it.
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

- [x] contracts · [x] db (migration 0000 applied to pt-dev) · [x] core · [x] ai · [x] api · [x] client · [x] ui (on the mock backend) · [x] e2e (on the mock backend) · [x] Supabase auth adapter (real sign-in still to be checked by the human)
- API (2026-11-11): all 7 routes; 47 route tests (AC5, AC7, AC12, AC14, AC16–AC25 at the API level);
  AC24 integration test passed against pt-dev (`pnpm --filter @pt/api test:integration`). The pt-dev
  JWKS publishes an ES256 key, which the verifier expects.
- Client (2026-11-11): `@pt/api-client` has the 7 route methods; `ApiError` carries `status`, `code` and
  `fields` (fallback code by status when the body is not an API error); `onUnauthorized` fires on 401.
  TanStack Query v5: query-option factories + `createApiHooks(api)` (the app binds them in `src/lib/api.ts`);
  4xx errors are never retried; `/me` is invalidated after consent, overwritten after `PUT /me/profile`,
  and the whole cache is cleared after `DELETE /me`. 18 tests.
- UI (2026-11-12, commits 28820fb…c365210), verified on web with the Playwright MCP at 390 px (light and
  dark) and 1280 px, no console errors:
  - Demo mode: `pnpm --filter @pt/app web:mock` (or `dev:mock` for Expo Go) → `@pt/api-client/mock`
    (in-memory API with the same rules: 401/403/400/422/429, @pt/core targets, scripted chat with
    `#503`/`#429` hooks, ED and pregnancy keywords) + mock auth (code 123456, 000000 = expired, Google
    demo account). Only when `__DEV__`; a banner marks every screen.
  - Auth port `AuthAdapter` (`apps/app/src/lib/auth`); outside demo mode sign-in says `not_configured`.
  - Root guard: `Stack.Protected` + `redirectTo` to a real screen; no redirects while the session or
    `/me` loads (deep links survive reloads), a blocking cover hides the wait.
  - Screens: sign-in, verify (one-field OTP, 60 s resend), consent, chat, form, summary, Home,
    settings/profile, settings/privacy. ACs exercised by hand: AC1–AC4 (mock), AC6, AC8–AC12, AC14–AC24.
  - New @pt/core: `evaluateProfileInput` (moved from the API), profile form parsing and unit switching,
    `profileNotices`, `trimTranscript`, number formatting. Tests: core 90+, api-client 36, app 8.
- Human test feedback (2026-11-12, demo mode: "el formulario va bien, pero el chat no recogía bien los
  datos, tampoco puedo volver del formulario al chat"):
  - The manual form works well.
  - Chat: fixed (5ca5554). Reproduced on web: "hombre, 30" and "1,75 y 80", the formats the chat intro
    suggests, were not understood by the scripted mock (`packages/api-client/src/mock/chat.ts`), which
    then replaced the answers with example values. The mock now reads a number without a unit in the
    context of the question it asked, asks only for the missing half of a question, never invents a
    value (it asks again with an example; the `#demo` hook fills example values on purpose) and ignores
    denied injuries, allergies and pregnancy. The real path (Haiku) was not involved; it can be tried in
    the app once the Supabase auth adapter exists.
  - Back from the form to the chat: **not reproduced**. On web "← Volver" returns to the chat with the
    conversation intact in five paths (Google and email sign-in, after a reload on the form, through the
    summary, with and without messages). Moot since ADR 004: the form is the first screen and has no
    chat to go back to.
- E2E (2026-11-12, f702304): `pnpm e2e` runs the Playwright journeys (package `apps/e2e`, mobile
  viewport, es-ES) on `web:mock`; it starts the dev server or reuses a running one. First time on a
  machine: `pnpm --filter @pt/e2e exec playwright install chromium`. Not part of `pnpm check` or CI.
- ADR 004 (2026-11-12, decided by the human): touch first, so the form is the onboarding entry
  (consent → form → summary → Home). The form lost its back link and the summary goes back to the form.
  The chat screen is still served at `/onboarding/chat`, unlinked, until stage E2b retires it; it keeps
  its unit tests (mock) and API tests. E2E now covers the reachable journeys in 3 tests: form in metric
  units with summary ↔ form and a reload, form in imperial units, delete account (AC1, AC3 on the mock,
  AC4, AC6, AC9–AC11, AC24).
- Prerequisites done by the human on 2026-11-17: Email OTP with 6 digits and a Spanish "Magic link or
  OTP" template that shows only `{{ .Token }}` (no link); custom SMTP (the built-in sender would not let
  the template be edited); Site URL `http://localhost:8081`; redirect URLs `http://localhost:8081/**`,
  `personaltrainer://**`, `exp://**`; Google provider with a Web OAuth client (Google Cloud project
  `persnal-trainer-dev`, app in "Testing" with the human as test user). No Android or iOS client: the
  browser flow does not need one.
- Supabase auth adapter (2026-11-17, f0fea16): `apps/app/src/lib/auth/supabase.ts` (the adapter over a
  slice of `supabase.auth`, 19 tests in `supabase.test.ts` for AC1–AC4 with a fake client) and
  `supabaseClient.ts` / `supabaseClient.web.ts` (the real client and the platform's Google flow). The app
  uses it when `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set; otherwise sign-in
  still says `not_configured`. Demo mode is unchanged. Checked on web with Playwright (390 px, no
  console errors): no demo banner, an invalid email shows its error, "Continuar con Google" reaches
  Google's sign-in with the dev client and the Supabase callback. Decisions:
  - **Google uses the browser, PKCE.** iOS and Android: `WebBrowser.openAuthSessionAsync` to Supabase's
    authorize URL, back to `Linking.createURL('/')` (`exp://…/--/` in Expo Go, `personaltrainer://` in a
    build), then `exchangeCodeForSession`. Web: a full-page redirect back to the origin, and the client
    finishes the session on load (`detectSessionInUrl`). Native Google sign-in (a dev build and Android
    and iOS client IDs) is not needed for now.
  - **A wrong and an expired code both show `invalid_code`:** Supabase answers `otp_expired` for both.
    The copy ("not correct, check it or ask for a new one") fits both; `expired_code` stays for the mock.
  - **Sign-out is local** (`scope: 'local'`): other devices keep their sessions. Offline, the state is
    reset anyway.
  - Session in expo-sqlite's localStorage on native (the Expo guide) and the token refresh loop tied to
    `AppState`.
- Left for the human (real sign-in): the email code on web and in Expo Go (arrives, works, a wrong code
  shows the error, resend after 60 s); Google on web (open `http://localhost:8081`, the allowed origin)
  and in Expo Go; reopening the app keeps the session; sign out returns to sign-in. Also try starting the
  app offline more than an hour after the last use (expired access token): the session should not be
  lost.
- Apple sign-in: a separate spec before the iOS release, once the Apple Developer account exists.
  The activity split (ADR 003) was built in stage E2b.
- Human checks on a phone (Expo Go, `pnpm --filter @pt/app dev:mock`): keyboard over the chat composer
  and forms (KeyboardAvoidingView), OTP autofill, share sheet for "Download my data", dark mode.
- Eval (2026-11-11, Haiku 5.5, effort low): 22/22 cases and 5/5 safety flags in 3 consecutive runs,
  about $0.0035 per run. Fixed on the way: append-only tool loop (thinking blocks are bound to the prefix),
  coeliac/intolerances recorded as allergies, ordered values from prompt injection ignored.
- Decisions taken during implementation:
  - The AI tool accepts `ageYears`; core turns it into the latest matching birth date (editable in the summary).
  - Allergies and restrictions only grow from the chat (union); items are removed in the summary/form.
  - `computeTargets` refuses profiles whose safety evaluation has `targetsAllowed: false`.
  - AI tool inputs are validated with Zod on our side (no `strict` schemas: the contracts use unions).
  - `targets-preview` returns `targets: null` and `breakdown: null` when `targetsAllowed` is false
    (pregnancy); `PUT /me/profile` then closes the current targets row and inserts none.
  - `ed_soft_stop` raised in the chat travels in the draft (`healthFlags`) until the profile is saved;
    from then on it is sticky (stored flags are passed as `previousFlags`). Nothing is stored before.
  - The AC12 cap counts every onboarding `ai_usage` row, failures included (one row per chat request).
  - `calorie_floor` is added to `profiles.safety_flags` when targets were clamped (AC14).
  - The API does not mount user routes when the Supabase env is missing (dev runs with `/health` only).
  - Under 16 (AC17) is shown inside the summary, not as a dead end: no targets, Confirm disabled, the
    birth date stays editable (typos) and "Delete my account" is offered.
  - The targets preview never refetches on its own (no retry on mount or focus): a refetch would clear
    a 422 while it runs.
  - Delete confirmation accepts DELETE or ELIMINAR in any case. Spanish numbers group from five digits
    (1690 kcal, 12.140), per RAE/CLDR.
  - AC20 support resources: generic text + 112 until the helplines are confirmed (open question).
