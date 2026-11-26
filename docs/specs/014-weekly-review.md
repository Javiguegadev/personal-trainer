# 014 — Weekly review, streaks, "Lo que sé de ti" and the beta plan

- Status: approved (2026-11-25)
- Phase: E5b (ADR 003), first of three specs: 014 (this one), 015 questions assistant (text, a first
  slice of the guidelines, citations), 016 voice messages (on-device transcription, development build).
- Tier: free (beta, no paywall). Which of these features stay free after E6 is an open decision
  (BLUEPRINT §10); `canUse()` is where that split will live.

## Problem / user story

As a user who logs what I eat, train and weigh, I want a short review of each week that tells me whether
my calorie target still fits how my weight is moving and proposes a small change I can accept or
reject, a gentle count of the weeks I keep logging, and one screen with everything the app knows about
me that I can edit or delete, so that my targets correct themselves over time and I stay in control of
my data.

Stage E5b is done when "a simulated four-week history gives the expected proposals; the assistant passes
its evals" (BLUEPRINT §7). This spec covers the first half; spec 015 covers the assistant.

## Decisions taken with the human (2026-11-25)

- **E5b is split in three specs**: 014 weekly review + streaks + "Lo que sé de ti" + `canUse()`; 015
  questions assistant by text with the guidelines and citations; 016 voice messages.
- **A streak counts weeks, not days**: weeks in a row with at least 4 days with something logged (food,
  a workout or a weight). One day without logging never breaks it.

## Assumptions (to confirm in the review)

- **The review calibrates the energy estimate, it does not change the goal.** The predictive equation
  and the activity factors carry an individual error (ADR 003). When the weight moves differently from
  what the goal expects while the user eats close to the target, the review proposes to correct the
  estimated expenditure by ±100 kcal. The accepted corrections add up in
  `profiles.energy_calibration_kcal` (bounded ±300 kcal) and `targets-v4` adds them to the TDEE before
  the goal's deficit or surplus. So the deficit rules (20 % / 500 kcal, 10 % / 300 kcal) and the
  calorie floor still apply, on the corrected TDEE, and the calibration survives weight and profile
  edits (ADR 005 recomputes on top of it).
- **Two weeks of weight, one rule table.** The rate is the change between the 7-day average weight of
  the reviewed week and the one two weeks earlier, per week and as a % of body weight, which smooths
  water and salt swings. The bands are provisional (professional review): lose 0.15–1.0 %/week,
  maintain ±0.2 %/week, gain 0.1–0.5 %/week.
- **No proposal without enough logging.** A decrease or an increase for a slow change needs, in the
  reviewed week and the week before, at least 5 days with food logged and an average logged intake within
  ±10 % of the target that applied; otherwise the weight reflects the logging, not the target, and the
  review says so without a number to change. The one exception is losing faster than 1 %/week: an
  increase is proposed whatever the logging (it is the safe direction).
- **Sleep and stress never lower the calories.** With 3 or more days of the week with a check-in under
  6 h of sleep or high stress, a decrease is not proposed that week (BLUEPRINT §8), and the review says
  why. Increases are not blocked.
- **Training is reported, not judged.** The review lists the workouts and minutes done; it does not
  compare them with the typical week or the plan (no adherence number, ADR 006 left this to E5b and the
  answer is "not now"). Training volume is never changed here (E7, adaptive training).
- **When.** The review of a week (Monday–Sunday, with the day start of spec 010 AC6) is computed from
  its Monday, on the first `GET /me/review`, once the account has at least 21 days of history, and is
  stored with the numbers it used (traceable, BLUEPRINT §5). It stays on Today until the user decides
  or the next one replaces it. Nothing is applied without "Aplicar".
- **No new data category**, so no consent change: the review and the calibration are derived from data
  already covered ("Los usamos para calcular tus objetivos y adaptar tus recomendaciones").
- **"Lo que sé de ti" shows declared and derived data only.** AI-learned memory arrives in E7; until then
  the screen says the app knows only what the user entered and what it computes from the logs. It links
  to the existing edit screens instead of new forms.
- **`canUse()` with one plan.** `@pt/core` gains the `beta` plan as a table of features and daily caps,
  with today's values (label photo 20, plate photo 20, meal sentence 40, workout sentence 20, daily
  feedback AI 10). Every AI route asks `canUse()` instead of its own constant. Every user is on `beta`
  until E6 adds `entitlements`; no route or table for it yet.

## Acceptance criteria

### Weekly review

