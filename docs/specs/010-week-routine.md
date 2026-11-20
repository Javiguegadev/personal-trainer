# 010 — Typical week, week view and starter routine

- Status: approved (2026-11-19)
- Phase: E5, slice (b) of three. Slice (a) (spec 009): exercise library, Training tab, workout logging.
  Slice (c) (spec 011): daily check-in, day readiness and the sentence shortcut.
- Tier: free (no AI in this spec, so there is no cap)

## Problem / user story

As a user who works and trains, I want to tell the app on which days and at what time I work and train,
and to see my real week at a glance (work, training planned and done, meals logged), so that I know what
today and the next days look like and can open any day to add what I forgot.

As a user who goes to the gym without a plan, I want a simple starter routine that fits my days, my time
and my equipment, so that I can start a session in one tap instead of choosing exercises every time.

## Decisions taken with the human (2026-11-19)

- **The typical week is edited with day chips, not a time grid.** Each training activity of the profile
  gains weekday chips (L M X J V S D) and an optional start time; work gets a start and end time per
  weekday, with "copy to the other days". A "Mi semana" screen shows and edits it.
- **The week view shows, per day, which meals are logged and the kcal as neutral text**
  ("1.850 / 2.200 kcal"), never colours or judgement. With `ed_soft_stop`, only the meals, no numbers.
- **Starter routine: a short wizard and a rotation.** From the Training tab, three questions (experience,
  equipment, gym days taken from the profile) give a template from `@pt/core` that the user can edit. Its
  sessions rotate (A → B → C → A…) instead of being tied to weekdays, so a missed day loses nothing;
  Today shows "Toca: Rutina A · Empezar" and the session starts prefilled.

## Assumptions (to confirm in the review)

- **The days live on the existing activities.** `planned_activities` (spec 002) keeps kind, minutes and
  intensity; each activity may have days (weekday, optional start time, "partido" for sport). With days
  picked, `sessionsPerWeek` is their count. An activity without days keeps working as today ("3 veces por
  semana"), so nobody has to fill the week. Weekly energy does not depend on the weekday, so `targets-v3`
  does not change; changing the number of days does change the targets, with the notice of spec 003
  (old and new kcal).
- **One work block per weekday**, which may cross midnight (22:00–06:00). Split shifts are out of scope.
  The work pattern is asked: fixed hours, rotating shifts, irregular, or no job schedule. With shifts or
  irregular hours the typical week has no work blocks; spec 011 (check-in) asks for the day's shift.
- **"Mi día empieza a las"** (00:00–06:00, steps of 30 min, default 00:00) in "Mi semana": a meal logged
  at 02:00 by a night worker counts for the previous day (BLUEPRINT §5, `day_start_minute`). It changes
  how the app computes "today"; the API's `today` check (±1 day of server UTC) already allows it.
- **Experience and equipment are asked only by the routine wizard**, because only the routine uses
  them (principle 7: every datum changes something visible). They are stored on `training_profiles`.
- **The routine is a program** (`workout_programs` → `program_sessions` → `program_exercises`, the Plans
  block of BLUEPRINT §5), so the AI programs of E7 write the same tables. One active routine per user in
  this spec. Its session ids are stable across edits, and a workout started from a routine session
  stores that id; the next session in the rotation is the one after the session of the last workout
  that had one.
- **Templates are data in `@pt/core`** (exercise keys of the curated catalog of spec 009, sets and rep
  ranges), chosen by gym days, experience, focus and equipment, and trimmed to the activity's minutes.
  All numbers are provisional until the professional review.
- **No progression in this slice.** A routine session is prefilled with last time's values (spec 009
  AC7) or the routine's reps; suggesting more weight is E5b/E7.
- **The week starts on Monday** in both locales. The week view goes back 12 weeks; new meals and
  workouts can be logged from it for today and the 27 days before (the food log and the Training tab
  keep 6 days). Next week shows only the typical week (nothing is planned by hand until E5c).
- **Work hours and training days are a new data category** in the consent text ("tu horario de trabajo y
  de entrenamiento"), so `CONSENT_VERSION` changes and consent is asked again (pending-bugs lesson:
  the re-ask path already exists since 43e8bf7).

