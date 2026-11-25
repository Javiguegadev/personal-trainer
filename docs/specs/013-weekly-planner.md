# 013 — Weekly planner: meals and sessions planned by hand

- Status: approved (2026-11-24)
- Phase: E5c (ADR 006), after E5 (specs 009–012) and before E5b.
- Tier: free (no AI in this spec, so there is no cap). The AI plans of E7 will fill the same tables.

## Problem / user story

As a user who organises the week ahead, I want to plan my meals and my sessions for the coming days with
the same taps I use to log them, see that plan on the week view, and log a planned meal or session in one
tap when the moment comes, so that eating and training to my targets takes less thinking each day.

Stage E5c is done when "a planned week shows on the week view; a planned item never counts as eaten or
done" (BLUEPRINT §7).

## Decisions taken with the human (2026-11-24)

- **Sessions: fill from the routine, then by hand.** "Planificar con mi rutina" places the next sessions
  of the rotation on the gym days of the typical week in one tap; each day can then be changed by hand (a
  routine session, a past session to repeat, an activity, or a free gym session). On a day with a planned
  session, Today and the Training tab show it instead of "Siguiente: …"; on a day without a plan, the
  rotation of spec 010 works as today.
- **Horizon: four weeks.** The user plans from today to the Sunday of the third week after the current
  one; the week view goes that far forward (spec 010 AC10 stopped at next week).

## Assumptions (to confirm in the review)

- **Planned items are rows of their own, shaped like the logs** (ADR 006). `planned_meal_items` has the
  columns of `meal_items` (food, portion, snapshot); `planned_workouts` holds one planned session or
  activity. No `meal_plans` / `plan_meals` container yet: as with `meals` in spec 005, a planned meal is
  the planned items of one day and meal type. E7 adds a plan container and an `origin` column when the AI
  writes plans (additive migration). BLUEPRINT §5 is updated in the same change.
- **The log links back to the plan.** A logged item stores `planned_item_id` and a workout stores
  `planned_workout_id`. A planned item is "done" while a live log row points at it, so deleting the log
  makes it pending again, and two devices never disagree about a separate "done" flag. The plan row itself
  never changes when it is logged.
