# 004 — Training focus: muscle, strength, sport performance

- Status: approved (2026-11-13)
- Phase: E2b (third spec; after 002 and 003, before E4 food logging)
- Tier: free

## Problem / user story

As someone who trains, I want to say what I train for (more muscle, more strength, or performing better
in my sport) separately from what I want with my weight, so that my macros fit my training now, and the
food and training suggestions of later stages fit it too.

## Decisions taken with the human (2026-11-13)

- **Two questions instead of one list.** "Your weight" (lose fat · keep my weight · gain weight) sets the
  calories, as today. "What do you train for?" (gain muscle · gain strength · perform in my sport · health
  and general fitness) is new and sets the macros. They combine freely, e.g. lose fat and perform in
  football. This is the two-axis model of BLUEPRINT §5 (`profiles.goal` + `training_profiles.focus`).
- **The macros change now** (`targets-v3`); the food and the training style follow the focus in later
  stages (E4/E7 and E5).
- **"Perform in my sport" needs a sport**: the form asks for at least one activity of kind "sport", with
  its name, before it continues.

## Acceptance criteria

### Form

- **AC1** — Given the profile form (onboarding and Settings), then the goal question is titled "Your
  weight" with the options lose fat · keep my weight · gain weight (same stored values `lose`, `maintain`,
  `gain`; only the copy changes), with a hint: "To build muscle, choose gain weight or keep my weight, and
  gain muscle below". _(free)_
- **AC2** — Given the profile form, then it asks "What do you train for?" with four options, each with
  one line of description: gain muscle (`hypertrophy`), gain strength (`strength`), perform in my sport
  (`sport_performance`), health and general fitness (`general_fitness`, preselected). One choice, taps
  only. _(free)_
- **AC3** — Given "perform in my sport" and no activity of kind "sport" in the weekly training, then the
  form shows an error on the training list and an "Add a sport" button that adds a sport activity card;
  given a sport activity without a name, then its name field shows "Name your sport". The form does not
  continue until both are fixed, and the API returns 400 with the same fields. Other focuses keep the
  name optional. _(free)_
- **AC4** — Given the summary, Settings and "How is this calculated?", then the focus appears with the
  protein per kg it uses and, for sport performance, the carbohydrate minimum per kg. _(free)_

### Targets (`targets-v3`, computed in `@pt/core`)

- **AC5** — Given a confirmed profile, then calories are computed as in `targets-v2`, with one change:
  given focus `sport_performance` and applied goal `lose`, then the deficit is at most 10 % of TDEE and
  300 kcal (as with a high training load), and a notice says that fat loss is slower to protect
  performance. Example: man, 30, 175 cm, 80 kg, seated job, football 3 × 90 min moderate. TDEE =
  1748.75 × (1.4 + 4.5 × 5 / 168) = 2682.5 kcal. Health focus: − min(20 %, 500) = 2182.5 → 2180 kcal.
  Sport performance: − 268.2 → 2414.2 → 2410 kcal. _(free)_
- **AC6** — Given a focus, then protein in g per kg of reference weight (the BMI-25 weight from BMI 30, as
  in v2) is:

  | Focus                       | lose | maintain | gain |
  | --------------------------- | ---- | -------- | ---- |
  | health and general fitness  | 1.8  | 1.6      | 1.6  |
  | sport performance           | 1.8  | 1.6      | 1.6  |
  | gain muscle · gain strength | 2.0  | 1.8      | 1.8  |

  Protein still never exceeds 35 % of the calories. Example: man, 30, 175 cm, 80 kg, seated, no training,
  maintain: health 128 g, strength 144 g. _(free)_

- **AC7** — Given focus `sport_performance`, then carbohydrates are at least a minimum per kg of
  reference weight, from the planned training minutes per week (IOC/ACSM bands, lower bound): under 420
  min (under 1 h a day) 3 g/kg · 420–839 min 5 g/kg · 840 min or more 6 g/kg. When the remainder after
  protein and fat is below it, fat goes down (never below its 0.6 g/kg minimum) to make room. Calories
  never change for it. Example: woman, 30, 165 cm, 60 kg, seated, football 6 × 120 min moderate (720
  min, high load), lose: TDEE 2319.9, deficit 232 → 2090 kcal; protein 108 g; health focus: fat 58 g,
  carbs 284 g; sport performance: minimum 5 × 60 = 300 g, so fat 50 g and carbs 302 g. _(free)_
- **AC8** — Given focus `sport_performance` and calories that cannot hold the carbohydrate minimum even
  with fat at its minimum, then carbs are what fits and a notice says that these calories do not cover
  the carbohydrates the training needs, suggesting "keep my weight" while training this much. _(free)_
- **AC9** — Given any focus, then every rule of `targets-v2` and spec 003 holds: the calorie floor, no
  deficit at 16–17 / low BMI / low target BMI / `ed_soft_stop`, the low-BMI recovery margin, no numbers in
  pregnancy, the activity ceiling, the high-training-load deficit. The focus never raises calories and
  never lowers the floor. _(free)_
- **AC10** — Given a targets change (profile save or weight entry), then the new row has
  `formula_version = 'targets-v3'`. Rows stored before keep their version. _(free)_