## Acceptance criteria

### Typical week ("Mi semana")

- **AC1** — Given Profile → "Mi semana" (also linked from the week view and from the Training tab), then
  it shows the work row and one row per planned activity, each with seven weekday chips and its times, as
  in the decision above, plus the work pattern and "Mi día empieza a las". _(free)_
- **AC2** — Given an activity row, when the user taps weekday chips, then `sessionsPerWeek` becomes the
  number of chips selected and the row shows "3 días"; given a start time (optional, 15-min steps), then
  it applies to every day of that activity; given a sport activity, then each selected day can be marked
  "partido" with its own start time. Clearing every chip turns the activity back into "N veces por
  semana" (the stepper of spec 002 returns, keeping the last count). _(free)_
- **AC3** — Given the work row with pattern "horario fijo", when the user picks weekdays and a start and
  end time, then every selected day gets that block; a day can then be changed alone; "Copiar a todos"
  copies one day's block to the other selected days. An end time earlier than the start means the block
  ends the next day ("22:00–06:00 · termina al día siguiente"); equal times are rejected. Given "turnos"
  or "irregular" or "sin horario", then the work blocks are hidden and not stored. _(free)_
- **AC4** — Given "Guardar" on "Mi semana", then the work pattern, work blocks, day start and the
  activities with their days are stored in one write; given a change in the number of training days,
  then the targets are recomputed and the notice of spec 003 shows the old and new kcal; given no change
  in counts, then the targets are untouched. The onboarding and profile forms keep their activity list,
  and an activity with days shows its day chips there instead of the stepper (same component). _(free)_
