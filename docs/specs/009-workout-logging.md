# 009 — Exercise library, Training tab and workout logging

- Status: approved (2026-11-18)
- Phase: E5, slice (a) of three. Slice (b) (spec 010): training profile, typical week, the week view
  (Today's Day / Week switch) and the starter routine from templates. Slice (c) (spec 011): daily
  check-in, day readiness and the typed or spoken sentence shortcut (Claude Haiku 5.5, with its eval).
- Tier: free (no AI in this spec, so there is no cap)

## Problem / user story

As a user in the gym, I want to log each set with a couple of taps while I train, see what I lifted last
time and notice when I beat it, so that I keep a history of my training without typing and without
coverage.

As a user who also plays a sport, I want to log a football practice or a run in a few seconds, so that
the app knows what I actually did, not only what I planned.

## Decisions taken with the human (2026-11-18)

- **E5 is split in three specs, the session first** (see Phase).
- **Exercise catalog from free-exercise-db** (public domain, Unlicense: reuse allowed, also commercial,
  no attribution required; we credit it anyway). It has about 870 exercises in English only, so the
  catalog is a **curated list of about 150–200 common exercises** with Spanish names and synonyms written
  by us, as with the foods of spec 005. wger (CC-BY-SA) waits for the license review.
- **Navigation as in ADR 006**: a fifth tab, Entreno (Hoy · Comida · Entreno · Progreso · Perfil). The
  Day / Week switch on Today arrives with the week view in spec 010.

## Assumptions (to confirm in the review)

- **The exercise catalog is on the device.** It is small (≈200 rows), so the app downloads it once,
  keeps it in the offline cache and searches it with a pure function of `@pt/core`. A session can start
  and exercises can be added in a gym basement without coverage. Food search stays on the server.
- **Four ways to track an exercise**, set per exercise in the curated list: weight and reps (press
  banca), reps only (dominadas), time (plancha) and distance with time (remo ergómetro). Bodyweight
  exercises can take extra weight (lastre) as an option.
- **Custom exercises.** When an exercise is not in the catalog, the user creates one with a name, a
  tracking type and optionally a muscle group. Only its owner sees it (same model as the custom foods of
  spec 006).
- **Two kinds of entry**: a **gym session** (exercises and sets, logged live or afterwards) and an
  **activity** (sport, cardio or other: a type, minutes and how hard it was, no sets). Both are rows of
  `workouts`.
- **The live session is a pure reducer in `@pt/core`, persisted on the device** (BLUEPRINT §5). Nothing
  reaches the API until the user taps "Terminar"; then the whole session is one idempotent `PUT`,
  queued offline like the food log.
- **Prefill from last time.** Adding an exercise prefills its sets with the reps and weight of the last
  session that had it, shown as placeholders until the user confirms each set.
- **Personal bests are computed, not stored.** `@pt/core` derives them from the logged sets: heaviest
  weight, best estimated 1RM (Epley, sets of 1–12 reps), most reps in a set, longest time and longest
  distance. The API returns, per exercise the user has done, the last session's sets and the bests, and
  the app caches it offline, so a new best is detected during the session without coverage. Editing or
  deleting an old session changes the bests on the next read.
- **Logged sessions do not change the calorie targets.** Targets already count the planned training
  (`targets-v2`), so exercise is counted once (BLUEPRINT §5). No "calories burned" is shown anywhere.
- **Past days**: a session or an activity can be logged for today and the 6 days before (same rule as
  the food log). The week view of spec 010 decides whether to go further back.
- **The screen stays awake** during a live session (`expo-keep-awake`), and the rest timer gives a haptic
  and a short sound at the end while the app is in the foreground. Notifications in the background are
  out of scope.

## Acceptance criteria

### Exercise catalog (import)

- **AC1** — Given the curated list (`packages/db/src/knowledge/catalog/exercises.csv`: key, source id,
  Spanish name, Spanish synonyms, English name, English synonyms, tracking type, popularity), when the
  importer runs, then every exercise gets its category, primary and secondary muscles and equipment from
  its free-exercise-db record, mapped to our enums, plus `source`, `source_id` and the source version.
  Running it again updates the rows and never duplicates them (unique `source` + `source_id`). A key
  whose source id does not exist is listed in the import report and skipped. _(free)_
- **AC2** — Given the imported catalog, then `knowledge_sources` has a row for free-exercise-db (name,
  URL, license, version, attribution in es and en) and Profile → "Fuentes de datos" shows it. _(free)_

### Exercise search (in `@pt/core`, on the device)

- **AC3** — Given a query, then `searchExercises` matches names and synonyms of the user's locale (and
  English names in both locales), ignoring case and accents, by word prefix in any order ("banca press"
  finds "Press de banca") and with one typo in words of 5 letters or more ("sentadila"). Ranking: whole
  name, name prefix, synonyms, then similarity; ties go to popularity. The user's custom exercises are
  searched too. _(free)_