### Context, data and display

- **AC11** — Given `buildContextSnapshot`, then it returns `context-v3`: `training.focus` is added to
  `context-v2`. _(free)_
- **AC12** — Given "Today", then the planned training card also says what the user trains for ("For:
  gain strength", or "For: perform in football and padel" with the names of the sport activities).
  _(free)_
- **AC13** — Given an account created before this spec, then the migration gives it a focus: `hypertrophy`
  when its requested goal is `gain`, otherwise `general_fitness`. Its targets move to `targets-v3` on the
  next profile save or weight entry. _(free)_
- **AC14** — Given "Download my data", then the profile includes the focus; given "Delete my account",
  then the focus row is deleted (the schema-driven test covers the new table). _(free)_

## Data changes

| Table             | Column                  | Type                                     | Notes                                                        |
| ----------------- | ----------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| training_profiles | user_id                 | uuid PK, FK profiles `on delete cascade` | one row per user                                             |
|                   | focus                   | enum `training_focus`                    | hypertrophy · strength · sport_performance · general_fitness |
|                   | created_at / updated_at | timestamptz                              |                                                              |

- RLS: enabled; `authenticated` may `select` only its own row; no write policies (writes go through the
  API).
- Migration `0004`: the enum, the table and the backfill of AC13.
- BLUEPRINT §5 already lists `training_profiles(user_id, focus, …)`; stage E5 adds experience, days and
  equipment to it.

## API contracts

- `@pt/contracts`: `TrainingFocusSchema`; `ProfileInputSchema.trainingFocus` (required) with the AC3
  check (at least one `sport` activity with a label when the focus is `sport_performance`: issues
  `plannedActivities` → `too_small`, `plannedActivities.N.label` → `too_small`);
  `ProfileSchema.trainingFocus` (nullable for safety, never null after the backfill);
  `TargetsBreakdownSchema` adds `trainingFocus` and `carbsMinGPerKg` (null outside sport performance);
  `ContextSnapshotSchema` → `context-v3`.
- No new route: `PUT /me/profile`, `POST /onboarding/targets-preview`, `GET /me` and `GET /me/export`
  carry the focus inside the profile. Weight writes re-evaluate with it (spec 003).
- `@pt/core`: `targets-v3` (`TARGETS_FORMULA_VERSION`), protein by focus, `sportCarbsMinimum` (also used
  by the app to show the AC8 notice on "Today", where there is no breakdown), the focus fields of the
  form helpers, notices `performance_deficit` and `carbs_below_sport_minimum`. Test-first with the worked
  examples above.
- Mock backend: same fields and rules.

## UI

- `ProfileForm`: the renamed goal question with its hint (AC1); "What do you train for?" as a list with
  descriptions (AC2), placed after the weekly training; the sport check and the "Add a sport" button
  (AC3).
- `TargetsCard` breakdown: focus, protein per kg, carbohydrate minimum (AC4).
- `SafetyNotices`: the two new notices (AC5, AC8).
- `TrainingLine` on "Today": "For: …" (AC12).
- i18n (es + en): `onboarding.form.goal*` copy, `onboarding.form.focus*`, `safety.performance_deficit`,
  `safety.carbs_below_sport_minimum`, `targets.breakdown.focus*`, `today.trainingFor*`.
- E2E: onboarding with "gain strength" shows the higher protein; "perform in my sport" without a sport
  blocks the form, "Add a sport" plus a name unblocks it, and the summary shows the carbohydrate minimum.

## Safety & edge cases

- The focus only moves grams between macros (and makes the deficit smaller for sport performance); it
  never raises calories, so it cannot create a surplus the weight goal did not ask for.
- Under-fuelling in sport (RED-S): sport performance with fat loss gets the smaller deficit, and a
  notice when the calories cannot cover the carbohydrates the training needs.
- 16–17: no deficit as before; the higher protein of muscle and strength applies (flagged for the
  professional).
- Pregnancy: no numbers, whatever the focus. `ed_soft_stop`: no deficit; the focus is allowed.
- Obesity: protein and the carbohydrate minimum use the reference weight (BMI 25) from BMI 30, as protein
  already does.
- All new constants are provisional: `domain-reviewer` during implementation, the professional reviewer
  before the beta.

## Out of scope

- Food suggestions, meal plans and recipes by focus (E4, E7).
- Training programs and training style by focus, experience, equipment, days (E5).
- Season phases, match days, competition calendars, carbohydrate periodisation by day (E5 routine blocks).
- More than one focus at a time; a separate goal per sport.
- Supplements, hydration and electrolytes.
- The weekly review adjusting the targets (E5b).

## Open questions

- For the professional reviewer: 2.0 g/kg of protein in a deficit for muscle and strength; protein above
  1.6 g/kg at 16–17; carbohydrate bands from minutes only (no intensity), capped at 6 g/kg (endurance
  athletes may need 8–12); the 10 % / 300 kcal deficit for sport performance; whether the carbohydrate
  minimum should also apply to other focuses with a high training load.

## Progress

- [x] contracts · [x] db · [x] core · [x] api · [x] client · [x] ui · [x] e2e
- Plan (2026-11-13), one green commit per dependency step:
  1. contracts + core (test-first): `TrainingFocusSchema`, `ProfileInputSchema.trainingFocus` and the
     AC3 check (`contracts/profile.ts`, `profile.test.ts`); `context-v3` (`contracts/context.ts`,
     `core/context/snapshot.ts`); `targets-v3`: protein by focus, smaller deficit for sport performance,
     `sportCarbsMinimum` (`core/nutrition/targets.ts`, new `core/nutrition/focus.ts`, tests with the
     AC5–AC7 examples); notices `performance_deficit` and `carbs_below_sport_minimum`
     (`core/profile/notices.ts`); form helpers (`core/profile/form.ts`: focus field preselected to
     `general_fitness`, AC3 errors); `evaluateStoredProfile` passes the focus. AC5–AC11 in core tests.
  2. db: enum `training_focus` and table `training_profiles` (`db/schema/lifestyle.ts`), migration
     `0004` with the AC13 backfill, applied to the dev database.
  3. api + client + mock: the store reads and writes the focus (`drizzle-store.ts`, `fakes.ts`), export
     and the integration test table list (AC14); route tests for the 400 of AC3 and `targets-v3` rows
     (AC10); `api-client/mock/backend.ts` and its tests; `MOCK_DB_KEY` v4.
  4. app: `ProfileForm` (renamed goal and hint, focus list, "Add a sport", name error), `TargetsCard`
     breakdown (AC4), `SafetyNotices` (AC5, AC8; on "Today" through `sportCarbsMinimum`),
     `TrainingLine` (AC12), i18n es/en.
  5. e2e: strength protein in `onboarding.spec.ts`; a new sport-performance journey (blocked, "Add a
     sport", name, carbohydrate minimum); E2E helpers learn the focus. Web check at 390 px, light and dark.
  6. close: domain review, Progress, CLAUDE.md status (food logging becomes spec 005), memory.
- State (2026-11-15, steps 1–5 committed, `pnpm check` green, `pnpm e2e` 8/8 green):
  - Done: contracts, core (AC3 helpers, AC5–AC11), db (`0004_training_profiles` applied to dev), api
    (store reads/writes `training_profiles`, export, AC3 400 and AC10 route tests, deletion table list),
    api-client mock (`MOCK_DB_KEY` v4, AC3/AC6/AC14 tests), i18n es/en, app UI (AC1–AC5, AC8, AC12) and
    E2E (`training-focus.spec.ts`: strength protein, sport performance blocked → "Add a sport" → name →
    carbohydrate minimum). Web checked at 390 px light and dark and at 1280 px, no console errors.
  - AC13 backfill: `0005_training_focus_backfill.sql` (pasted by the human; the guard hook blocks
    editing migration files). Dev recorded 0005 as applied while it was still empty, so its INSERT was
    run once by hand on dev (0 profiles there, nothing to fill). Other databases apply it normally.
  - Next: step 6 (domain review, CLAUDE.md status, memory). The human checks the form on a phone (Expo
    Go): the focus list, "Add a sport" and the sport name field with the keyboard open.
- Decisions taken during implementation:
  - **One commit for steps 1–3**: the required `ProfileInput.trainingFocus` breaks api, api-client and
    app types at once (as in spec 002), so `pnpm check` can only be green once the API, the mock and the
    app compile with it.
  - **Backfill in `0005`, not `0004`** (see State).
  - **Notices** come from `profileNotices(safety, targets, training?)`: `performance_deficit` when the
    focus is sport performance and the applied goal is `lose`; `carbs_below_sport_minimum` when
    `targets.carbsG` is below `sportCarbsMinimum` (computed from the profile, so "Today" needs no
    breakdown). Both only with numeric targets. With a high training load, `high_training_load` and
    `performance_deficit` both show.
  - **Fat makes room with a floor rounding** (`⌊…⌋`), so carbs never fall below the minimum by rounding.
  - **Form errors**: codes `sport_required` (list) and `sport_name_required` (field
    `plannedActivities.N.label`, the API path); `formErrorFromApi` maps the API's `too_small` to them.
  - `Profile.trainingFocus` null (never after the backfill) is treated as `general_fitness` by core and
    the form.
  - **Form order**: weekly training → "Your weight" (its hint points "below") → "What do you train for?".
    "Add a sport" is a primary button under the list error, shown only while `sport_required` is shown.
    Under sport performance a sport's name field reads "Sport name" instead of "Name (optional)".
  - **"For: …" on Today**: sport names from `sportActivityNames` (unique, as typed) joined with
    `formatList` (core; hand-written, since Hermes may lack `Intl.ListFormat`; Spanish "e" before /i/).
  - **Sport notices outside the form**: "Today" passes the stored profile; the weight-change notice on
    Progress passes the profile with the goal the new evaluation applied.
  - **E2E**: the journeys live in a new `training-focus.spec.ts` (not `onboarding.spec.ts`);
    `weight.spec.ts` now reads `pt.mock-db.v4` (it still read v3 after step 3 bumped `MOCK_DB_KEY`).