- **AC5** — Given the week, then `weekNotices` in `@pt/core` returns, shown under "Mi semana" (never
  blocking the save): a session that overlaps the work block of its day ("El gimnasio del lunes se solapa
  con tu trabajo"); a strength session or a hard-intensity session the day before a match ("El día antes
  del partido, mejor algo suave o descanso"); no rest day in the week ("Un día de descanso a la semana
  ayuda a recuperar"). Thresholds are provisional. _(free)_
- **AC6** — Given "Mi día empieza a las 04:00", when the device time is 02:30 on Tuesday, then Today, the
  Food tab, the weight sheet and the Training tab use Monday as today, and a meal logged then is stored
  with Monday's `local_date`. Given the default 00:00, then nothing changes from today's behaviour.
  _(free)_

### Week view (Today → Semana)

- **AC7** — Given Today, then a Day / Week switch sits under the title; "Día" is the current Today screen
  and "Semana" shows the current week, Monday to Sunday. The choice is remembered on the device. _(free)_
- **AC8** — Given the week view, then each day is one row with: weekday and date (today highlighted);
  the work block ("08:00–16:00", or nothing); the training planned for that weekday from the typical week
  ("Gimnasio 18:30", "Fútbol · partido 11:00"); the workouts logged (name or activity and minutes;
  planned and done are not matched in this slice); the meals logged as one dot per meal type with
  items, and the kcal of the day against the target as plain text. Days with nothing show only the date.
  _(free)_
- **AC9** — Given `ed_soft_stop`, then the week view shows the meal dots and no kcal; given any user, then
  no colour, icon or word judges a day (no red, no "objetivo cumplido", no streaks). _(free)_
- **AC10** — Given the week view, when the user taps "‹" / "›", then it moves one week back (up to 12
  weeks) or forward (up to next week); a future day shows only its typical week; a week whose logs are
  not cached and with no connection shows "Sin conexión: no hay datos guardados de esta semana" and its
  typical week. "Hoy" returns to the current week. _(free)_
- **AC11** — Given a day of the week view, when the user taps it, then the day screen opens with its date,
  work block, planned training, the meals of that day grouped by meal type (with their kcal, hidden with
  `ed_soft_stop`) and the workouts logged; tapping a meal item or a workout opens its existing edit
  screen (specs 005 and 009). _(free)_
- **AC12** — Given a day screen for today or one of the 27 days before, then it offers "Añadir comida"
  (the add screen of spec 005 on that date, meal chosen by the user) and "Registrar entreno" (the choice
  of an activity or a past session of spec 009 on that date); for older days the screen is read-only with
  "Solo puedes añadir registros de las últimas 4 semanas"; future days show only their typical week, with
  no add buttons and no "coming soon" promise. _(free)_

### Starter routine

- **AC13** — Given the Training tab, a strength activity in the profile and no routine, then a card
  "Crea tu rutina" opens the wizard; given no strength activity, then the card says "Añade el gimnasio a
  tu semana para crear una rutina" and links to "Mi semana". _(free)_
- **AC14** — Given the wizard, then it asks, one screen each with chips: experience ("Empiezo ahora o
  llevo menos de 6 meses", "Entre 6 meses y 2 años", "Más de 2 años"), equipment ("Gimnasio completo",
  "Mancuernas en casa", "Solo mi cuerpo"), and confirms the gym days and minutes from the profile ("3 días
  · 60 min", with "Cambiar" opening "Mi semana"). Experience and equipment are stored on the training
  profile and prefill the wizard next time. _(free)_
- **AC15** — Given the answers, then `starterRoutine` in `@pt/core` returns a routine from the templates:
  1 day → one full-body session; 2–3 days → full body A/B (A/B/C for 3 days from intermediate); 4 days →
  upper/lower A/B; 5–6 days → push/pull/legs from intermediate (beginners keep upper/lower and the
  rotation covers the extra days). Rep ranges follow the focus (strength: compound lifts 4–6 reps, 6–10
  for beginners, the rest 6–10; hypertrophy 8–12; general fitness and sport performance 10–15, at most 3
  sets); sport performance never gets more than 3 distinct sessions. Exercises are chosen for the
  equipment, and the session is trimmed to the minutes (each set counts 45 s of work, or its time, plus
  its rest, and 5 min are kept for the warm-up; at least 4 exercises; 30 min or less keeps 4 exercises
  with 2 sets). Every exercise key exists in the curated catalog (a test reads the CSV). _(free)_
- **AC16** — Given the proposed routine, then the user sees each session with its exercises, sets and
  reps ("Press de banca · 3 × 8–12"), can rename it, rename sessions, add (picker of spec 009), remove
  and reorder exercises, change sets (1–10) and the rep range or the time, and "Guardar rutina" stores
  it. The same editor opens later from "Mi rutina" on the Training tab. _(free)_
- **AC17** — Given a routine, then the Training tab shows "Siguiente: Rutina A — Torso · Empezar" above
  "Empezar entreno", with "Elegir otra sesión" listing the routine's sessions; given today has a gym day
  in the typical week, or the activity has no days, then Today shows the same line. _(free)_
- **AC18** — Given "Empezar" on a routine session, then a live session (spec 009) starts with its
  exercises in order and its number of sets; each set is prefilled with last time's reps and weight for
  that exercise if it was done before, otherwise with the top of the routine's rep range and no weight
  (time exercises: the routine's time). The workout stores the routine session's id and the input method
  `program`. _(free)_
- **AC19** — Given a saved workout from routine session A, then the next session is B; given a free
  session or an activity in between, then the rotation does not move; given the last session, then it
  goes back to A; given the workout from A is deleted, then the rotation follows the last remaining
  workout that had a routine session. `nextProgramSession` lives in `@pt/core`. _(free)_
- **AC20** — Given "Mi rutina → Cambiar de rutina", then the wizard runs again and, after a confirmation,
  the old routine is deleted (tombstone) and past workouts keep their sets; "Borrar rutina" does the same
  without a new one. _(free)_

### Offline, data and privacy

- **AC21** — Given no connection, then "Mi semana" (whose write recomputes targets) shows "Necesitas
  conexión para guardar tu semana" and keeps the edits on screen; the routine can be created, edited and
  started offline (the catalog and the routine are cached) and its write is queued like the workout log
  (spec 009 AC22, same queue scope, so a routine created offline is sent before the workout that uses
  it). _(free)_
- **AC22** — Given a routine write sent twice, then the database has one routine with those session ids;
  given two writes, then the later `recordedAt` wins; given a delete, then a later write with an earlier
  `recordedAt` does not bring it back. Given a session removed from the routine, then workouts that used
  it keep their sets and lose the link. _(free)_
- **AC23** — Given the consent text, then it lists "tu horario de trabajo y de entrenamiento",
  `CONSENT_VERSION` changes to `2026-11-v8`, and existing users are asked again before any health-data
  route works. _(free)_
- **AC24** — Given "Descargar mis datos", then it includes the work pattern, work blocks, day start,
  activity days, experience, equipment and the routine (deleted ones with `deletedAt`); given "Borrar mi
  cuenta", then they are deleted (the schema-driven test covers the new tables). _(free)_
- **AC25** — Given `buildContextSnapshot`, then `context-v4` adds `week` (work pattern, work block per
  weekday, training days per weekday with time and match, day start minute) and `training.experience`,
  `training.equipment` and whether a routine exists; no AI reads it yet. _(free)_

## Data changes

| Table                 | Column                       | Type                                                                | Notes                                                            |
| --------------------- | ---------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| lifestyle_profiles    | work_pattern                 | enum `work_pattern` (fixed, shifts, irregular, none) null           | null until answered                                              |
|                       | day_start_minute             | smallint default 0                                                  | check 0–360 and a multiple of 30                                 |
| work_blocks           | user_id                      | uuid FK profiles cascade                                            | PK (user_id, weekday)                                            |
|                       | weekday                      | smallint                                                            | check 1–7 (ISO, Monday = 1)                                      |
|                       | start_minute / end_minute    | smallint / smallint                                                 | check 0–1439, start ≠ end; end < start = ends the next day       |
| planned_activity_days | id                           | uuid PK                                                             | rewritten with `planned_activities` on every save                |
|                       | activity_id                  | uuid FK planned_activities cascade                                  | unique (activity_id, weekday)                                    |
|                       | user_id                      | uuid FK profiles cascade                                            | index                                                            |
|                       | weekday                      | smallint                                                            | check 1–7                                                        |
|                       | start_minute                 | smallint null                                                       | check 0–1439                                                     |
|                       | is_match                     | boolean default false                                               | only for `kind = 'sport'` (contract)                             |
| training_profiles     | experience                   | enum `training_experience` (beginner, intermediate, advanced) null  | set by the wizard                                                |
|                       | equipment                    | enum `equipment_access` (full_gym, home_dumbbells, bodyweight) null | set by the wizard                                                |
| workout_programs      | id                           | uuid PK (client-generated)                                          |                                                                  |
|                       | user_id                      | uuid FK profiles cascade                                            | unique (user_id) where `deleted_at is null` (one active routine) |
|                       | name                         | text                                                                | ≤ 60                                                             |
|                       | origin                       | enum `program_origin` (template, user)                              | E7 adds `ai`                                                     |
|                       | template_key                 | text null                                                           | e.g. `full-body-ab`                                              |
|                       | recorded_at / deleted_at     | timestamptz / timestamptz null                                      | last write wins; tombstone                                       |
|                       | created_at / updated_at      | timestamptz                                                         |                                                                  |
| program_sessions      | id                           | uuid PK (client-generated, stable across edits)                     | upserted by id; missing ones deleted                             |
|                       | program_id / user_id         | uuid FK workout_programs cascade / uuid FK profiles cascade         |                                                                  |
|                       | position / name              | smallint / text                                                     | name ≤ 40 ("Torso A")                                            |
| program_exercises     | id                           | uuid PK                                                             | replaced with the program on every write                         |
|                       | session_id / user_id         | uuid FK program_sessions cascade / uuid FK profiles cascade         |                                                                  |
|                       | position                     | smallint                                                            |                                                                  |
|                       | exercise_id / exercise_label | uuid FK exercises set null null / text                              | label snapshot as in `workout_sets`                              |
|                       | sets                         | smallint                                                            | check 1–10                                                       |
|                       | reps_min / reps_max          | smallint null / smallint null                                       | check 1–100, min ≤ max; null for time and distance               |
|                       | duration_s                   | integer null                                                        | time exercises                                                   |
|                       | rest_s                       | smallint null                                                       | prefills the rest timer                                          |
| workouts              | program_session_id           | uuid FK program_sessions `on delete set null` null                  | index (user_id, program_session_id)                              |
|                       | input_method                 | + `program`                                                         | enum value added                                                 |

- RLS: every new table readable only where `user_id = auth.uid()`; no write policies (writes go through
  the API).
- One additive migration (enums, columns, tables, checks, indexes; a new enum value on
  `workout_input_method`). Existing rows: `work_pattern` null, `day_start_minute` 0, no days, no routine.
- BLUEPRINT §5 is updated: `routine_blocks` becomes `work_blocks` + `planned_activity_days` (gym slots
  are the days of a strength activity), `training_profiles.days_per_week` and `session_minutes` stay
  derived from the activities, `equipment` is an access level, and the Plans block gains
  `program_exercises` (instead of `planned_sets`, which E5c may add for per-set plans).

## API contracts

- Schemas to add to `@pt/contracts`: `WeekdaySchema` (1–7), `WorkPatternSchema`, `WorkBlockSchema`,
  `ActivityDaySchema` (`{ weekday, startMinute | null, isMatch }`), `WeekRequestSchema` (work pattern,
  blocks, day start, activities with days), `TrainingExperienceSchema`, `EquipmentAccessSchema`,
  `TrainingProfileUpdateSchema` (experience, equipment), `ProgramExerciseSchema`,
  `ProgramSessionSchema`, `ProgramSchema`, `ProgramUpsertRequestSchema` (with `recordedAt`),
  `ProgramResponseSchema` (`{ program: Program | null }`), `PROGRAM_LIMITS` (sessions 1–7, exercises per
  session 1–15, sets 1–10, name lengths).
- Schemas to change: `PlannedActivitySchema` gains `days` (default `[]`; length 0 or equal to
  `sessionsPerWeek`; distinct weekdays; `isMatch` only for sport), `ProfileSchema` gains `week` (pattern,
  blocks, day start) and `trainingExperience`, `equipmentAccess`, `WorkoutInputMethodSchema` (+
  `program`), `WorkoutSchema` / `WorkoutUpsertRequestSchema` (+ `programSessionId`),
  `ContextSnapshotSchema` (`context-v4`, AC25), `ExportResponseSchema`, `CONSENT_VERSION`.
- `PUT /me/week` → 200 `MeResponse` (with new targets when the counts changed) / 400 / 401 / 403
- `PUT /me/training-profile` → 200 `MeResponse` / 400 / 401 / 403 (experience and equipment; focus stays
  in `PUT /me/profile`)
- `GET /me/program` → 200 `ProgramResponse` / 401 / 403
- `PUT /me/program/{id}` → 200 (stored program, or the newer one that won) / 400 / 401 / 403 / 404
  (unknown or someone else's `exerciseId`) / 409 (another active routine exists: the client deletes it
  first, AC20)
- `DELETE /me/program/{id}?recordedAt` → 200 / 400 / 401 / 403
- `PUT /me/workouts/{id}` → also 404 when `programSessionId` is unknown or someone else's.
- Every route needs the current consent (403 `consent_required`).
- `@pt/core` (test-first): `dates`: `localToday(now, dayStartMinute, timeZone)`, `weekStartOf` (reuse
  spec 009), `weekDays`; `week/`: `typicalDay(week, weekday)`, `weekNotices`, `applyDaysToActivity`,
  `blockEndsNextDay`; `training/routine`: the templates, `starterRoutine(input, catalogByKey, newId)`,
  `trimToMinutes`, `nextProgramSession(program, workouts)`, `sessionFromProgram(session, stats, now,
newIds)`, `programToRequest`; `context`: `context-v4`.
- `@pt/api-client`: methods, query options (program cached offline), a `saveProgram` / `deleteProgram`
  mutation in the `training` queue scope, `saveWeek` (online only), the mock routes and a mock routine.

## UI

- Routes: `settings/week` ("Mi semana"), `day/[date]` (day screen), `training/routine` (view and edit),
  `training/routine/new` (wizard). Today gains the Day / Week switch (`TodayWeek` component; the switch
  is a segmented control, remembered in device storage).
- Components: `WeekdayChips`, `TimeField` (15-min steps, native picker on phones and a select on web via
  `.web.tsx`), `WorkRow`, `ActivityDaysRow` (also used in the profile form), `WeekNotices`, `WeekDayRow`
  (meal dots, kcal text, planned and done), `WeekHeader` (‹ › Hoy, week range), `DayScreen` sections,
  `RoutineCard` ("Siguiente: …"), `RoutineSessionEditor`, `WizardStep`.
- States: loading; empty week (no days, no logs: a hint "Indica tus días en Mi semana"); offline week not
  cached (AC10); "Mi semana" offline (AC21); saved with targets notice (AC4); wizard with no strength
  activity (AC13); pregnancy notice (see Safety); routine pending sync; error with retry.
- Mobile-first (360–430 px): seven chips fit one row at 360 px (40 px each, 48 px touch target with
  spacing); a week row fits two lines at 360 px; light and dark.
- i18n (es reference + en): `week.*` (Mi semana, patterns, day start, notices, view, day screen,
  offline), `today.dayWeek`, `routine.*` (wizard questions, templates' session names such as "Torso A",
  editor, next session, change, delete), the updated `consent.points.what`, `profile.week` link.
- E2E (`apps/e2e`, mock backend): fill "Mi semana" (work Monday–Friday 08:00–16:00, gym L-X-V 18:30,
  football Saturday match) and see the targets notice; the week view with a meal and a workout logged,
  move back a week, open a day 10 days ago and add a meal on it; `ed_soft_stop` hides the kcal; create a
  starter routine (3 days, gym, beginner), edit one exercise, start "Rutina A" from Today, save it and see
  "Siguiente: Rutina B"; a routine created offline that syncs before its workout; day start 04:00 with a
  mocked clock at 02:30.

## Safety & edge cases

- **Templates are training advice.** They use the curated catalog only, conservative volumes (beginners
  2–3 sets, no sets to failure mentioned, no 1–3-rep work for anyone), and every number is marked
  provisional for the professional review (`domain-reviewer` before closing).
- **Pregnancy**: the wizard does not build a template; it shows "Antes de empezar una rutina nueva,
  consulta con tu matrona o tu médico" and offers an empty routine built by hand. **`injury`** and
  **`medical_condition`**: the wizard and the routine screen show the quiet line of spec 009 ("Si algo te
  duele, para y consulta a un profesional sanitario"); exercises are not filtered (E7).
- **Ages 16–17 (`teen_limited`)**: the strength focus uses 6–10 reps for compound lifts instead of 4–6,
  and the wizard never offers more than 4 distinct sessions.
- **`ed_soft_stop`**: the routine is never longer or more frequent than the days the user declared; the
  week view shows no kcal (AC9); no "you missed a session" anywhere, the rotation just waits.
- **`high_training_load`** (spec 002): the wizard keeps the existing notice and does not add days.
- **The app never pushes more training**: no notice suggests training more days; the rest-day notice
  (AC5) only ever suggests less.
- **Times and days**: weekdays are computed from the user's local date (with the day start of AC6); a
  work block across midnight belongs to the weekday it starts on; a typical week is shown on every week
  (including past weeks before the user filled it: the past week shows the current typical week, which is
  acceptable until E5b needs history).
- **Changing the day start** moves no stored entry; only new entries use it. Tests cover a meal at 03:59
  and 04:00 with a 04:00 day start, and the DST change nights in Europe/Madrid.
- **Units**: times are minutes after midnight internally and shown as 24 h in es and 12 h in en
  (`Intl`); weights in routines are never stored (the routine has no weights).

## Out of scope

- Planning meals or sessions by hand for dated days, "copy from another day", logging a planned item in
  one tap (E5c). The week view shows the typical week only.
- Per-week work shifts and split shifts (spec 011's check-in asks the day's shift); calendar import.
- Daily check-in, readiness, the sentence shortcut for the week or the session (spec 011); the
  one-sentence typical-week shortcut of the BLUEPRINT feature map (later, if an eval shows it helps).
- Progression suggestions, deloads, periodisation, several routines, routine sharing, AI programs (E5b,
  E7); structured injuries and exercise filtering (E7).
- Calorie cycling by training day (targets stay weekly averages).
- Reminders and notifications for planned sessions (E8).

## Open questions

- For the professional reviewer: the templates (exercises per equipment, sets, rep ranges per focus and
  for 16–17-year-olds), the time model used to trim a session (45 s of work per set plus rest, 5 min of
  warm-up), the day-before-match rule and the rest-day notice, and whether a beginner on 5–6 days should
  be told that 3–4 days are enough.
- From the domain review of 2026-11-20 (not applied, for the professional reviewer):
  - Bodyweight exercises take the focus's rep range (4–6 bodyweight squats with the strength focus;
    10–15 push-ups for a beginner). Should they have their own ranges (e.g. 6–12 upper body, 12–20
    lower body)?
  - Bodyweight or sport performance with 4–7 gym days rotates full-body sessions on consecutive days
    (also beginners on 5–6 days and `teen_limited`; NSCA youth guidance is 2–3 non-consecutive days):
    cap at 2 sets, or say "2–3 días de fuerza bastan"?
  - Beginners and 16–17-year-olds: goblet squat and dumbbell Romanian deadlift instead of the barbell
    lifts, with nobody checking their form?
  - Home dumbbells assume a bench (dumbbell bench and incline press, Bulgarian split squat, skull
    crusher, pullover): use the floor press and benchless options? The pullover is a weak stand-in for
    the lat pulldown (a dumbbell row is another option).
  - A never-done exercise starts at the top of the rep range (AC18); the bottom is more conservative.
  - The "no rest day" notice counts a light walk as training; count only strength, moderate or hard?
  - `ed_soft_stop` and `high_training_load` get the normal volume; cap them at 3 sets?
- Whether a past week should show the typical week as it was then (needs history on the week tables);
  today it shows the current one.

## Progress

- [x] contracts · [x] db · [x] core · [x] api · [x] client · [ ] ui · [ ] e2e
- Decisions taken during implementation:
  - `WeekRequestSchema`, `TrainingProfileUpdateSchema` and the week schemas live in `profile.ts` next
    to `PlannedActivitySchema` (no `week.ts`; its tests are in `week.test.ts`). `EMPTY_WEEK` is the week
    of a profile that never saved "Mi semana".
  - `PlannedActivity.days` and `programSessionId` (gym requests) default to empty / null, so the clients
    of specs 002 and 009 keep working; the contracts commit makes stores and mocks return those neutral
    values until the API step stores them.
  - A routine session may have no exercises (the empty routine of the pregnancy rule).
  - `context-v4` and `CONSENT_VERSION` change in the core and UI steps, so every commit stays green.
  - Core (2026-11-20): `weekStartOf` moved from `training/view` to `dates` (with `isoWeekday`,
    `weekDays`, `localToday`, which compares wall-clock times so DST nights move nothing). `week/typical`
    holds the editing helpers of "Mi semana" (`toggleActivityDay`, `setActivityStartMinute`,
    `setMatchDay`, `toggleWorkDay`, `setWorkHours`, `copyWorkHours`, `weekToRequest`) and
    `sameTrainingLoad` (AC4: the API recomputes targets only when it is false). `week/view` has
    `WEEK_VIEW`, `weekNavigation`, `moveWeek`, `dayAccess`, `weekRows`, `dayMeals`.
  - AC5 notices: a night block also counts on the next day; a match the day before a match does not
    trigger "hard before match"; "no rest day" only uses activities with days (without days it cannot
    know).
  - Templates (`training/routine`): bodyweight and sport performance never get a split (full body
    A/B or A/B/C; bodyweight has too few exercises for upper/lower or push/pull/legs). Beginners 3 sets
    on compound lifts and 2 on the rest; advanced 4 on compound lifts. Rest 180 s (strength compound),
    120 s (compound), 90 s (rest), 60 s (plank). The gym days are the sum of the strength activities
    (max 7) and the minutes the shortest one. Session and routine names come from the caller (i18n).
    The "every key exists" test is `packages/db/src/knowledge/exercises/routine-templates.test.ts`.
  - Domain review (2026-11-20), applied: every bodyweight session keeps the inverted row as its pull;
    no bench dips or close push-ups; beginners get incline push-ups instead of feet-elevated ones.
    With the human: AC15 now trims by 45 s of work (or the exercise's time) plus rest per set and 5 min
    of warm-up, instead of 2.5 min per set (a 45-min strength session came out at about 60 min, against
    `ed_soft_stop`), and beginners with the strength focus get 6–10 on compound lifts. The rest of the
    review is under Open questions.
  - `training/program`: `programReducer` (editor), `canSaveProgram` (needs one exercise, so the empty
    routine of pregnancy is saved once the user adds one), `sessionFromProgram` (last time's sets set by
    set, the last one repeated; the routine's rest when it has one), `nextProgramSession` (newest by
    `localDate`, then `startedAt`; sessions of another routine are ignored).
  - `ContextSources` gains optional `week`, `trainingExperience`, `equipmentAccess`, `hasRoutine`;
    no API route builds a context snapshot yet, so nothing passes them until an AI feature reads it.
  - API (2026-11-20): `PUT /me/week` (`routes/me/week.ts`, `services/week.ts`) recomputes goal, flags
    and targets with `evaluateStoredProfile` only when `sameTrainingLoad` is false; an account from
    before spec 002 (no job) gets 400 `profile: required`. `PUT /me/profile` now stores the activity
    days too (same `replaceActivities`), and keeps the week. `PUT /me/training-profile` answers
    `MeResponse`. Routine routes in `routes/training/program.ts`; core gained `programFromRequest`
    (name snapshots in the locale, keeps only the target its tracking uses; a reps exercise without a
    rep range or a time exercise without a time is 400 `target_mismatch`). New error code
    `program_exists` (409) apart from `id_taken` (409: the routine id or a session id belongs to
    another user or another routine). `ExportResponse` gained `programs` (deleted ones with
    `deletedAt`).
  - `PUT /me/workouts/:id` with a `programSessionId`: another user's session is 404 (as the spec
    says), but a session that no longer exists (removed from the routine before a queued workout
    arrived) stores the workout without the link instead of 404, so the offline queue never gets
    stuck; it is the same result as removing the session afterwards (AC22). Sessions of a deleted
    routine still exist (tombstone), so their workouts keep the link.
  - Client (2026-11-20): the week view reads one cached query per week (`week-log`, the meals and
    workouts of Monday to Sunday), kept offline like the other logs; the food and training
    mutations also patch every cached week (and roll back to the week's version of an old item), so
    a meal added on a day screen 10 days back shows at once. The routine (`training-program`) and
    its writes, and the wizard's answers (`PUT /me/training-profile`, optimistic on `/me`), go
    through the `training` queue, so a routine created offline is sent before its workout and
    "Cambiar de rutina" sends the delete before the new routine. `useSaveWeek` is never queued
    (`networkMode: 'always'`, no retry) and returns the targets before the write;
    `weekTargetsChange` gives the old and new targets for the notice. The mock implements every
    new route (`pt.mock-db.v8`).
- Done so far, one commit per step: contracts (`42b7f0c`); migration `0010_week_routine`
  (additive: 4 enums and the `program` input method, 5 tables with RLS, 5 columns) (`2dba57d`); core
  (week, week view, templates, routine editor and rotation, `context-v4`) (2026-11-20); API (week,
  training profile, routine, workout link, export; the account-deletion integration test covers the
  5 new tables and the routine write rules, and passes on dev)
  (2026-11-20); client (methods, week log and routine queries, queued routine writes, mock routes)
  (2026-11-20).