- **AC1** — Given an account with at least 21 days since onboarding and a completed week (Monday to
  Sunday, user's local dates), when Today opens on or after that Monday, then a "Tu semana" card shows
  that week's review until the user decides on its proposal or the next week's review replaces it; a
  review without a proposal can be closed ("Entendido"). Given `ed_soft_stop` or pregnancy, then no
  review is computed or shown. _(free)_
- **AC2** — Given a review, then its summary shows: the days with something logged (of 7), the days with
  food logged and their average kcal against the target that applied ("2.180 de media · objetivo 2.200"),
  the 7-day average weight and its rate ("−0,3 kg/semana" from two weeks), the workouts and minutes done,
  and the check-in days with little sleep or high stress; a missing part says it has no data ("Sin
  pesos suficientes"). Nothing in it is coloured as good or bad. _(free)_
- **AC3** — Given the rule table (`REVIEW_RULES`, provisional), then `weeklyReview(...)` in `@pt/core`
  proposes: for `lose`, −100 kcal when the loss is under 0.15 %/week and +100 kcal when it is over 1.0
  %/week; for `maintain`, ∓100 kcal when the rate is outside ±0.2 %/week; for `gain`, +100 kcal under
  0.1 %/week and −100 kcal over 0.5 %/week. The goal used is the applied one (`safety.appliedGoal`), so
  a low BMI or a minor never gets a deficit from the review. _(free)_
- **AC4** — Given fewer than 3 weights in the reviewed week or in the week two weeks before, then there is
  no proposal (`not_enough_weights`); given fewer than 5 days with food logged in the reviewed week or the
  week before, or an average logged intake off the target by more than 10 %, then there is no proposal
  (`not_enough_logging`, `off_target_intake`), except the fast-loss increase of AC3. _(free)_
- **AC5** — Given a proposal, then it never takes the target below the calorie floor (`at_floor`: no
  decrease), never takes the accumulated calibration beyond ±300 kcal (`calibration_limit`), and the
  deficit or surplus is still computed by `targets-v4` on the calibrated TDEE with the limits of specs
  001–004. Given 3 or more check-in days that week with sleep under 6 h or high stress, then a decrease
  is not proposed (`decrease_blocked_sleep_stress`) and the review says so. _(free)_
- **AC5b** — Given the domain review (2026-11-25), then: a low BMI or target BMI, a minor or an
  eating-disorder signal never get a decrease (`decrease_blocked_profile`) and `targets-v4` never applies
  a negative calibration to them; losing faster than 1 %/week proposes +100 kcal whatever the goal; when
  that increase cannot raise the target (the floor) or would pass the bound, the review refers to a
  professional (`see_professional`); a proposal must hold without the most extreme reading of either
  week (`uneven_weights`); and after a calibration change nothing but a fast-loss increase is proposed
  until both weeks compared start after it (`recent_change`, decided by the human). _(free)_
- **AC6** — Given a proposal, when the user taps "Aplicar (2.200 → 2.100 kcal)", then
  `energy_calibration_kcal` changes by the proposal, the targets are recomputed (`targets-v4`, a new row
  in the targets history) and Today shows the old and new kcal as after a weight change (ADR 005); when
  the user taps "Ahora no", then the review is stored as rejected and nothing changes. A decided review
  cannot be decided again (409 `review_decided`), and a review older than the latest one cannot be
  applied (409 `review_stale`). _(free)_
- **AC7** — Given the same inputs, then `weeklyReview` returns the same review (pure); the stored review
  keeps the numbers it used and `rulesVersion` (`review-v1`). A test runs six simulated four-week
  histories (lose on track, lose slowly while eating at target, lose fast, maintain drifting up, gain
  slowly, poor sleep with a slow loss) and checks each proposal and reason. _(free)_
- **AC8** — Given an accepted calibration, then "¿Cómo se calcula?" lists it as its own line ("Ajuste por
  tu evolución: −100 kcal"), and it stays when the weight, the typical week or the profile change; the
  review never changes the goal, the macros' rules or the training. _(free)_

### Streaks

- **AC9** — Given the logs, then `loggingStreak(...)` in `@pt/core` counts the weeks in a row, ending with
  the last complete week, with at least 4 days with a live meal item, workout or weight entry; the
  current week adds one as soon as it reaches 4 days. Progress shows "Racha: 5 semanas registrando" and
  the review repeats it. A check-in, a planned item or a deleted log never counts. _(free)_
- **AC10** — Given a week that ends with fewer than 4 days, then the streak restarts without any message
  about losing it; with no streak, Progress says only how a streak starts ("Una racha empieza con una
  semana de 4 días con registro"), never as a push.
  Given `ed_soft_stop`, then no streak is shown anywhere. _(free)_

### "Lo que sé de ti"

- **AC11** — Given Profile → "Lo que sé de ti", then the screen lists, grouped: me (sex, age, height,
  latest weight, target weight), goals (goal, training focus), my week (job, work schedule, activities
  and gym days), eating (diet, allergies, foods I avoid), health (reported conditions, injuries),
  training (experience, equipment, routine) and what the app computes (usual sleep and stress from the
  check-ins, the weight trend unless hidden, the energy calibration). _(free)_
- **AC12** — Given an item, then "Cambiar" opens the screen where it is edited today (Tus datos, Mi
  semana, Mi rutina); an optional item (target weight, allergies, foods I avoid, injuries) can be
  cleared with "Borrar" and a 5-second undo; "Borrar mis check-ins" deletes every check-in after a
  confirmation; "Volver al cálculo inicial" sets the calibration to 0 and recomputes the targets. A
  required item (sex, birth date, height, weight, goal) has no "Borrar" and says why. _(free)_
- **AC13** — Given the screen, then a line says the app knows only what the user entered and what it
  computes from the logs, and links to "Descargar mis datos". _(free)_

### Beta plan

- **AC14** — Given `canUse(plan, feature, usedToday)` in `@pt/core` and the `beta` plan, then every AI
  route (label photo, plate photo, meal sentence, workout sentence, daily feedback) asks it with the
  usage of the user's UTC day, and the answers do not change: 429 `ai_cap_reached` at the same counts,
  and the daily feedback falls back to its fixed wording. The existing cap tests pass unchanged. _(free)_

### Offline, writes, data and privacy

- **AC15** — Given no connection, then Today and Progress show the last review and streak received; "Aplicar",
  "Ahora no", "Borrar", "Borrar mis check-ins" and "Volver al cálculo inicial" are disabled with "Necesita
  conexión" (they recompute targets or delete on the server, like "Mi semana"). _(free)_
- **AC16** — Given "Descargar mis datos", then it includes the weekly reviews (with their numbers and
  decisions) and the energy calibration; given "Borrar mi cuenta", then the reviews are deleted (the
  schema-driven test covers the new table). _(free)_

## Data changes

| Table          | Column                  | Type                                                                   | Notes                                                    |
| -------------- | ----------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| weekly_reviews | id                      | uuid PK default random                                                 | server-generated                                         |
|                | user_id                 | uuid FK profiles cascade                                               | unique (user_id, week_start)                             |
|                | week_start              | date                                                                   | the Monday of the reviewed week                          |
|                | status                  | enum `review_status` (`proposed`, `no_change`, `accepted`, `rejected`) |                                                          |
|                | kcal_delta              | smallint null                                                          | the proposal (±100); null without one                    |
|                | reasons                 | text[]                                                                 | reason codes (AC3–AC5)                                   |
|                | inputs                  | jsonb                                                                  | the numbers used (summary of AC2, rates, targets, flags) |
|                | rules_version           | text                                                                   | `review-v1`                                              |
|                | created_at / decided_at | timestamptz / timestamptz null                                         |                                                          |
| profiles       | energy_calibration_kcal | smallint not null default 0                                            | check −300 to 300; read by `targets-v4`                  |

- RLS: `weekly_reviews` readable only where `user_id = auth.uid()`; no write policies (writes go through
  the API).
- One additive migration (1 table, 1 enum, 1 column). Existing users: calibration 0, no reviews.
- `targets-v4`: TDEE = BMR × activity factor + calibration; the rest of `targets-v3` unchanged. The
  stored targets keep their formula version, so history reads right. `ContextSnapshot` gains the
  calibration (`context-v6`).

## API contracts

- Schemas to add to `@pt/contracts` (new `review.ts`): `REVIEW_RULES` (provisional bands, step 100,
  bound 300, adherence 5 days / ±10 %, sleep-stress 3 days, history 21 days, a 2-week pause after a change), `ReviewReasonSchema`,
  `ReviewSummarySchema`, `WeeklyReviewSchema` (`weekStart`, `status`, `summary`, `proposal { kcalDelta,
fromKcal, toKcal } | null`, `reasons`, `rulesVersion`, `decidedAt`), `StreakSchema` (`weeks`,
  `currentWeekDays`, `hidden`), `ReviewResponseSchema` (`{ review, streak }`),
  `ReviewDecisionRequestSchema` (`{ decision: 'accept' | 'reject' }`), `ReviewDecisionResponseSchema`
  (`{ review, targets }`), `CalibrationResetResponseSchema` (`{ targets }`).
- Schemas to change: `TargetsBreakdownSchema` (+ `calibrationKcal`), `ContextSnapshotSchema` (+
  calibration, `context-v6`), `ExportResponseSchema` (+ `weeklyReviews`, `energyCalibrationKcal`).
- `GET /me/review` → 200 `ReviewResponse` (computes and stores the last complete week's review when it is
  missing; `review` null before 21 days or for `ed_soft_stop` / pregnancy) / 401 / 403
- `POST /me/review/{weekStart}/decision` → 200 / 400 / 401 / 403 / 404 / 409 `review_decided` |
  `review_stale`
- `DELETE /me/energy-calibration` → 200 `CalibrationResetResponse` / 401 / 403
- `DELETE /me/checkins` → 204 / 401 / 403 (all of the user's check-ins; the per-day delete of spec 011
  stays)
- Every route needs the current consent (403 `consent_required`).
- `@pt/core` (test-first): `review/` with `weeklyReview(...)`, `reviewWeekToShow(today, dayStart,
onboardedAt)`, `applyCalibration(current, delta)` (bounds); `streak/` with `loggingStreak(...)`;
  `entitlements/` with `PLANS`, `canUse(...)`; `nutrition/targets` → `targets-v4`.
- `@pt/api-client`: `getReview`, `decideReview`, `resetCalibration`, `deleteAllCheckins`; a `review`
  query cached offline; the decision and the resets update `me` (targets) like "Mi semana"; mock routes.

## UI

- Routes: `review` (the review of the week: summary, proposal, reasons, the last 4 decisions),
  `settings/about-me` ("Lo que sé de ti"). Today (Day view) gains the `WeeklyReviewCard`; Progress gains
  the `StreakLine` and a link to the review; Profile gains "Lo que sé de ti"; `TargetsCard` gains the
  calibration line.
- Components: `WeeklyReviewCard` (summary in two lines, proposal with "Aplicar (from → to kcal)" and
  "Ahora no", or "Entendido"), `ReviewSummary`, `StreakLine`, `AboutMeSection` (a group with its items,
  "Cambiar" / "Borrar").
- States: loading; no review yet ("Tu primera revisión llegará el lunes 7 de diciembre"); no proposal
  (the reason in plain words); decision pending sync is not possible (needs connection); offline (last
  received, actions disabled); error with retry; the targets-change notice after "Aplicar".
- Copy: neutral and short. Never "has fallado", "te has saltado", "has perdido tu racha"; the reasons say
  what the data shows ("Tu peso ha bajado menos de lo esperado con lo que has registrado").
- Mobile-first (360–430 px), light and dark, touch targets ≥ 48 px.
- i18n (es reference + en): `review.*` (card, summary, proposal, reasons, decisions, first review date,
  offline), `streak.*`, `aboutMe.*` (groups, items, actions, confirmations, the "what I know" line),
  `targets.calibration`.
- E2E (`apps/e2e`, mock backend, clock fixed, a seeded four-week history): a slow loss while eating at
  target gives "−100 kcal", "Aplicar" changes Today's target and "¿Cómo se calcula?" shows the line;
  "Ahora no" changes nothing; a poor-sleep week gives no decrease and says why; the streak on Progress
  after 4 logged days; "Lo que sé de ti": clear the injuries with undo, reset the calibration, delete the
  check-ins; `ed_soft_stop` shows neither review nor streak.

## Safety & edge cases

- **Calorie floor and deficit limits** stay in `targets-v4`, applied after the calibration; the review
  never proposes below the floor and never more than ±100 kcal a week or ±300 kcal in total
  (provisional).
- **Protected profiles**: `ed_soft_stop` and pregnancy get no review and (ed) no streak; `teen_limited`
  and `low_bmi` use the applied goal, so no deficit is ever proposed; `medical_condition` and `injury`
  keep their notices of spec 001 and the review adds nothing medical.
- **Losing fast** (over 1 %/week) proposes an increase even with little logging, and the "losing fast"
  notice of spec 003 keeps showing.
- **Sleep and stress** only block a decrease (BLUEPRINT §8); they never increase a deficit or a volume.
- **Noise**: two-week weight rates, 3 weights per week minimum, one step per week; a single high or low
  weight cannot trigger a proposal.
- **Dates**: weeks by local date with the day start of spec 010 AC6; the server computes "last complete
  week" from the user's today sent by the app (as the logs do) and refuses a `weekStart` that is not a
  Monday or is in the future (400).
- **Concurrency**: deciding twice, or on two devices, is 409 `review_decided`; the first decision wins.
- **Units**: the summary shows kg or lb (`core/units`), kcal as stored.
- **Streak**: weekly, never shown with `ed_soft_stop`, never rewarded with points (gamification is E8),
  and nothing in the app pushes to log more to keep it.

## Out of scope

- The questions assistant (spec 015) and voice messages (spec 016).
- Changing training volume or the routine from the review (E7, adaptive training); comparing done with
  planned training.
- Macro changes by the review (the macros follow the new kcal through `targets-v4` as they do today).
- AI-learned memory and its confirmations in "Lo que sé de ti" (E7).
- Notifications about the review (E8), points and achievements (E8), weekly insights (E8).
- `entitlements` table, RevenueCat, paywall and plan-based caps other than `beta` (E6).
- Import from Apple Health or Health Connect (E9).

## Open questions

- For the professional reviewer: the rate bands per goal, the ±100 kcal step, the ±300 kcal bound, the
  adherence gate (5 days, ±10 %), the two-week window, and the 3-day sleep/stress block. All are
  provisional constants in `REVIEW_RULES`.
- Free vs Premium for the weekly review after E6 (BLUEPRINT §10).

## Progress

- [x] contracts · [x] db · [x] core · [x] api · [x] client · [ ] ui · [ ] e2e
- Decisions taken during implementation:
  - Plan approved by the human (2026-11-25) with: `GET /me/review` takes the app's `today` and reviews
    only the last complete week (no backfill); clearing an optional item in "Lo que sé de ti" waits 5 s
    with an undo before it is sent; the calibration survives a goal change (only "Volver al cálculo
    inicial" resets it).
  - Contracts: `CappedFeatureSchema` names the capped AI features as `ai_usage.feature` does; the
    proposal stores `fromKcal` and `toKcal` as shown, besides `kcalDelta` (the calibration change). The
    review response also carries `history` (the 4 reviews before) and `firstReviewOn`.
  - DB (2026-11-25): migration `0014_weekly_review` applied to dev; the unique (user, week) index is the
    only index (it serves the newest-first reads).
  - Core: a −100 kcal calibration lowers the target a little less than 100 kcal on `lose`, because the
    deficit (a share of the TDEE) is computed again on the calibrated TDEE; the proposal shows the real
    before and after ("2.310 → 2.230 kcal"). Gates are checked in this order: logging, sleep/stress,
    bound, floor; the reasons list the rate reason and the first gate that stopped it. The exhaustive
    routine test of spec 010 got its own 20 s timeout (it ran near 5 s with the whole repo testing).
  - Domain review (2026-11-25, fixes in `af3520a`): see AC5b. The human chose the two-week pause after a
    calibration change and the first review at 21 days. Gates now run: weights, rate, one extreme
    reading (`uneven_weights`), the pause (`recent_change`), logging, protected profiles
    (`decrease_blocked_profile`), sleep/stress, bound, floor; a fast loss skips the pause and the logging
    gate. Migration `0015` adds `profiles.energy_calibrated_at` (applied to dev) for the pause.
  - API (2026-11-25): the targets history's start day is the UTC day of `valid_from` (close enough for a
    week's average). "Aplicar" checks the bound and the protected profiles again and answers 409
    `review_stale` when the proposal no longer holds. A review is computed only on `GET /me/review`, so a
    week without any app open is never reviewed. The streak reads 52 weeks of logged days. The account
    deletion integration test covers `weekly_reviews` and the new store writes and passed on dev.
  - Client (2026-11-26, `647cc1c`): one `review` query (key without the day) kept offline, so Today and
    Progress show the last response received (AC15). The decision, the reset and "Borrar mis
    check-ins" are never paused, queued or retried; "Aplicar" and the reset write the new targets into
    `/me`, keep the old and new kcal under `review-targets-change` for Today's notice
    (`useCalibrationTargetsChange`), and refetch `/me` for the profile's calibration; a 409 refetches
    the review and `/me`. Mock database key `v11`. Fix found on the way (`68f0943`): the targets preview
    of "Tus datos" ignored the calibration, so "¿Cómo se calcula?" missed its line (AC8).
