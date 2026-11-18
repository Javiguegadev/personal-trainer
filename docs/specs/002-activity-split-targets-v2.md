# 002 — Job activity, weekly training and targets-v2

- Status: approved (2026-11-12)
- Phase: E2b (first of two specs; 003 covers the tab shell, the "Today" hub, the weight log and the
  offline-safe writes)
- Tier: free (everything here is part of onboarding and the profile)

## Problem / user story

As a user who works at a desk, lifts three days a week and plays football, I want to tell the app what my
job is like and what I train each week with a few taps, so that my calories count my training once and
change when my routine changes.

Today one `activity_level` answer mixes the job with the exercise (ADR 003), and the onboarding still
ships a chat that ADR 004 retires.

## Assumptions (confirmed by the human on 2026-11-12)

- **Training is asked as a short list**, not as one number: each activity has a type, times per week,
  duration and intensity. It is the only way to describe "gym + football + a match". Weekdays and times
  are not asked here; the week grid of stage E5 adds them.
- **The job has three options**: seated, on your feet, physical.
- **Two new safety rules** come from the domain review of this draft (2026-11-12): a ceiling on the
  activity factor (AC10) and a smaller deficit with a lot of training (AC11). Their thresholds are
  estimates until a professional reviews them.
- **The onboarding chat is deleted**, not parked: screen, API route, prompt, evals, mock chat and
  contracts. Git keeps the history for the questions assistant of stage E5b.
- **Existing accounts fill in the form again** (prefilled). There are no production users.
- **No eating-disorder question is added to the form.** Until the questions assistant exists nothing
  raises that soft stop (ADR 004); the calorie floor, the low-BMI rule, the rules for minors and AC11
  still apply to everyone.

## Acceptance criteria

### Profile form (onboarding and Settings → Profile)

- **AC1** — Given the profile form, then "activity level" is gone and the user must choose one job
  option with a tap: seated most of the day, on your feet or walking most of the day, or physical work.
  _(free)_
- **AC2** — Given the profile form, when the user adds an activity done outside work, then they set its
  type (strength, cardio, sport, other), times per week (stepper), duration (chips) and intensity (light,
  moderate, hard; moderate by default) without typing; a name is optional for sport and other. They can
  add up to 6 activities and remove any of them. _(free)_
- **AC3** — Given a user who does not train, when they leave the list empty, then the form is valid and
  the targets use the job only. _(free)_
- **AC4** — Given times per week outside 1–14, a duration outside 10–240 minutes, or more than 1200
  minutes of training per week in total, then the form shows a field error and the API returns 400.
  _(free)_
- **AC5** — Given a completed profile, when the user changes the job or the training in Settings →
  Profile and saves, then the targets are recomputed and stored as a new row, and the old row is closed
  with `valid_to` (same rule as spec 001 AC16). _(free)_

### Targets (`targets-v2`, computed in `@pt/core`)

- **AC6** — Given a confirmed profile, then targets are computed as:
  - BMR: Mifflin-St Jeor, as in `targets-v1`.
  - Activity factor = job factor + training factor.
    - Job factor: seated 1.4 · on your feet 1.6 · physical 1.8.
    - Training factor: for each activity, hours per week × (MET − 1), added up and divided by 168 (the
      hours in a week). MET − 1 is used because the resting part of that hour is already in the job
      factor.
    - MET table, provisional (light / moderate / hard): strength 3.0 / 3.5 / 5.0 · cardio 4.0 / 6.0 / 8.5
      · sport 4.0 / 6.0 / 8.0 · other 2.5 / 4.0 / 6.0. The values sit below the continuous-effort codes
      of the Compendium of Physical Activities because people report the whole session, rests included.
  - TDEE = BMR × activity factor. The factor is not rounded; calories are rounded to the nearest 10 at
    the end, as in `targets-v1`.
  - Goal adjustment, protein, fat, carbs, fibre and the calorie floor are unchanged from `targets-v1`,
    except for AC11.
  - `formula_version` is `targets-v2`, and the result matches a hand calculation for at least 8 fixture
    profiles: no training, a physical job, gym + football + a match, the ceiling of AC10, the smaller
    deficit of AC11, and a profile that hits the calorie floor (woman, 60 years, 155 cm, 55 kg, seated,
    "lose" → 1200 kcal). _(free)_
- **AC7** — Given the summary or Settings → Profile, when the user changes the job from seated to
  physical, or adds or removes an activity, then the previewed calories change accordingly before
  anything is saved. _(free)_
- **AC8** — Given "How is this calculated?", then the user sees the BMR, the job factor, the training
  factor, the goal adjustment and the sources. _(free)_

### Safety (enforced in `@pt/core`)

