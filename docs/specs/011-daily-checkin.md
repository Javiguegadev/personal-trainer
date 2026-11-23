# 011 — Daily check-in and day readiness

- Status: approved (2026-11-23)
- Phase: E5, slice (c). Slices (a) and (b): specs 009 and 010. The typed or spoken sentence shortcut for
  a workout (Claude Haiku 5.5 and its eval, the E5 exit criterion) moves to spec 012.
- Tier: free (no AI in this spec, so there is no cap; BLUEPRINT §10 keeps the free / premium split of
  readiness open until E6, and the beta has no paywall)

## Problem / user story

As a user who trains, I want to tell the app in two taps how I slept and how stressed I am, so that
today's session fits the day I actually have and I see why it changed.

As a user who works shifts or irregular hours, I want to say which shift I have today, so that my day
and my week show my real hours instead of an empty work row.

## Decisions taken with the human (2026-11-23)

- **Spec 011 is the check-in and the readiness only.** The sentence shortcut for workouts is spec 012,
  so the AI eval does not block the check-in and each PR stays small.
- **The check-in asks sleep, stress and, for shift and irregular workers, today's shift.** Energy and
  soreness are not asked (more friction every day for little gain).
- **A low readiness removes sets and says why.** A routine session starts with one set less per exercise
  (never below 2), a "low" day also drops the last exercise, and the reason is shown ("Has dormido poco:
  hoy una serie menos por ejercicio") with "Entrenar normal" to undo it. An activity (football, running)
  gets only a line ("hoy, mejor a ritmo suave"). Nothing ever goes up.

## Assumptions (to confirm in the review)

- **Sleep is chosen from five chips**: "Menos de 5 h", "5–6 h", "6–7 h", "7–8 h", "Más de 8 h". The
  chip's middle value is stored in minutes (270, 330, 390, 450, 510), so a HealthKit import (E10) can
  store exact minutes in the same column. Stress has three chips: "Bajo", "Normal", "Alto".
- **Usual sleep is derived, never asked.** It is the median of the last 14 days' check-ins with sleep,
  once there are at least 5; before that there is no usual value. It prefills the sleep chip (the latest
  check-in's chip when there is no usual value yet; nothing for the very first one). Stress is prefilled
  with "Normal". So a typical morning is one tap: "Guardar".
- **The check-in is shown only when it can change something today** (ADR 003): today has training
  planned (a routine session is due, `routineDueOn`, or an activity has today's weekday) or the user
  works shifts or irregular hours (the shift changes the day's hours). Otherwise Today shows nothing, and
  the check-in stays reachable from the day screen.
- **Skipping is free.** "Hoy no" hides the card until tomorrow (device storage). No reminder, no streak,
  no "you forgot". A missing check-in means "unknown", and an unknown readiness changes nothing.
- **Shifts.** Chips "Mañana", "Tarde", "Noche", "Libre". Each working shift has default hours (06:00–14:00,
  14:00–22:00, 22:00–06:00, provisional) that the user can change with the `TimeField` of spec 010; the
  hours chosen for a shift kind prefill that kind next time. The shift is stored on the check-in of the
  day the shift starts. It does not feed the readiness (sleep already captures a night shift); it fills
  the day's work row and the overlap notice.
- **Readiness is computed on the device** by `@pt/core` from the check-in and the usual sleep, so it works
  offline. The API stores the check-in but never returns a readiness of its own.
- **Readiness levels** (thresholds provisional, for the professional review):
  - `unknown`: no check-in, or neither sleep nor stress answered.
  - `low`: sleep under 5 h; or 5–6 h with high stress.
  - `reduced`: sleep 5–6 h; or high stress; or sleep at least 90 min under the usual sleep.
  - `normal`: anything else.
- **The adjustment is applied when a routine session starts**, live (spec 010 AC18), from Today or from
  the Training tab, on today's date. A past session, a session started from the week view on another
  day and a free session (no routine, nothing to remove) are never adjusted; a free session still shows
  the reason line. The stored workout does not record whether it was adjusted (E5b decides if it needs
  it).
- **The consent text already lists "tus registros de sueño y estrés"** (spec 002) and the work schedule
  (spec 010). The shift is work schedule, so `CONSENT_VERSION` does not change.
- **Editing.** The check-in of today can be changed all day (the readiness line on Today opens it). The
  day screen of spec 010 shows the check-in of any day and lets the user add, change or delete it for
  today and the 27 days before, as with meals and workouts. A change after a session started does not
  touch that session.

## Acceptance criteria

### Check-in

- **AC1** — Given today has training planned or the user works shifts or irregular hours, and no check-in
  exists for today and "Hoy no" was not tapped today, then Today shows a card "¿Qué tal hoy?" with the
  sleep chips, the stress chips and, for shift and irregular workers, the shift chips. Given none of
  these, then no card is shown. _(free)_
- **AC2** — Given the card, then the sleep chip is prefilled with the usual sleep (or the latest
  check-in's chip, or nothing), stress with "Normal", and the shift with yesterday's shift if it was a
  working one, otherwise nothing; "Guardar" stores what is selected, and any field may stay empty. Given
  "Hoy no", then the card disappears until the next local day and nothing is stored. _(free)_
- **AC3** — Given a working shift chip, then its hours show below it ("Noche · 22:00–06:00 · termina al
  día siguiente") with "Cambiar hora"; given "Libre", then no hours. The hours chosen for a shift kind
  prefill that kind in later check-ins. _(free)_
- **AC4** — Given a stored check-in for today, then Today shows one line instead of the card: the
  readiness and its reason ("Has dormido poco: hoy una serie menos por ejercicio", "Todo en orden para
  entrenar") or, with an unknown readiness, only "Check-in de hoy · Cambiar"; tapping it opens the
  check-in to change or delete it. _(free)_
- **AC5** — Given the day screen (spec 010 AC11) of any day, then it shows that day's check-in (sleep,
  stress, shift with its hours) or "Sin check-in"; for today and the 27 days before it offers "Añadir" /
  "Cambiar" / "Borrar"; older days are read-only. Future days offer nothing. _(free)_

### Readiness and the session

- **AC6** — Given a check-in and the usual sleep, then `dayReadiness` in `@pt/core` returns the level of
  the assumptions above and the reasons that fired (`short_sleep`, `very_short_sleep`,
  `below_usual_sleep`, `high_stress`); the same input always gives the same output. Sleep exactly on a
  threshold belongs to the higher chip (5 h is "5–6 h", not "under 5 h"). _(free)_
- **AC7** — Given a `reduced` readiness, when a routine session starts live for today, then
  `adjustSessionForReadiness` removes one set from every exercise with 3 or more sets; given `low`, then
  it does the same and also removes the last exercise when the session has more than 4. Given `normal`
  or `unknown`, then the session is unchanged. Prefilled reps and weights (spec 010 AC18) are kept for
  the sets that remain. _(free)_
- **AC8** — Given an adjusted session, then the live session shows the reason on top ("Has dormido poco:
  hoy una serie menos por ejercicio · Entrenar normal"); "Entrenar normal" restores the removed sets and
  exercise (keeping the sets already completed) and hides the line. The user can always add sets and
  exercises as usual. _(free)_
- **AC9** — Given `reduced` or `low` and today's planned training is an activity (no routine session),
  then the readiness line says "Hoy, mejor a ritmo suave"; given that activity is a match today, then
  it says "Calienta bien antes del partido" instead. Nothing is changed or blocked. _(free)_
- **AC10** — Given a check-in saved after the routine session started, then that session is not changed;
  the next session started today uses the new readiness. _(free)_

### Shift and the day's hours

- **AC11** — Given a check-in with a working shift, then the week view row and the day screen of that day
  show the shift ("Turno de noche 22:00–06:00") where the typical week has no work block; given a fixed
  work pattern, then the shift chips are never asked and the typical week's block is shown as in spec 010. _(free)_
- **AC12** — Given today's shift and a training planned today with a start time that falls inside the
  shift, then Today shows the notice "Tu gimnasio de hoy (18:30) coincide con tu turno" (same wording
  family as spec 010 AC5, from `dayNotices` in `@pt/core`, never blocking). A shift that crosses midnight
  also covers the early hours of the next day. _(free)_

### Patterns over several days

- **AC13** — Given sleep under 6 h on at least 4 of the last 7 days, or high stress on at least 5 of the
  last 7, then the readiness line adds once a day a quiet notice: "Llevas varios días durmiendo poco.
  Si sigue así, hablarlo con un profesional sanitario puede ayudar" (or the stress variant). It never
  names a condition and never changes targets. Thresholds are provisional. _(free)_

### Offline, data and privacy

- **AC14** — Given no connection, then the check-in can be saved, changed and deleted, the readiness and
  the adjustment work, and the write is queued (spec 005 queue, its own `checkin` scope) and sent once
  when the connection returns. _(free)_
- **AC15** — Given the same check-in sent twice, then the database has one row for that user and local
  date; given two writes, then the later `recordedAt` wins; given a delete, then a later write with an
  earlier `recordedAt` does not bring it back. Given a `localDate` in the future or more than 1 year
  back, then 400; given a `recordedAt` more than 1 day ahead of the server, then 400. _(free)_
- **AC16** — Given "Descargar mis datos", then it includes every check-in (deleted ones with
  `deletedAt`); given "Borrar mi cuenta", then they are deleted (the schema-driven test covers the new
  table). _(free)_
- **AC17** — Given `buildContextSnapshot`, then `context-v5` adds `today.checkin` (sleep minutes, stress,
  shift with hours), `today.readiness` (level and reasons) and `sleep.usualMinutes`; no AI reads it yet.
  _(free)_

## Data changes

| Table          | Column                                | Type                                                    | Notes                                                   |
| -------------- | ------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| daily_checkins | user_id                               | uuid FK profiles cascade                                | PK (user_id, local_date)                                |
|                | local_date                            | date                                                    | the user's day (day start of spec 010 AC6)              |
|                | sleep_minutes                         | smallint null                                           | check 0–960                                             |
|                | stress                                | enum `stress_level` (low, normal, high) null            |                                                         |
|                | work_shift                            | enum `work_shift` (morning, afternoon, night, off) null |                                                         |
|                | shift_start_minute / shift_end_minute | smallint null / smallint null                           | check 0–1439, start ≠ end; both set iff a working shift |
|                | source                                | enum `checkin_source` (manual, health_import)           | only `manual` in this spec (BLUEPRINT §5)               |
|                | recorded_at / deleted_at              | timestamptz / timestamptz null                          | last write wins; tombstone                              |
|                | created_at / updated_at               | timestamptz                                             |                                                         |

- RLS: readable only where `user_id = auth.uid()`; no write policies (writes go through the API).
- One additive migration (three enums, one table, checks, RLS). No backfill.
- The shift hours preferred per kind live on the device (they only prefill a chip), not in the database.

## API contracts

- Schemas to add to `@pt/contracts`: `StressLevelSchema`, `WorkShiftSchema`, `CheckinSourceSchema`,
  `DailyCheckinSchema`, `CheckinUpsertRequestSchema` (sleep, stress, shift and hours, `recordedAt`;
  the hours are required for a working shift and forbidden for `off` or no shift),
  `CheckinListResponseSchema`, `ReadinessLevelSchema`, `ReadinessReasonSchema`, `ReadinessSchema`,
  `CHECKIN_LIMITS` (sleep 0–960, range query at most 92 days).
- Schemas to change: `ContextSnapshotSchema` (`context-v5`, AC17), `ExportResponseSchema` (+ `checkins`).
- `PUT /me/checkins/{localDate}` → 200 (stored check-in, or the newer one that won) / 400 / 401 / 403
- `DELETE /me/checkins/{localDate}?recordedAt` → 200 / 400 / 401 / 403
- `GET /me/checkins?from&to` → 200 `CheckinListResponse` (without tombstones) / 400 (range over 92 days
  or `from` after `to`) / 401 / 403
- Every route needs the current consent (403 `consent_required`).
- `@pt/core` (test-first): `checkin/`: `SLEEP_CHIPS`, `sleepChipOf(minutes)`, `usualSleep(checkins,
today)`, `checkinPrefill(checkins, today)`, `checkinDue(input)`, `SHIFT_DEFAULT_HOURS`,
  `dayReadiness(checkin, usualSleep)`, `adjustSessionForReadiness(session, readiness)` and its undo,
  `readinessLine(readiness, todayPlan)` (reason keys, not copy), `sleepStressNotice(checkins, today)`;
  `week/`: `dayWorkBlock(week, checkin, date)` (the shift overrides an empty typical block),
  `dayNotices(...)` (AC12); `context`: `context-v5`.
- `@pt/api-client`: methods, a check-in query per range (cached offline; the last 28 days are read at
  start for the usual sleep and the patterns), `saveCheckin` / `deleteCheckin` in the `checkin` queue
  scope (optimistic, also patching the cached week log rows), mock routes.

## UI

- Today: `CheckinCard` (AC1–AC3) above "Entreno de hoy"; once saved, `ReadinessLine` (AC4, AC9, AC13)
  in its place, and `DayNotices` (AC12).
- Route `checkin/[date]`: the same chips as the card, plus "Borrar" when a check-in exists (sheet on
  phones, page on web).
- Live session: `ReadinessBanner` with "Entrenar normal" (AC8).
- Day screen: a "Cómo estaba" section (AC5). Week view: the shift in the work slot (AC11).
- Components: `SleepChips`, `StressChips`, `ShiftChips` (with `TimeField` of spec 010), `CheckinCard`,
  `ReadinessLine`, `ReadinessBanner`.
- States: card due; card hidden ("Hoy no", nothing planned); saved with each readiness level; queued
  offline; error with retry; a check-in from another device arriving after the session started (AC10).
- Mobile-first (360–430 px): five sleep chips fit one row at 360 px (or wrap to two rows without
  horizontal scroll); 48 px touch targets; light and dark.
- i18n (es reference + en): `checkin.*` (title, chips, shift hours, skip, save, delete, "Sin check-in"),
  `readiness.*` (levels, reasons, activity and match lines, banner, "Entrenar normal", pattern notices),
  `week.dayNotices.*`.
- E2E (`apps/e2e`, mock backend, clock fixed): a gym day with a routine, the card prefilled, "5–6 h" and
  "Alto" → `low` → "Rutina A" starts with one set less and without its last exercise, "Entrenar normal"
  restores them; "Hoy no" hides the card until the next day; a rest day with a fixed schedule shows no
  card; a shift worker picks "Noche" and the week view shows "Turno de noche 22:00–06:00" and the
  overlap notice; a check-in saved offline syncs once; a check-in added on a day 10 days back from the
  day screen.

## Safety & edge cases

- **Wellness, not diagnosis** (BLUEPRINT §8). No word names a condition (insomnia, anxiety, burnout);
  the pattern notice (AC13) points to a health professional and nothing more.
- **Never more.** Poor sleep or high stress only ever removes volume; a good night never adds sets,
  exercises or days, and the readiness never touches calorie targets or the deficit.
- **`ed_soft_stop`**: the check-in and readiness work as for everyone; no copy links sleep or stress to
  food or weight. **Pregnancy**: same rules (the adjustment only lowers volume); the Training tab notice of
  spec 009 stays. **Ages 16–17**: same rules. **`injury` / `medical_condition`**: the quiet line of spec 009
  stays; the readiness does not judge pain.
- **A match is never "skipped" by the app**: on a match day the readiness line never suggests not
  playing (AC9).
- **Minimum session.** The adjustment never leaves an exercise under 2 sets (an exercise with 1 or 2 sets
  keeps them) or a session under 4 exercises (a session with 4 or fewer keeps them all).
- **Dates.** The check-in belongs to the user's local day with the day start of spec 010 (a night worker
  checking in at 02:00 with a 04:00 day start writes the previous day). A shift crossing midnight is
  stored on the day it starts. DST nights: tests cover a check-in at 02:30 on both change nights in
  Europe/Madrid.
- **Units.** Sleep in minutes internally; shown in hours (`Intl`). Times 24 h in es, 12 h in en.
- **Two devices.** The later `recordedAt` wins; a session already started on one device keeps its
  adjustment.

## Out of scope

- The typed or spoken sentence shortcut for workouts and its eval (spec 012).
- Energy, soreness, mood, menstrual cycle, resting heart rate, HRV. Apple Health / Health Connect import
  (E9, ADR 007: imported sleep will prefill this check-in; here the `health_import` source is only
  reserved) and watch APIs such as Garmin (E10).
- Readiness changing weights, reps, rest times or calorie targets; deloads and progression (E5b, E7).
- Using sleep and stress in the weekly review (E5b) or in AI prompts (E7); weekly insights on sleep (E8).
- Reminders or notifications to check in; streaks and points for checking in (E8; ADR 003: skipping
  never breaks a streak).
- Per-week shift calendars, shift import, split shifts.
- Recording on the workout whether it was adjusted.

## Open questions

- For the professional reviewer: the sleep chips and their stored values, the readiness thresholds
  (under 5 h, 5–6 h, 90 min under the usual, high stress, and their combination for `low`), the
  adjustment (one set less from 3 sets, the last exercise on `low`, minimums of 2 sets and 4 exercises),
  the activity and match lines, the pattern thresholds (4 of 7 nights under 6 h, 5 of 7 days of high
  stress) and their wording, and the default shift hours.
- Whether a night shift should lower the readiness of the next day on its own when sleep is not
  answered.

## Progress

- [x] contracts (7436bfb) · [x] db (688160d, migration `0011` applied on dev 2026-11-23) · [x] core
      (b5f6c2b, review fixes 7383475) · [x] api (5746775) · [ ] client · [ ] ui · [ ] e2e
- Decisions taken during implementation (plan approved by the human on 2026-11-23):
  - **a) Pattern notice (AC13)** shows under the readiness line with "Entendido", which hides it until
    the next local day (device storage).
  - **b) Days without a routine to cut.** On a day without training, `reduced` / `low` show only the
    reason ("Has dormido poco"), and `normal` shows "Check-in de hoy · Cambiar" (no "Todo en orden para
    entrenar" on a rest day). A free or repeated session shows the reason without "Entrenar normal".
    "Todo en orden para entrenar" also needs a sleep answer: stress alone does not clear the day
    (domain review).
  - **c) One reason per line**, by priority: under 5 h > 5–6 h with high stress (own copy) > 5–6 h >
    90 min under the usual > high stress (`readinessHeadline`).
  - **d) The adjustment lives on the `LiveSession`** in device storage (`readiness`: what was removed,
    to put back), so "Entrenar normal" survives a restart; nothing reaches the API. It is applied once:
    a session already evaluated (`readiness` present, `null` on a normal day) or with a completed set
    is never cut (AC10).
  - `DELETE /me/checkins/{localDate}` also takes `today` (as the weight log), to check the day (AC15).
    A delete with no row stores a tombstone, so an older write arriving later cannot create it.
  - Usual sleep uses the 14 days **before** today (today's night never compares with itself).
  - The shift overlap notice (AC12) fires when the planned session **overlaps** the shift, not only
    when it starts inside (same rule as spec 010 AC5).
  - Known limit: the shift timeline uses calendar midnight; a shift that starts between 00:00 and a
    later day start (e.g. 03:00 with a 04:00 day start) gets its overlap notice on the wrong day. Rare;
    left as is.
  - Sleep 0 is a valid answer and gives `low`. A future health import (E9) must store `null`, not 0,
    when there is no data.
  - The account deletion integration test now takes about 30 s on the dev pooler; its timeout went
    from 30 s to 60 s.