- **A planned gym session is a link, not a copy of exercises.** It points at a routine session
  (`program_session_id`) or at a past workout to repeat (`repeat_workout_id`), or at neither ("Gimnasio
  libre"). Its name is a snapshot, so it still reads right if the routine session or the workout goes
  away (it then becomes a free gym session with that name). A one-off list of exercises for a future day
  is out of scope: the routine or "Repetir" cover it, and exercises can be added during the session.
- **The plan never moves the rotation.** `nextProgramSession` (spec 010 AC19) keeps following the
  workouts. If the user skips Monday's planned "Rutina A" and does Wednesday's "Rutina B", the next one is
  C; the plan is not reshuffled (a reshuffle is out of scope). "Planificar con mi rutina" on a later week
  continues after the last routine session planned before that week.
- **Planning reuses the logging screens.** Meals: the add screen of spec 005 in a "plan" mode (search,
  recents, favourites, quick add, custom foods; no barcode, label, plate photo or sentence shortcut, which
  describe food in front of the user). Activities: the activity sheet of spec 009 AC16 with a future date.
- **Copy replaces, with a confirmation and an undo.** "Copiar día" and "Copiar semana" replace the planned
  items of the chosen kinds on the target days (never the logs); target days that already have a plan are
  named in a confirmation, and "Deshacer" (5 s) restores them.
- **Bulk writes.** Copy, "Copiar semana" and "Planificar con mi rutina" can write dozens of rows, so plan
  writes go through one bulk route per queue scope (meals in the `food` scope, sessions in the `training`
  scope), and a single edit is a bulk of one. That keeps the order "plan first, then the log that points
  at it" without a new queue scope.
- **Recents and favourites ignore the plan.** Recents stay "foods logged" (spec 005 AC7); a planned food
  enters them only once it is logged.
- **Plans are a new data category** in the consent text ("las comidas y entrenamientos que planificas"),
  so `CONSENT_VERSION` changes to `2026-11-v10` and consent is asked again (the re-ask path exists).
- **No context change.** No AI reads the plan in this spec; E5b decides whether the weekly review compares
  planned and done (ADR 006 Consequences), and E7 adds what its prompts need.

## Acceptance criteria

### Horizon and week view

- **AC1** — Given today, then `planHorizon` in `@pt/core` returns the days that can be planned: today to
  the Sunday three weeks after the current week (21–27 days ahead, with the day start of spec 010 AC6).
  The week view's "›" goes up to that week; days before today and after the horizon offer no planning.
  _(free)_
- **AC2** — Given a week view row for today or a future day, then it shows, besides spec 010 AC8: the
  planned meals as outlined dots and the logged meals as filled dots (shape, not colour, tells them
  apart; each dot has an accessible label "Comida planificada" / "Comida registrada"), and the planned
  energy as plain text ("Plan: 2.150 / 2.200 kcal"; on today, logged and pending planned items together,
  each counted once); the planned sessions ("Rutina B · 18:30", "Fútbol · partido 11:00") instead of the
  typical slots on a day that has at least one planned session; a planned session that was done shows
  once, as done ("✓ Rutina B · 55 min"). Given a past day, then the row shows only what was logged, as
  in spec 010: nothing planned and not done is shown there. _(free)_
- **AC3** — Given `ed_soft_stop`, then the planner shows foods, portions and dots without any number (no
  planned kcal, no target); given pregnancy (no numeric targets), then the planned energy has no target
  ("Plan: 2.150 kcal"); given any user, then nothing judges a plan or a day (no colour, no "te has
  saltado", no adherence, no streak). _(free)_

### Planning meals

- **AC4** — Given the day screen of a day in the horizon, then a "Plan del día" section lists the six
  meals with their planned items (name, portion, kcal unless hidden), the planned energy of the day and
  "Añadir al plan" per meal; on today the section sits under the logged meals and lists only the pending
  planned items. _(free)_
- **AC5** — Given "Añadir al plan", then the add screen of spec 005 opens in plan mode for that day and
  meal: the header says "Planificar · Cena del jueves 27", the shortcuts that read food in front of the
  user (barcode, label, plate photo, sentence) are hidden, the portion sheet's button says "Añadir al
  plan", and the screen stays open to add several foods (spec 005 AC8). The planned item stores the
  snapshot computed by `@pt/core`; the API computes it again from the catalog for catalog foods. _(free)_
- **AC6** — Given a planned item of a future day, when the user taps it, then a sheet lets them change the
  portion, the meal and the day (date chips inside the horizon), or remove it ("Quitar del plan", with a
  5-second undo). A planned item of a future day cannot be logged. _(free)_
- **AC7** — Given any planned item, then it never counts as eaten: `dailyTotals`, the summary card, the
  logged kcal of the week view, the daily feedback (spec 008), the recents and the export of the food log
  read only `meal_items`. A test feeds a day with planned and logged items to each of them. _(free)_

### Logging the planned meals

- **AC8** — Given the Food tab (today and the 6 days before) or a day screen (today and the 27 days
  before), when a meal has pending planned items, then they show under that meal's logged items, muted
  and marked "Plan" in text, with "Registrar lo planificado (2 alimentos · 520 kcal)"; one tap logs every
  pending item of that meal as a new log item (new id, same food, portion and meal, that day's date,
  `planned_item_id`, input method `plan`, snapshot computed again), with a 5-second undo. "Repetir lo de
  ayer" (spec 005 AC13) is not offered for a meal that has a plan that day. _(free)_
- **AC9** — Given a pending planned item there, when the user taps it, then the portion sheet opens with
  the planned portion and two actions: "Registrar" (the portion can be changed first; the log stores the
  portion chosen) and "Quitar del plan". Given a logged planned item, then the plan shows it as
  "✓ Registrado" and it no longer appears as pending; given that log item is deleted, then the planned
  item is pending again. _(free)_

### Planning sessions

- **AC10** — Given the day screen of a day in the horizon, when the user taps "Planificar entreno", then a
  sheet offers: a session of the routine (its sessions in order, when a routine exists), "Repetir" (the
  last 3 distinct past sessions, as on the Training tab), an activity (the activity sheet of spec 009
  AC16 with that date: type chips with the profile's activities first, minutes, "partido" for a sport)
  or "Gimnasio libre" (a name, optional); each with an optional start time (15-min steps) and, for gym,
  optional minutes (default: the strength activity's minutes). A day holds at most 4 planned sessions.
  _(free)_
- **AC11** — Given the week view of the current week or a later week in the horizon, a routine with at
  least one session and a strength activity with days, when the user taps "Planificar con mi rutina",
  then a sheet previews the result ("Lun 1 · Rutina A · 18:30 / Mié 3 · Rutina B / Vie 5 · Rutina C") and
  "Planificar" stores it: every gym day of the typical week from today (current week) or from Monday
  (later weeks) to Sunday, without a planned gym session, gets the next routine session in rotation order,
  with the activity's start time and minutes. The rotation starts at `nextProgramSession` for the current
  week and continues after the last routine session planned before a later week. A planned session of a
  routine that was deleted (spec 010 AC20) counts as not planned and is replaced. A 5-second undo removes
  what it placed. Given no routine, then the button opens "Crea tu rutina"; given a strength activity
  without days, then it says "Indica tus días de gimnasio en Mi semana" and links there. _(free)_
- **AC12** — Given a planned session of a future day, when the user taps it, then a sheet lets them change
  what it is (AC10's choices), the time, the minutes and the day (inside the horizon), or remove it with a
  5-second undo. _(free)_
- **AC13** — Given a day with planned sessions, then `planNotices` in `@pt/core` returns, on the day
  screen and in the planning sheet (never blocking): a session whose time overlaps the work block of that
  day (typical week, or the shift of that day's check-in, spec 011) and a strength session or a hard
  activity planned the day before a match (a typical-week match or a planned match). Same copy and
  provisional thresholds as spec 010 AC5. _(free)_

### Doing the planned sessions

- **AC14** — Given a planned session for today that is not done, then the Training tab's routine card and
  Today's "Entreno de hoy" show it instead of "Siguiente: …": "Hoy: Rutina B · 18:30 · Empezar" for gym,
  "Hoy: Fútbol · 19:00 · 90 min · Hecho" for an activity, one line each; "Elegir otra sesión" stays.
  Given no planned session today, then spec 010 AC17 applies unchanged. The Training tab gains "Planificar
  mi semana", which opens Today on the week view. _(free)_
- **AC15** — Given "Empezar" on a planned gym session, then: a routine session starts as in spec 010
  AC18, with the readiness adjustment of spec 011 AC7 (the planned routine session is today's session in
  the readiness line); "Repetir" starts as in spec 009 AC18; "Gimnasio libre" starts an empty live session
  with its name. The workout stores `planned_workout_id` (and `program_session_id` for a routine session);
  the rotation follows the workouts (spec 010 AC19). _(free)_
- **AC16** — Given "Hecho" on a planned activity, then the activity sheet of spec 009 AC16 opens with its
  type, day, minutes and the planned time (or now when it had none) and saves with one tap, storing
  `planned_workout_id`. _(free)_
- **AC17** — Given a planned session with a live workout pointing at it, then the week view, the day
  screen and Today show it once, as done; given that workout is deleted, then it is pending again. Given
  a past day inside the 27-day window with a pending planned session, then the day screen lists it under
  "Planificado", neutral, with "Registrar" (the past-session screen of spec 009 AC17 for gym, prefilled
  like "Empezar"; the activity sheet for an activity). _(free)_
- **AC18** — Given any planned session, then it never counts as done: the Training tab history, personal
  records, the readiness load, the rotation, the targets and the export of the workouts read only
  `workouts`. Planned sessions do not change the targets (they come from the typical week). _(free)_

### Copy

- **AC19** — Given a day screen of any day the week view shows, when the user taps "Copiar día", then they
  choose what ("Comidas": all, or some meal types; "Entrenos") and one or more target days (chips of the
  days from today to the horizon, a row per week). The copy is what that day shows: its logged items plus
  its pending planned items, and its workouts plus its pending planned sessions, with new ids; foods get
  a snapshot computed again (quick-add items, and items whose food left the catalog, are copied as they
  are); a workout from a routine session that still exists becomes that routine session, another gym
  workout becomes "Repetir" that workout, an activity stays an activity with its minutes and time. _(free)_
- **AC20** — Given a target day that already has planned items of the chosen kinds, then a confirmation
  names those days ("Se sustituirá lo planificado del martes 25 y el jueves 27") and the copy replaces
  them (for meals, only the chosen meal types); logged items are never touched. After the copy,
  "Deshacer" (5 s) removes the copies and restores what was replaced. _(free)_
- **AC21** — Given the week view, when the user taps "Copiar semana", then they choose a target week
  (chips: the weeks after the shown one inside the horizon) and what (meals, sessions); each weekday is
  copied to the same weekday with AC19 and AC20, and days of the target week before today are skipped.
  _(free)_

### Offline, writes, data and privacy

- **AC22** — Given no connection, then planning, editing, copying, "Planificar con mi rutina" and
  logging a planned item work and show at once marked "pendiente de sincronizar"; the plan from 27 days
  back to the horizon is in the offline cache; plan-mode search needs the connection, recents and
  favourites do not (spec 005 AC6). Planned meal writes use the `food` queue scope and planned session
  writes the `training` scope, so a planned item is sent before the log that points at it. _(free)_
- **AC23** — Given a bulk plan write sent twice, then the database has one row per id; given two writes
  to the same planned row, then the later `recordedAt` wins whatever the order of arrival; given a
  delete, then a later write with an earlier `recordedAt` does not bring it back (tombstone). Given a log
  write whose `plannedItemId` / `plannedWorkoutId` no longer exists, then it is stored without the link
  (the queue never gets stuck, as spec 010 did for routine sessions); given one that belongs to another
  user, then 404. Given a date outside yesterday … today + 28 days (server UTC, for time zones), then a
  planned upsert is 400 (deletes are always accepted). _(free)_
- **AC24** — Given the consent text, then it lists "las comidas y entrenamientos que planificas",
  `CONSENT_VERSION` changes to `2026-11-v10`, and existing users are asked again before any health-data
  route works. _(free)_
- **AC25** — Given "Descargar mis datos", then it includes the planned meal items and the planned
  sessions (deleted ones with `deletedAt`) and the links of the logs; given "Borrar mi cuenta", then they
  are deleted (the schema-driven test covers the new tables). _(free)_

## Data changes

| Table              | Column                             | Type                                                    | Notes                                                                              |
| ------------------ | ---------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| planned_meal_items | id                                 | uuid PK (client-generated)                              |                                                                                    |
|                    | user_id                            | uuid FK profiles cascade                                | index (user_id, local_date)                                                        |
|                    | local_date / meal_type             | date / enum `meal_type`                                 |                                                                                    |
|                    | food_id / serving_id               | uuid FK foods set null / uuid FK food_servings set null | null for a quick add                                                               |
|                    | servings / serving_label / label   | numeric(4,2) null / text null / text                    | as `meal_items`                                                                    |
|                    | grams / quantity_unit              | numeric(6,1) null / enum `quantity_unit`                | check 1–2000                                                                       |
|                    | kcal / protein_g / carbs_g / fat_g | numeric(7,2)                                            | snapshot, check ≥ 0                                                                |
|                    | fiber_g                            | numeric(7,2) null                                       |                                                                                    |
|                    | recorded_at / deleted_at           | timestamptz / timestamptz null                          | last write wins; tombstone                                                         |
|                    | created_at / updated_at            | timestamptz                                             |                                                                                    |
| planned_workouts   | id                                 | uuid PK (client-generated)                              |                                                                                    |
|                    | user_id                            | uuid FK profiles cascade                                | index (user_id, local_date)                                                        |
|                    | local_date / start_minute          | date / smallint null                                    | check 0–1439                                                                       |
|                    | kind / activity                    | enum `workout_kind` / enum `activity_type` null         | activity set iff kind ≠ `gym`                                                      |
|                    | name                               | text null                                               | ≤ 60; snapshot of the routine session or workout name                              |
|                    | minutes                            | smallint null                                           | check 5–600; required when kind ≠ `gym` (contract)                                 |
|                    | is_match                           | boolean default false                                   | only for kind `sport` (contract)                                                   |
|                    | program_session_id                 | uuid FK program_sessions set null null                  | a routine session                                                                  |
|                    | repeat_workout_id                  | uuid FK workouts set null null                          | a past workout to repeat; check: not both links                                    |
|                    | recorded_at / deleted_at           | timestamptz / timestamptz null                          | last write wins; tombstone                                                         |
|                    | created_at / updated_at            | timestamptz                                             |                                                                                    |
| meal_items         | planned_item_id                    | uuid FK planned_meal_items `on delete set null` null    | index (user_id, planned_item_id)                                                   |
| workouts           | planned_workout_id                 | uuid FK planned_workouts `on delete set null` null      | index (user_id, planned_workout_id)                                                |
| enum               | `food_input_method`                | + `plan`                                                | value added (workouts keep their methods: `program`, `repeat`, `live`, `activity`) |

- RLS: both new tables readable only where `user_id = auth.uid()`; no write policies (writes go through
  the API).
- One additive migration (2 tables with checks and indexes, 2 columns, 1 enum value). Existing rows: no
  plan, no links.
- BLUEPRINT §5, Plans block: `meal_plans → plan_meals → plan_items` becomes `planned_meal_items` (a plan
  container arrives with E7), and `planned_sets` is dropped (`planned_workouts` links a routine session or
  a past workout; routines hold the exercises, spec 010).

## API contracts

- Schemas to add to `@pt/contracts` (new `plan.ts`): `PLAN_LIMITS` (`horizonWeeksAhead: 3`,
  `serverDaysAhead: 28`, `itemsPerDayMax: 150`, `sessionsPerDayMax: 4`, `changesMax: 300`,
  `listDaysMax: 63`), `PlannedMealItemSchema`, `PlannedMealItemUpsertSchema` (the shape of
  `MealItemUpsertRequestSchema` with `recordedAt`), `PlannedWorkoutSchema` and
  `PlannedWorkoutUpsertSchema` (discriminated by `kind`: `gym` with `programSessionId | repeatWorkoutId |
neither`, `minutes` optional; other kinds with `activity`, `minutes`, `isMatch` only for `sport`),
  `PlanDeleteSchema` (`{ id, recordedAt }`), `PlanMealChangesRequestSchema` and
  `PlanWorkoutChangesRequestSchema` (`{ upserts, deletes }`, at most `changesMax` in total),
  `PlanQuerySchema` (`from`, `to`), `PlanResponseSchema` (`{ mealItems, workouts }`, deleted rows not
  listed), `PlanMealChangesResponseSchema` / `PlanWorkoutChangesResponseSchema` (the stored rows, or the
  newer ones that won).
- Schemas to change: `FoodInputMethodSchema` (+ `plan`), `MealItemUpsertRequestSchema` and
  `MealItemSchema` (+ `plannedItemId`, default null), `WorkoutUpsertRequestSchema` and `WorkoutSchema`
  (+ `plannedWorkoutId`, default null), `ExportResponseSchema` (+ `plan`), `CONSENT_VERSION`.
- `GET /me/plan?from&to` → 200 `PlanResponse` / 400 (range over `listDaysMax`) / 401 / 403
- `POST /me/plan/meal-items` → 200 / 400 (date out of range, over the day limit, bad portion) / 401 /
  403 / 404 (unknown food or serving, or someone else's custom food) / 409 `id_taken` (an id of another
  user)
- `POST /me/plan/workouts` → 200 / 400 / 401 / 403 / 404 (someone else's or unknown routine session or
  workout) / 409 `id_taken`
- `PUT /me/food-log/items/{id}` and `PUT /me/workouts/{id}` → also 404 for a `plannedItemId` /
  `plannedWorkoutId` of another user (an unknown one is stored without the link, AC23).
- Every route needs the current consent (403 `consent_required`).
- `@pt/core` (test-first), new `plan/`: `planHorizon(today)`, `canPlan(date, today)`,
  `pendingPlannedItems(planned, logged)`, `plannedWorkoutStatus(planned, workouts)`,
  `logPlannedItems(items, date, now, newId)` (log requests with the link), `plannedDayEnergy(...)`,
  `copyDay(...)` / `copyWeek(...)` (changes plus their undo), `fillWeekWithRoutine(...)`,
  `todayPlannedSessions(...)`, `planNotices(...)`, `planChangesToRequests` (split per scope and per
  `changesMax`); `week/view`: `weekRows` and `dayMeals` gain the plan, `WEEK_VIEW.weeksForward` 3;
  `checkin/readiness`: the readiness plan takes today's planned routine session first.
- `@pt/api-client`: `getPlan`, `savePlanMealChanges`, `savePlanWorkoutChanges`; a `plan` query per week
  (cached offline, patched by the log mutations so "✓" shows at once); mutations queued in the `food` and
  `training` scopes; mock routes and a mock plan.

## UI

- Routes: the week view (Today → Semana) gains "Planificar con mi rutina" and "Copiar semana" in its
  header (current and later weeks); `day/[date]` gains "Plan del día", "Planificar entreno" and "Copiar
  día"; `food/add?date&meal&plan=1` (plan mode); `plan/item/[id]` (planned item sheet), `plan/workout`
  (new and edit, `?date` / `[id]`), `plan/copy` (copy day and copy week: what, target days, confirmation),
  `plan/fill` (preview of "Planificar con mi rutina").
- Components: `PlanDot` (outlined / filled, with its label), `PlannedMealSection` (pending items,
  "Registrar lo planificado"), `PlannedItemRow`, `PlannedSessionRow` ("Empezar", "Hecho", "Registrar",
  "✓"), `PlanEnergyText`, `TargetDayChips` (days grouped by week), `PlanNotices`. The Food tab's
  `MealSection` and the Training tab's `RoutineCard` gain the plan.
- States: loading; empty plan (a hint "Planifica tus comidas y entrenos desde la vista de semana"); plan
  pending sync; offline with no cached plan for that week (spec 010 AC10 message); fill without routine
  or without gym days (AC11); copy confirmation (AC20); undo snackbars; error with retry.
- Mobile-first (360–430 px): a week row with outlined and filled dots and "Plan: …" fits two lines at
  360 px; the target-day chips wrap per week; light and dark; touch targets ≥ 48 px.
- i18n (es reference + en): `plan.*` (plan del día, añadir al plan, registrar lo planificado, quitar del
  plan, registrado, planificar entreno and its choices, planificar con mi rutina, copiar día / semana,
  confirmation, undo, notices, offline), `week.planEnergy`, `training.planWeek`, `today.plannedSession`,
  the updated `consent.points.what`.
- E2E (`apps/e2e`, mock backend, clock fixed with `page.clock`): plan a dinner for Thursday by search and
  see an outlined dot and "Plan: …" on the week view while Today's summary does not change; move the clock
  to Thursday, "Registrar lo planificado" on the Food tab, the summary counts it once, the plan shows "✓",
  delete the log item and it is pending again; "Planificar con mi rutina" (gym L-X-V) → A, B, C, Today on
  Wednesday shows "Hoy: Rutina B · Empezar", the saved workout has the routine session and the plan
  links; plan an activity and log it with "Hecho"; "Copiar día" onto a day with a plan (confirmation,
  replace, undo); "Copiar semana" to next week; plan and log offline, sync in order; `ed_soft_stop` hides
  every planned number.

## Safety & edge cases

- **Nothing judges the plan.** A planned meal or session that was not logged is never called missed,
  skipped or failed; past rows of the week view show only the logs (AC2); there is no adherence number or
  colour (ADR 006). E5b decides whether the weekly review compares planned and done.
- **`ed_soft_stop`**: the planner works without numbers (AC3); "Planificar con mi rutina" never places
  more sessions than the days the user declared; no copy suggests eating less or training more. Whether
  meal planning should be offered at all to this group goes to the professional reviewer (Open
  questions).
- **Low planned days**: no notice in this spec when a planned day adds up to far less than the target
  (the food log has none either); the professional review decides (Open questions). The plan never
  changes targets, the deficit or the safety rules of specs 002–004.
- **Pregnancy**: planned energy without a target (AC3); a planned routine session is a routine session
  (the pregnancy rule of spec 010 already gives an empty routine built by hand). **`teen_limited`**: no
  change (the routine's limits apply). **Injury / medical condition**: the quiet line of spec 009 shows
  on a planned gym session as on any session.
- **Training load**: `planNotices` (AC13) only ever suggests less (overlap with work, the day before a
  match); "Planificar con mi rutina" uses only the declared gym days and never adds a day. The readiness
  of spec 011 adjusts a planned routine session started today exactly as the rotation's session.
- **Allergies**: foods chosen by hand are not checked against the profile (ADR 006: allergies are checked
  when a plan proposes food, in E7).
- **Dates and times**: "today" uses the day start of spec 010 AC6; planned times are minutes after
  midnight on that local date, shown 24 h in es and 12 h in en; the horizon moves with today, and a plan
  already stored beyond a shortened horizon is not possible (the horizon only grows by one day a day).
  DST nights move nothing (wall-clock minutes).
- **Stale links**: a routine session removed or a routine replaced turns its planned sessions into free
  gym sessions with their name (AC11 replaces them); a deleted workout used by "Repetir" does the same; a
  custom food deleted later keeps the planned snapshot and logs as a quick add with that snapshot.
- **Units**: grams or millilitres as the food's unit (spec 006); energy and macros only in the snapshot,
  computed by `@pt/core`.
- **Limits**: 150 planned items and 4 planned sessions per day, 300 changes per bulk write (a copied week
  is split by `planChangesToRequests`).

## Out of scope

- AI plan generation, plan suggestions, allergen checks of a plan (E7); planning with the barcode, the
  label, the plate photo or a sentence.
- Saved meals and recipes, a shopping list, batch-cooking quantities.
- A one-off exercise list for a future session (use the routine or "Repetir"); planned weights or reps.
- Reshuffling the plan when a session is missed, drag and drop between days, recurring rules ("every
  Monday": the typical week covers sessions, "Copiar semana" covers the rest).
- Planned versus done in the weekly review, adherence, streaks (E5b and later); reminders and
  notifications for planned items (E8).
- Calorie cycling or targets per day; planning beyond four weeks; sharing a plan.
- Any change to the context snapshot.

## Open questions

- For the professional reviewer: should meal planning be offered to users with `ed_soft_stop` (planning
  food ahead can reinforce restriction), and in what form? Should a fully planned day well under the
  target or under a minimum show a quiet notice, and with which threshold? The two `planNotices` reuse
  the provisional thresholds of spec 010 AC5.
- Whether E5b's weekly review should read "planned and done" (ADR 006 Consequences): decided in the E5b
  spec, not here.

## Progress

- [x] contracts · [x] db · [x] core · [ ] api · [ ] client · [ ] ui · [ ] e2e
- Decisions taken during implementation:
  - Contracts: `CONSENT_VERSION` was not bumped in the contracts step; it changes to `2026-11-v10` in the
    API step, with the 403 `consent_required` test (AC24). The `planned_workouts` minutes check is 1–600
    (as the contract's gym minutes), not 5–600 as the data table above says; activities keep 5–600.
  - Core (approved by the human 2026-11-25):
    1. A session of a deleted routine keeps its link (spec 010 AC20 tombstones the routine and keeps
       its session rows): `isStaleRoutineLink` reads it as a free gym session with its name and "Planificar
       con mi rutina" replaces it. A session removed from a routine loses the link in the database (a free
       gym session, kept). So `GET /me/plan` returns routine links as stored; it nulls repeat links to
       deleted workouts (contract comment).
    2. `planNotices` "hard activity": a planned activity is hard when the profile activity with the same
       name is hard (planned rows have no intensity); a planned gym session is strength.
    3. The sessions of a day are its planned sessions when it has some, otherwise the typical week's:
       the week view (today and future rows), the readiness and the match of the next day read it so.
       Past rows keep the typical slots as in spec 010.
    4. `withTodayPlan`: with planned sessions today, the readiness takes the first pending planned
       routine session; a pending free or repeated gym session counts as training without a session to
       cut; what was done today is left out (all done: nothing to adjust).
    5. Copy respects the day limits (150 items, 4 sessions) and says so (`capped`) instead of letting the
       API answer 400 and stall the queue.
  - Core: `PlanChanges` holds rows (not upserts), so one value feeds the optimistic cache and
    `planChangesToRequests` (deletes first, cut at 300). An undo is stamped with the copy's time; the
    app stamps it again at undo time (`stampChanges`). `repeatableMeal` gains the plan (AC8).
    `WEEK_VIEW.weeksForward` is 3 (`PLAN_LIMITS.horizonWeeksAhead`).