- **AC9** — Given any profile, then these hold under `targets-v2`: calories are never below the floor
  max(BMR, 1200 female / 1500 male / 1350 other), and the user sees why when they are clamped; no deficit
  at 16–17, with a low BMI, with a low target BMI or with `ed_soft_stop`; a surplus of at most 10 % at
  16–17; no numeric targets in pregnancy or breastfeeding; under 16 is blocked; and a more active job or
  one more activity never lowers the calories. _(free)_
- **AC10** — Given a job and a training list whose activity factor is above 2.4, then the factor used
  is 2.4, `clamped_reason` is `activity_ceiling` and the summary explains that the estimate was limited.
  _(free)_
- **AC11** — Given 600 or more minutes of planned training per week, then the summary shows a
  high-training-load notice (eat enough, see a professional if in doubt), and with the goal "lose" the
  deficit is at most min(10 % of TDEE, 300 kcal). The profile stores the flag `high_training_load`.
  _(free)_

### User context

- **AC12** — Given a profile, a job and a training list, then `buildContextSnapshot(sources, today)` in
  `@pt/core` returns a `context-v1` snapshot (age, sex, height, weight, goal, safety flags, job factor,
  and planned training as sessions, minutes per week and training factor), `computeTargets` takes that
  snapshot as its input, and the function is pure. _(free)_

### Consent

- **AC13** — Given the consent screen, then the text lists the data of the beta (profile, job, weekly
  training, weight log, and sleep and stress check-ins when the user fills them in), no longer mentions
  the onboarding chat, and `CONSENT_VERSION` changes. _(free)_
- **AC14** — Given a user whose active consent has an older version, then `GET /me` reports
  `healthData: false`, health-data routes return 403 `consent_required`, the app shows the consent screen
  and no stored data is lost. Given `POST /me/consent` with a version that is not the current one, then
  the API returns 400. _(free)_

### Retiring the onboarding chat

- **AC15** — Given the app and the API, then the `onboarding/chat` screen and `POST /onboarding/chat` no
  longer exist, nothing in onboarding calls the AI, and `@pt/ai` keeps only its client, configuration and
  usage metering. _(free)_

### Data and privacy

- **AC16** — Given "Download my data", then the file includes the job and the training list. Given
  "Delete my account", then both are deleted, and the deletion test derives the list of user tables from
  the schema, so a new table that is not covered fails the test. _(free)_
- **AC17** — Given an account created before this spec, when it opens the app after the migration, then
  it goes through the profile form again with its stored values prefilled, and it gets `targets-v2` when
  it confirms. _(free)_

## Data changes

| Table              | Column                  | Type                                      | Notes                                    |
| ------------------ | ----------------------- | ----------------------------------------- | ---------------------------------------- |
| lifestyle_profiles | user_id                 | uuid PK, FK profiles `on delete cascade`  | one row per user, no history (see below) |
|                    | job_activity            | enum (sedentary, standing, physical)      |                                          |
|                    | created_at / updated_at | timestamptz                               |                                          |
| planned_activities | id                      | uuid PK                                   |                                          |
|                    | user_id                 | uuid FK profiles `on delete cascade`      | index (user_id)                          |
|                    | kind                    | enum (strength, cardio, sport, other)     |                                          |
|                    | label                   | text null                                 | e.g. "fútbol"; at most 40 characters     |
|                    | sessions_per_week       | smallint                                  | check 1–14                               |
|                    | minutes_per_session     | smallint                                  | check 10–240                             |
|                    | intensity               | enum (light, moderate, hard)              |                                          |
|                    | position                | smallint                                  | order in the form                        |
|                    | created_at              | timestamptz                               |                                          |
| profiles           | activity_level          | dropped (and the `activity_level` enum)   |                                          |
|                    | onboarding_completed_at | set to null for existing rows (migration) | AC17                                     |

- RLS: enabled on both new tables; `authenticated` may `select` only rows where `user_id = auth.uid()`;
  no insert/update/delete policies (writes go through the API).
- `profiles.safety_flags` gains the value `high_training_load`, and `nutrition_targets.clamped_reason`
  the value `activity_ceiling` (both are text, so no type change).
- Blueprint §5 differences: `lifestyle_profiles` has no `valid_from` / `valid_to`, because the targets
  history already records when the numbers changed. `planned_activities` stores the weekly plan without
  weekdays; stage E5 adds the weekdays and times (`routine_blocks`) on top of it.
- New migration `0001`; migration `0000` is not edited.

## API contracts

- Schemas to add to `@pt/contracts`: `JobActivitySchema`, `ActivityKindSchema`, `IntensitySchema`,
  `PlannedActivitySchema` (`{ kind, label, sessionsPerWeek, minutesPerSession, intensity }`),
  `ContextSnapshotSchema` (`version: 'context-v1'`).