- **AC4** — Given the search fixture (`packages/core/src/training/exercise-search.fixture.json`, at least
  80 real gym queries in Spanish with the expected keys: slang such as "jalón", "hip thrust", "peso
  muerto rumano", "fondos", "curl martillo"; plurals; typos), then the expected exercise is first in at
  least 85 % and in the top 3 in at least 95 % (provisional). It runs as a Vitest test. _(free)_
- **AC5** — Given the exercise picker with an empty query, then it shows the user's recent exercises
  (the last 20 done) and filter chips by muscle group (pecho, espalda, hombros, bíceps, tríceps,
  piernas, glúteos, core, cardio); given no results, then it offers "Crear ejercicio" with the query as
  its name. _(free)_

### Live session

- **AC6** — Given the Training tab, when the user taps "Empezar entreno", then a session starts with the
  current time and an empty list, and the session screen opens. Given a session already in progress,
  then the tab shows it ("Entreno en curso · 23 min · Continuar") instead of starting a second one.
  _(free)_
- **AC7** — Given a session, when the user adds an exercise from the picker, then it appears with as
  many sets as last time (3 if never done), each prefilled with last time's reps and weight as
  placeholders, and a line "Última vez: 3 × 8 · 60 kg (12 oct)". Several exercises can be picked in one
  visit to the picker. Exercises can be reordered and removed. _(free)_
- **AC8** — Given a set of a weight-and-reps exercise, then the user changes the weight with a stepper
  (2.5 kg steps; 5 lb in imperial units) or by typing, and the reps with a stepper, and taps ✓ to
  complete it. A placeholder becomes the value when the set is completed without changes. Reps-only,
  time and distance exercises show the matching fields (time with a stopwatch button and a field in
  mm:ss). "Añadir serie" copies the last set. A completed set can be edited or un-completed. _(free)_
- **AC9** — Given a completed set, then a rest timer starts (90 s by default, the last rest used for that
  exercise if any), shows the countdown on the session screen with −15 s / +15 s / "Saltar", and at 0
  gives a haptic and a sound. The timer keeps the right time after the app goes to the background or the
  device locks (it is computed from timestamps, not ticks). _(free)_
- **AC10** — Given a completed set that beats a personal best of that exercise (AC14), then the set shows
  a "Récord" badge with what it beat ("Nuevo récord: 62.5 kg", "1RM estimado: 75 kg"). Given an exercise
  never done before, then no badge is shown in that first session. _(free)_
- **AC11** — Given the session in progress, when the app is closed, killed or the device restarts, then
  reopening the app restores the session with its sets, the timer state and the start time. _(free)_
- **AC12** — Given "Terminar", then a summary sheet shows the duration (editable, 1–600 min), the
  exercises, completed sets, volume (kg × reps, weight exercises only) and the new records, asks how hard
  it was (session RPE 1–10 as chips, optional) and an optional name; "Guardar" stores the session with
  only the completed sets. Given no completed set, then "Guardar" is disabled and "Descartar" is
  offered. "Descartar entreno" asks for confirmation and deletes the session from the device. _(free)_
- **AC13** — Given a session open for more than 6 hours, when the user opens the app, then it asks
  whether they finished, with the end time set to the last completed set (or the start for an empty
  session) and the summary of AC12. _(free)_

### Personal bests and exercise history

- **AC14** — Given the sets of an exercise, then `personalBests` in `@pt/core` returns the heaviest
  weight (any reps), the best estimated 1RM (Epley: weight × (1 + reps / 30), only for 1–12 reps, and
  equal to the weight for 1 rep), the most reps in one set (reps-only), the longest time (time) and the
  longest distance (distance). A set beats a best only when it is strictly greater after rounding to
  0.5 kg (1RM) or to the unit. _(free)_
- **AC15** — Given an exercise in the library or in a session, when the user opens it, then it shows the
  bests with their dates and the last 10 sessions that had it (date and sets), and, for weight exercises
  done in at least 3 sessions, a simple chart of the best set per session (estimated 1RM). _(free)_

### Logging after the fact, activities and repeat

- **AC16** — Given the Training tab, when the user taps "Registrar actividad", then a sheet asks for the
  type (chips: the activities of the profile first, e.g. "Fútbol", then fútbol, pádel, correr,
  bicicleta, natación, caminar, clase dirigida, otro), the day (chips: today and the 6 days before),
  minutes (chips 30/45/60/90 and a field, 5–600) and how hard it was (session RPE 1–10, optional), and
  saves it with one tap. _(free)_
- **AC17** — Given "Registrar entreno pasado", then the user picks the day and the start time and fills a
  session with the same screen as AC7–AC8, without rest timer, and saves it with AC12. _(free)_
- **AC18** — Given a past session in the history, when the user taps "Repetir", then a live session
  starts with the same exercises in the same order and the same number of sets, prefilled as in AC7
  (values of that session). The Training tab shows the last 3 distinct sessions with "Repetir". _(free)_
- **AC19** — Given a saved session or activity, when the user opens it, then they can edit the day,
  duration, RPE, name, exercises and sets, or delete it with a 5-second undo instead of a confirmation.
  _(free)_

### Training tab and Today

- **AC20** — Given the Training tab, then it shows, in this order: the session in progress (if any),
  "Empezar entreno", "Registrar actividad", the 3 "Repetir" shortcuts, and the history of the last 30
  days grouped by week (each entry: day, name or type, duration, exercises and sets or minutes, and a
  "Récord" mark when it had one), with "Ver más" for older weeks; and a link to the exercise library.
  Given no history, then it shows a one-line hint and the two buttons. _(free)_
- **AC21** — Given Today, then it gains "Registrar entreno" next to "Registrar comida" (it opens the
  Training tab's choice: start a session or log an activity), and a line with what was done today
  ("Hoy: Pierna · 55 min · 1 récord"), or the session in progress with "Continuar". The planned-training
  line of spec 003 stays. _(free)_

### Offline-safe writes (same rules as specs 003 and 005)

- **AC22** — Given no connection, when the user saves, edits or deletes a session or an activity, or
  creates a custom exercise, then the change shows at once marked "pendiente de sincronizar" and is sent
  when the connection returns, also after a restart. The catalog, the user's custom exercises, the last
  60 days of workouts and the exercise stats (AC14) are in the offline cache. _(free)_
- **AC23** — Given a write sent twice, then the database has one workout with that id and its sets are
  replaced, not duplicated (`PUT` replaces the whole workout). Given two writes to the same workout,
  then the later `recordedAt` wins whatever the order of arrival; given a delete, then a later `PUT` with
  an earlier `recordedAt` does not bring it back (tombstone). Given a queued write the API rejects (400),
  then the change is undone and the user sees why. _(free)_

### Data and privacy

- **AC24** — Given the consent text, then it lists the training log ("los entrenamientos y actividades
  que registras"), `CONSENT_VERSION` changes to `2026-11-v7`, and existing users are asked again before
  any health-data route works. _(free)_
- **AC25** — Given "Descargar mis datos", then it includes every workout with its sets and the custom
  exercises; given "Borrar mi cuenta", then they are deleted (the schema-driven test covers the new
  tables). The catalog is not user data and is not exported. _(free)_

## Data changes

| Table        | Column                                          | Type                                                                      | Notes                                                                                                 |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| exercises    | id                                              | uuid PK                                                                   | catalog rows from the importer; custom rows from the client (client id)                               |
|              | key                                             | text unique null                                                          | curated key (`press-banca`), null for custom exercises                                                |
|              | origin / owner_id                               | enum `exercise_origin` (catalog, user) / uuid FK profiles cascade null    | check: `owner_id is null` ⇔ `origin = 'catalog'`                                                      |
|              | source / source_id                              | text FK knowledge_sources null / text null                                | unique (source, source_id); null for custom                                                           |
|              | name_es, name_en                                | text                                                                      | custom: the same name in both                                                                         |
|              | synonyms_es, synonyms_en                        | text[]                                                                    |                                                                                                       |
|              | tracking                                        | enum `exercise_tracking` (weight_reps, reps, duration, distance_duration) |                                                                                                       |
|              | category                                        | enum `exercise_category` (strength, cardio, mobility, plyometrics, other) |                                                                                                       |
|              | primary_muscles, secondary_muscles              | enum `muscle_group`[]                                                     | chest, back, shoulders, biceps, triceps, forearms, quads, hamstrings, glutes, calves, core, full_body |
|              | equipment                                       | enum `equipment`[]                                                        | barbell, dumbbell, machine, cable, kettlebell, band, bodyweight, other                                |
|              | popularity                                      | smallint                                                                  |                                                                                                       |
|              | recorded_at, deleted_at, created_at, updated_at | timestamptz                                                               | custom rows: last write wins, tombstone                                                               |
| workouts     | id                                              | uuid PK (client-generated)                                                |                                                                                                       |
|              | user_id                                         | uuid FK profiles cascade                                                  | index (user_id, local_date)                                                                           |
|              | local_date                                      | date                                                                      | the day the session started                                                                           |
|              | kind                                            | enum `workout_kind` (gym, sport, cardio, other)                           |                                                                                                       |
|              | activity                                        | text null                                                                 | activity type key or the profile activity's name (AC16), ≤ 40 chars                                   |
|              | name                                            | text null                                                                 | ≤ 60 chars                                                                                            |
|              | started_at                                      | timestamptz                                                               |                                                                                                       |
|              | minutes                                         | smallint                                                                  | check 1–600 (activities: 5–600, in the contract)                                                      |
|              | session_rpe                                     | smallint null                                                             | check 1–10                                                                                            |
|              | input_method                                    | enum `workout_input_method` (live, manual, repeat, activity)              | spec 011 adds `text`, `voice`                                                                         |
|              | recorded_at / deleted_at                        | timestamptz / timestamptz null                                            | last write wins; tombstone purged after 30 days                                                       |
|              | created_at / updated_at                         | timestamptz                                                               |                                                                                                       |
| workout_sets | id                                              | uuid PK                                                                   | replaced with the workout on every `PUT`                                                              |
|              | workout_id                                      | uuid FK workouts cascade                                                  | index                                                                                                 |
|              | user_id                                         | uuid FK profiles cascade                                                  | for RLS and the stats query; index (user_id, exercise_id)                                             |
|              | exercise_id                                     | uuid FK exercises `on delete set null` null                               |                                                                                                       |
|              | exercise_label                                  | text                                                                      | snapshot of the name                                                                                  |
|              | position / set_number                           | smallint / smallint                                                       | exercise order in the session / set order within it                                                   |
|              | reps                                            | smallint null                                                             | check 1–100                                                                                           |
|              | weight_kg                                       | numeric(5,2) null                                                         | check 0–500; extra load for bodyweight exercises                                                      |
|              | duration_s / distance_m                         | integer null / integer null                                               | check 1–10800 / 1–100000                                                                              |
|              | rest_s                                          | smallint null                                                             | rest used after the set (prefills AC9)                                                                |

- RLS: catalog rows of `exercises` are readable by `authenticated`, custom rows only by their owner;
  `workouts` and `workout_sets` only where `user_id = auth.uid()`. No write policies: every write goes
  through the API (the importer uses the service connection).
- One migration: enums, tables, indexes, checks. The catalog is loaded by
  `pnpm --filter @pt/db import:exercises`, not by the migration. The source JSON is downloaded to a cache
  outside git; only the curated CSV is committed.
- BLUEPRINT §5 is updated: `workouts.kind` gains `cardio` and `other`, `personal_records` is computed (not
  a table), `exercises` gains `origin`/`owner_id`, and `met_value` waits for the MET import.

## API contracts

- Schemas to add to `@pt/contracts` (`training.ts`): `ExerciseTrackingSchema`, `ExerciseCategorySchema`,
  `MuscleGroupSchema`, `EquipmentSchema`, `ExerciseSchema`, `ExerciseCatalogResponseSchema` (catalog +
  the user's custom exercises + a `version` for the cache), `CustomExerciseUpsertRequestSchema`,
  `WorkoutKindSchema`, `WorkoutInputMethodSchema`, `WorkoutSetSchema`, `WorkoutSchema`,
  `WorkoutUpsertRequestSchema` (gym: exercises with sets; activity: `activity`, `minutes`; always
  `localDate`, `startedAt`, `recordedAt`, `today`), `WorkoutLogQuerySchema` (`from`, `to`, at most 62
  days), `WorkoutLogResponseSchema`, `ExerciseStatsResponseSchema` (per exercise done: last session's
  sets and date, bests with dates, last rest), `ExerciseHistoryResponseSchema`, `TRAINING_LIMITS`
  (weight 0–500 kg, reps 1–100, time 1 s–3 h, distance 1 m–100 km, 20 sets per exercise, 30 exercises
  per session, minutes 1–600, 10 workouts per day).
- Schemas to change: `ExportResponseSchema` (`workouts`, `workoutSets`, `customExercises`),
  `CONSENT_VERSION`.
- `GET /exercises` → 200 / 401 / 403 (catalog + own custom exercises)
- `PUT /me/exercises/{id}` → 200 / 400 / 401 / 403 / 409 (`id` is a catalog exercise);
  `DELETE /me/exercises/{id}?recordedAt` → 200 / 401 / 403 (past sets keep their label)
- `GET /me/workouts?from&to` → 200 / 400 / 401 / 403
- `PUT /me/workouts/{id}` → 200 (stored workout, or the newer one that won) / 400 / 401 / 403 / 404
  (unknown or someone else's `exerciseId`)
- `DELETE /me/workouts/{id}?recordedAt` → 200 / 400 / 401 / 403
- `GET /me/exercises/stats` → 200 / 401 / 403; `GET /me/exercises/{id}/history?limit` → 200 / 401 / 403
  / 404
- Every route needs the current consent (403 `consent_required`).
- `@pt/core` (test-first), `training/`: `normalizeExerciseQuery`, `searchExercises`,
  `sessionReducer` + `initialSession` (actions: add / remove / reorder exercise, add / update / complete
  / uncomplete / remove set, rest start / adjust / skip, finish), `restRemaining(timer, now)`,
  `prefillSets(lastSets, tracking)`, `estimatedOneRepMax`, `personalBests`, `newBests(set, bests)`,
  `sessionSummary` (duration, sets, volume, new records), `repeatWorkout(workout, now, newIds)`,
  `sessionToRequest`, `isStaleSession(session, now)` (AC13), weight steps and conversions via
  `core/units`.
- `@pt/api-client`: methods, query options, mutations registered by key (spec 005 pattern: optimistic,
  one queue scope, restored after a restart), and the routes in the mock backend with a fixture of about
  40 exercises.

## UI

- Routes: `(tabs)/training` (new tab, between Comida and Progreso), `training/session` (full-screen live
  session; also used for AC17 without timer), `training/picker` (modal: search, recents, muscle chips,
  multi-select, "Crear ejercicio"), `training/activity` (sheet, AC16), `training/workout/[id]` (detail
  and edit), `training/exercises` (library), `training/exercises/[id]` (bests and history, AC15),
  `training/exercises/new` (custom exercise).
- Components: `SessionHeader` (elapsed time, "Terminar"), `ExerciseCard`, `SetRow` (steppers, ✓,
  placeholder style, "Récord" badge), `RestTimerBar`, `FinishSheet`, `WorkoutRow`, `RepeatShortcut`,
  `ExercisePickerList`, `BestsCard`, `ExerciseProgressChart` (estimated 1RM per session; the
  `dataviz` skill applies).
- The persisted live session lives in device storage (`.native.tsx` / `.web.tsx` adapters only if
  storage differs), not in the TanStack Query cache.
- States: loading, empty tab (AC20), picker offline (works: catalog cached), picker with no results
  (AC5), session restored (AC11), stale session (AC13), pending sync, saved, error with retry.
- Mobile-first (360–430 px) and one-handed in the gym: the ✓ and the steppers are at least 48 px, the
  set row fits in one line at 360 px, the timer bar stays visible above the keyboard; light and dark.
- i18n (es reference + en): `tabs.training`, `training.*` (session, sets, rest, records, finish,
  activity types, history, repeat, library, custom exercise, errors), `today.logWorkout`,
  `today.trainingDone`, the updated `consent.points.what`, `sources.*` for free-exercise-db, and the
  exercise names come from the catalog, not from i18n.
- E2E (`apps/e2e`, mock backend): a live session with two exercises (prefill, edit, complete, rest
  timer, a record) saved and shown on the Training tab and on Today; reload in the middle of a session
  and continue; log an activity for yesterday; repeat a session; edit and delete with undo; create a
  custom exercise and use it; a session saved offline that syncs once after going online.

## Safety & edge cases

- **No calories burned, no targets change** (see Assumptions). The app never pushes more training: no
  "you trained less this week", no streak pressure in this slice, no red for a short session.
- **`ed_soft_stop`**: the Training tab shows no volume totals and no "récord" badges for bodyweight
  exercises (reps-only and time), to avoid feeding compulsive exercise; logging works the same. To be
  checked by `domain-reviewer`.
- **Injuries** (`injury` flag, free-text field of the profile): the Training tab shows a quiet line "Si
  algo te duele, para y consulta a un profesional"; the app does not filter exercises (structured
  injuries come with programs in E7).
- **Ages 16–17**: they log like everyone else; the estimated 1RM is shown as a number, never as a
  suggestion to test a single maximal rep. Pregnancy: a notice to follow the advice of their midwife or
  doctor on the Training tab; no other change.
- **Estimated 1RM** is an estimate (Epley is less accurate above ~10 reps); the bests screen says so and
  only uses 1–12 reps.
- **Typing mistakes**: limits of `TRAINING_LIMITS`; a weight more than 50 % above the exercise's
  heaviest weight asks "¿Seguro? 250 kg" before completing the set (a 2.5 → 25 slip would create a false
  record that lives forever).
- **Units**: kg internally; imperial users see lb with 5 lb steps, converted at the UI edge
  (`core/units`) and stored in kg with 2 decimals; a round trip lb → kg → lb shows the same number.
- **Dates and time**: `local_date` is the day the session started on the device; a session that crosses
  midnight stays on its start day. Same write rules as spec 005 (`today` within ±1 day of server UTC, no
  future `localDate`, at most 6 days back for new entries from the UI, 1 year for the API, `recordedAt`
  at most 1 day ahead). `day_start_minute` still waits for spec 010.
- **Clock changes**: the rest timer and the elapsed time use timestamps; a negative or absurd duration
  (device clock changed) falls back to the sum of the set timestamps and is editable at finish.
- **Two devices**: the live session is per device; two sessions started on two devices are two workouts.
- **Deleting a custom exercise** keeps the sets of past sessions with their label snapshot.

## Out of scope

- Training profile (experience, days, equipment), typical week grid, week view, the Day / Week switch,
  starter routine from templates, today's planned session (spec 010).
- Daily check-in, day readiness, the typed or spoken sentence shortcut and its eval (spec 011).
- Programs, AI-generated sessions, structured injuries and exercise filtering by injury (E7); planned
  sessions (E5c).
- wger, exercise images and videos, instructions text, MET values and calories burned.
- Per-set RPE, RIR, supersets and circuits, warm-up sets marked as such, drop sets, plate calculator,
  rest notifications in the background, Apple Watch / Wear OS, HealthKit / Health Connect (E10).
- Points, streaks and achievements for training (E8).
- Adding the workout log to `ContextSnapshot` (spec 010 and E5b define what they need).

## Open questions

- For the professional reviewer: the curated exercise list and its Spanish names, the default rest of
  90 s, the Epley formula and the 1–12 reps limit, the 50 % jump check, the `ed_soft_stop` rules on the
  Training tab, and whether 16–17-year-olds should see the estimated 1RM.
- The human: review a sample of 50 Spanish exercise names and the search fixture before closing the
  spec.
- From the domain review of the UI (2026-11-19), for the professional reviewer: with `ed_soft_stop`,
  should distance records (cardio) also be hidden, or every record? Compulsive exercise is mostly
  endurance driven (Dalle Grave 2009); today only reps-only and time records are hidden, as written. A
  first-ever weight has no history to compare with, so a typo (250 kg) is not asked about: should the
  first entry be checked against body weight? Should `teen_limited` users see the estimated 1RM, and
  should `medical_condition` get a note on the Training tab?
- Whether to show exercise images from free-exercise-db (they are public domain, ≈2 images per
  exercise, hosted on GitHub) in a later spec, and where to host them (Supabase Storage).

## Progress

- [x] contracts · [x] db · [x] core · [x] api · [x] client · [x] ui · [x] e2e
- Decisions taken during implementation:
  - The limits are `WORKOUT_LIMITS` (`TRAINING_LIMITS` already names the weekly plan of spec 002).
  - `workouts.activity` is an enum (`activity_type`, the chips of AC16), not free text; the name of a
    profile activity goes to `name`. `workout_sets` keeps a `tracking` snapshot next to the label.
  - The export schema and `CONSENT_VERSION` change with the API step (export) and the UI step (consent
    text), so every commit keeps `pnpm check` green.
  - free-exercise-db is The Unlicense (checked 2026-11-18, `LICENSE.md`); the importer downloads
    `dist/exercises.json` pinned to commit `f00c92c` (2026-09-27). Its muscles map to our 12 groups
    (lats, middle and lower back, traps and neck → back; abductors → glutes; adductors → quads).
  - The search fixture (AC4) lives next to the catalog in `@pt/db`
    (`knowledge/catalog/exercise-search.fixture.json`, test `knowledge/exercises/search.test.ts`),
    because `@pt/core` cannot read files; `@pt/db` has `@pt/core` as a dev dependency for it.
    `searchExercises` reuses the ranking of the food search.
  - API step: the export has `workouts` with their sets nested (no separate `workoutSets` list) and
    `customExercises`, deleted ones included with `deletedAt` (the row is a tombstone, so it is still
    data we hold). New error codes `exercise_limit_reached` (400) and `id_taken` (409, a catalog id or
    another user's id). A deleted custom exercise stays loggable for its owner, so editing an old
    session that used it does not fail with 404. `@pt/core` gained `customExercise` (the API and the
    optimistic client build the same row) and `exerciseHistory`. AC2 needs no new route: the
    free-exercise-db row is listed by `GET /foods/sources` once the importer has run.
- Done so far (2026-11-18), one commit per step: contracts (`4aac4c8`); tables, migration
  `0009_workout_log` (additive: 8 enums, 3 tables with RLS) and the curated catalog of 192 exercises
  with its importer (`5df9f7b`); core (`cbf6ce5`): `training/sets` (tracking, steppers, fields, weight
  jump), `bests` (Epley, personal bests, exercise stats, 1RM series), `session` (reducer, rest timer,
  records, summary, request, stale session, repeat, edit), `search`, `write` (write rules, workout from
  request, activity chips, repeat shortcuts). Search fixture: 176 queries, 98.3 % first and 100 % in
  the top 3 (misses: "curl biceps", "elevacion de piernas", "maquina de remo", all ambiguous).
- API (2026-11-18): 8 routes in `routes/training`, Drizzle store `store/training-store.ts`, 38 route
  tests (401/403 on every route, AC12, AC14–AC16, AC23, AC25). The account deletion integration test
  now writes custom exercises and workouts through the Drizzle store (AC23 rules, AC25 cascade) and
  lists `exercises`, `workouts`, `workout_sets`.
- Human (2026-11-18): reviewed the SQL of `0009_workout_log`, applied it to dev, imported the exercise
  catalog and ran `pnpm --filter @pt/api test:integration`.
- Client (2026-11-18): 8 methods in `client.ts`; `training.ts` with query options (catalog, workouts
  of the last 60 days, stats, history) and four mutations registered by key in one queue scope
  (`training`), so a custom exercise created offline is sent before the session that uses it. Saving
  a workout updates the cached stats at once with `statsWithWorkout` (new in `@pt/core`, test-first),
  so a record is detected in the next session also offline; bests only rise there, and edits or
  deletes that lower them show on the next read. `saveWorkoutVariables` takes the edited workout so a
  deleted custom exercise stays loggable in its old session, as in the API. Hooks in `createApiHooks`.
  Mock backend: the 8 routes with the API's rules, export, the free-exercise-db source, and 40 real
  exercises (`mock/exercises.ts`, generated once from the curated CSV and the pinned source record;
  every way of tracking); `MOCK_DB_KEY` is now `v7`. Tests: route mapping, cache and optimistic
  writes, offline queue across a restart (AC22), later write wins and tombstone (AC23), rejection
  undo, mock routes (403, 404, 409, AC25 export and delete).
- UI (2026-11-19): the Training tab (fifth tab), the session screen (live, past and edit), the picker,
  the activity sheet, the workout sheet, the library, the exercise page with the 1RM chart, the new
  exercise form, the Today card, consent `2026-11-v7`. Decisions:
  - The session lives in device storage in two slots per user (`lib/liveSession.ts`): `live` (the gym
    session, one at a time) and `draft` (a past session of AC17 or a saved one edited for AC19), so an
    edit never touches the session in progress. Sign-out deletes both.
  - The set row fits one line at 360 px: ✓ is 48 × 48 and doubles as the set number; the steppers are
    segmented groups with 44 × 48 px buttons (48 tall, 44 wide, the iOS minimum); the session screen has
    8 px side margins. Weight and reps can also be typed. "Quitar serie" removes the last set.
  - The rest bar lives in the footer (above the keyboard). At 0 it says "Descanso terminado" with a
    haptic and a chime (`expo-haptics`, `expo-audio` with a 0.4 s WAV made for the app; no microphone or
    background audio permissions); it closes on "Saltar", the next set, or 30 s later. A timer that
    ended while the app was in the background closes without the chime.
  - Keep-awake uses `activateKeepAwakeAsync` in an effect, not `useKeepAwake`, which throws on web when
    it is released before the wake lock is granted.
  - The "Récord" mark of a saved workout (AC20, AC21) is computed from the cached stats and the 60-day
    log (`workoutRecordCount`): a set that holds an all-time best first reached that day, in an exercise
    done before in the log. An exercise whose earlier sessions are all older than 60 days shows no mark.
  - "Ver más" (AC20) extends the history from 30 to the 60 cached days; older weeks wait for the week
    view of spec 010.
  - "Registrar entreno" on Today opens the Training tab, which holds the choice (start or activity).
  - `ed_soft_stop`: no records, bests or volume for reps-only and time exercises anywhere in training,
    and no volume total in the summary (`showsRecordsFor` in core).
  - A finished set counted as a record shows one badge per beaten best (heaviest weight, estimated 1RM).
  - Domain review (2026-11-19), applied: the "Récord" mark counts each best once, in the first set that
    reached it, and not on a tie with an earlier workout of the same day; a completed set edited to a
    weight far above the heaviest goes back to unchecked, so ✓ asks "¿Seguro?" again; a workout with an
    exercise that no longer exists (only if an exercise row is ever removed: custom exercises are
    tombstoned today) cannot be edited and is deleted after a confirmation, because a `PUT` would erase
    that exercise's sets (`canRewriteWorkout`); "Descanso terminado." without a push; the injury line
    also on the session screen and naming "un profesional sanitario"; the badge reads "Nuevo récord:
    62,5 kg".
  - New in core (test-first): `training/view.ts` (`groupSets`, `weekStartOf`, `workoutHistoryWeeks`,
    `recentExerciseIds`, `showsRecordsFor`, `workoutRecordCount`, `canRewriteWorkout`, `workoutToRequest`).
- E2E (2026-11-19, `apps/e2e/tests/training.spec.ts`, 5 journeys on the mock backend): a live session
  with two exercises (typed and stepped sets, rest timer, summary, Today, repeat with prefill and a
  record); reload in the middle of a session; an activity for yesterday edited, deleted and undone; a
  custom exercise created from the picker and used; a session saved offline that syncs once. Checked by
  hand with the Playwright MCP at 360, 390 (light and dark) and 1280 px, no console errors.
- Left for the human: the phone check in Expo Go (haptic and chime at the end of the rest, the screen
  staying on, the keyboard over the set rows, the rest bar above the keyboard, the stopwatch), the
  sample review of 50 Spanish exercise names and the search fixture, the professional review (Open
  questions).