- Schemas to change: `ProfileInputSchema` and `ProfileSchema` (`activityLevel` → `jobActivity` +
  `plannedActivities`, at most 6), `TargetsBreakdownSchema` (`activityFactor` stays as the total and gains
  `jobFactor` and `trainingFactor`), `SafetyFlagSchema` (`high_training_load`), `ExportResponseSchema`
  (job and training), `CONSENT_VERSION`.
- Schemas to remove: `ActivityLevelSchema`, `OnboardingDraftSchema`, `OnboardingChatRequestSchema`,
  `OnboardingChatResponseSchema`, the onboarding tool inputs and `ONBOARDING_LIMITS`.
- `PUT /me/profile` → 200 `MeResponse` / 400 / 401 / 403 / 422 `age_blocked` (stores the profile, the job,
  the training list and new targets in one transaction).
- `POST /onboarding/targets-preview` → 200 / 400 / 401 / 403 / 422 (same path; the body is the new
  `ProfileInput`).
- `GET /me` → 200; `consent.healthData` is true only for the current consent version.
- `POST /me/consent` → 204 / 400 (version is not the current one) / 401.
- `POST /onboarding/chat` → removed.
- `@pt/core`: `jobFactor(jobActivity)`, `trainingFactor(activities)`, `buildContextSnapshot`,
  `computeTargets(snapshot, safety)` (`targets-v2`). The job factors, the MET table, the 2.4 ceiling and
  the 600-minute threshold are constants with their source next to them. Test-first.

## UI

- `onboarding/form` and `settings/profile` (shared `ProfileForm`): a "Your job" choice group and a
  "Training and sport outside work" section with activity cards. Empty state: "I don't train" is the
  default, with an "Add activity" button. Each card: type chips, a stepper for times per week, duration
  chips (30, 45, 60, 90, 120 min), intensity chips, an optional name, "Remove".
- `onboarding/summary`: the targets card updates as the job or the training changes (AC7); "How is this
  calculated?" shows the new breakdown (AC8); notices for the ceiling (AC10) and the high training load
  (AC11).
- `onboarding/consent`: new text (AC13). The consent screen also appears for an account whose consent is
  older (AC14).
- `onboarding/chat` is deleted with its components (`ChatBubble`, `DraftChips`) and i18n keys.
- States: loading, error with retry and saved, as today. Mobile-first (360–430 px), light and dark.
- i18n (es reference + en): `onboarding.form.job*`, `onboarding.form.training*`, `targets.breakdown.*`,
  `safety.high_training_load`, `safety.activity_ceiling`, `consent.points.*`; remove `onboarding.chat.*`.
- E2E (`apps/e2e`): the form journey sets a job and two activities and checks the calories; a second
  journey changes the job in Settings and sees Home change.

## Safety & edge cases

- The safety rules run in `@pt/core` on both the preview and the save, whatever the client sent.
- Training never lowers the targets, so a user who overstates their training loses part of the deficit
  but never goes below the floor. The weekly cap of AC4 catches typing mistakes; the ceiling of AC10
  bounds the estimate (2.4 is the top of the FAO/WHO/UNU range for a vigorous lifestyle).
- The training factor multiplies the BMR, not the body weight: 1 MET is taken as the user's own BMR per
  hour, which avoids overstating the cost for heavy users.
- Compared with `targets-v1` for a man of 30, 175 cm and 80 kg (BMR 1749):

  | Case                                                          | v2 factor | v2 kcal | v1 kcal            |
  | ------------------------------------------------------------- | --------- | ------- | ------------------ |
  | Seated, no training                                           | 1.40      | 2450    | 2100 (sedentary)   |
  | Seated + 4 strength sessions of 60 min, moderate              | 1.46      | 2550    | 2710 (moderate)    |
  | Seated + 3 × 60 gym + 2 × 90 football + a 90 min match (hard) | 1.60      | 2790    | 3020 (active)      |
  | Physical job, no training                                     | 1.80      | 3150    | 3320 (very active) |

  `targets-v2` is flatter than `targets-v1`: higher for people who do not train (1.2 describes a
  chair-bound person; 1.4 is the low end of the FAO/WHO/UNU range for a sedentary lifestyle) and lower
  for people who train a lot. With the goal "lose", the seated man goes from 1750 kcal (v1, clamped to
  the floor) to 1960 kcal (v2, not clamped).

- The job factors, the MET table and the thresholds of AC10 and AC11 are provisional. They were cited
  from memory in the domain review: they are checked against the sources during implementation, and by
  the professional reviewer before the beta.
- Units stay metric internally. The date rule (`today` within ±1 day of server UTC) is unchanged.

## Out of scope

- Tab shell, "Today" hub, weight as a time series and offline-safe writes (spec 003).
- Weekdays and times of each activity, the work schedule, sleep and stress (stage E5).
- Different targets for match, training and rest days; automatic recalculation over time (weekly review,
  stage E5b).
- Steps and wearables; a higher protein target for heavy training.
- The questions assistant and voice messages (stage E5b).
- "How is this calculated?" on Home (it needs the breakdown stored with the targets).
- The Supabase auth adapter (spec 001, waiting for its prerequisites).

## Open questions

- Who reviews the job factors, the MET table and the thresholds (blueprint §10)? Until then,
  `domain-reviewer`.
- Heavy manual labour as a fourth job option (factor 2.0): the human decided on 2026-11-12 to keep three
  options. The domain review notes that 1.8 is low for it, which makes a "lose" deficit larger than
  intended, so the question goes to the professional reviewer.
- Final legal wording of the consent text (stage E9).

## Progress

- [x] contracts · [x] db · [x] core · [x] api · [x] client · [x] ui · [x] e2e
- AC1–AC17 are covered by tests: `contracts/profile.test.ts` (AC1–AC4), `core/nutrition/*.test.ts`
  (AC6, AC9–AC11), `core/context/snapshot.test.ts` (AC12), `core/profile/*.test.ts` (AC1–AC4, notices),
  `api/routes/me/me.test.ts` and `routes/onboarding/onboarding.test.ts` (AC4, AC5, AC10, AC11, AC14–AC17),
  `api-client/mock/backend.test.ts`, `api/store/account-deletion.integration.test.ts` (AC16, on the dev
  database) and `apps/e2e` (AC2, AC3, AC5–AC8).
- Commits: `58746ad` retires the chat (AC15) · `33de79f` job, training and `targets-v2` ·
  `9b43957` consent (AC13, AC14).
- Verified on 2026-11-12: `pnpm check` green, 4 E2E journeys green on the mock backend, the form and the
  summary checked on web at 390 px in light and dark mode, migrations `0001` and `0002` applied to the dev
  database, and the account-deletion integration test green on it.
- Decisions taken during implementation:
  - **Commits follow dependencies, not layers.** Changing `ProfileInput` breaks every layer at once, so
    one commit per layer could not stay green. The work is three green commits instead.
  - **Two migrations instead of one.** `drizzle-kit generate` asks interactively whether a dropped enum
    was renamed, which fails without a terminal. `0001` adds the tables and enums; `0002` drops
    `activity_level` and clears `onboarding_completed_at` (AC17).
  - **`profile.jobActivity` is nullable in `ProfileSchema`** (never in `ProfileInputSchema`): an account
    from before this spec has no job until it fills in the form again. `onboarding_completed_at` is set
    again on that save.
  - **The job and the training list travel inside `profile`** in `GET /me` and in the export, so
    `ExportResponseSchema` itself did not change.
  - **The high-training-load flag is raised by the safety rules** (`evaluateProfileSafety`), so the notice
    comes with the preview; the smaller deficit is applied by `computeTargets` from the snapshot.
  - **When the calorie floor and the activity ceiling both apply**, `clamped_reason` is `calorie_floor`.
  - **The breakdown shows the factors rounded to 3 decimals**; the calculation uses them unrounded.
  - **`ConsentRequestSchema.version` is a literal of the current version**, which gives the 400 of AC14.
    The consent text now says that no AI provider processes the data and that consent is asked again if
    that changes (the new `consent.points.use` replaces `consent.points.ai`).
  - **The mock database key changed** (`pt.mock-db.v2`): demo data stored by an older build is ignored.
  - **`@pt/ai` has no feature left**: `FEATURES` is empty and `AiFeature` is a string until the questions
    assistant (stage E5b) adds the first one.
  - **The onboarding form of an existing account is prefilled** from its stored profile (AC17).
- Domain review of the code (`domain-reviewer`, 2026-11-12): no defect in the calculation or the safety
  rules; the 10 fixtures were recalculated by hand. Fixed from it: the intensity hint followed a shifted
  talk test (it now reads talk / talk but not sing / a few words, with its own hint for strength), the
  high-training-load notice no longer mentions a deficit (it also shows when no deficit applies), the
  sources say the MET values are adapted and cite the IOM, the notice takes its hours from the constant,
  and a factor of exactly 2.4 is no longer reported as limited.
- Notes for the professional reviewer, not changed: the step at 600 minutes (599 minutes keep the full
  deficit) and the fact that it counts minutes, not intensity; whether any deficit should apply when the
  ceiling limited the estimate; 1 MET taken as BMR / 24, about 9 % below 1 kcal/kg/h; Mifflin-St Jeor at
  16–17; and the "below the recommended range" wording of the low-BMI notice of spec 001 (it shows below
  BMI 20).
- Phone check in Expo Go passed (the human, 2026-11-17): the steppers and chips. Left for the human:
  apply the migrations to any other environment.
