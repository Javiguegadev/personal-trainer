# 012 — Workout sentence shortcut

- Status: approved (2026-11-24)
- Phase: E5, last piece (after specs 009, 010 and 011). Its eval is the E5 exit criterion: "free-text
  sessions parse correctly in ≥ 95 % of eval cases" (BLUEPRINT §7).
- Tier: free with an abuse cap per day (BLUEPRINT §3: workout logging is free; plans and `canUse()`
  arrive in E5b / E6).

## Problem / user story

As a user who trained without logging live, I want to describe the session in one sentence ("ayer:
press banca 4x8 con 60, remo con barra 3x10 con 50 y 20 minutos de cinta") and get the session filled
in, ready to fix with taps, so that logging a past session takes seconds instead of one tap per set.

As a user who plays a sport, I want to say "pádel hora y media, bastante duro" and get the activity
ready to save.

## Assumptions (to confirm in the review)

- **The draft is the product, not the AI answer** (ADR 004). A gym session opens in the session editor
  of spec 009 (the `draft` slot, as "Registrar entreno pasado", AC17) with its exercises and sets
  filled in; an activity opens the activity sheet of spec 009 AC16 filled in. Nothing is saved until
  the user taps "Guardar".
- **The AI chooses, the code computes.** Claude Haiku 5.5 reads the sentence and returns exercise refs
  from our catalog with set groups ("4 × 8 · 60 kg"), or an activity type with minutes. `@pt/core`
  rejects any ref it did not hand out, checks every value against the exercise's tracking and the
  limits of spec 009, and builds the sets.
- **The catalog goes in the prompt, not through a search tool.** The exercise catalog is small (192
  exercises, spec 009), so the system prompt carries all of it (short refs, Spanish and English names
  and synonyms, tracking), cached across users; the user's own exercises (names and tracking only) go
  in the user message. One model call, no tool loop: the model sees every option, so "jalón" or "hip
  thrust" need no search round (spec 007 needed one for about 2 000 foods).
- **One workout per sentence.** A sentence gives one gym session or one activity. Another activity
  said in the same sentence ("…y por la tarde pádel") shows as a line with "Registrar", which opens
  its activity sheet filled in; the rest is ignored with a notice.
- **The day and the time come from the sentence when said.** "Ayer", "el lunes", "anteayer" set the
  day (today and the 6 days before, the UI limit of spec 009); a clock time ("a las 7 de la tarde")
  sets the start. Otherwise the day the screen was opened on and the default start of a past session
  (an hour ago today, spec 009 UI decisions). Both stay editable.
- **A routine session can be recognized.** When the draft holds at least half of the exercises of a
  session of the user's routine (spec 010), the editor offers "Cuenta como Rutina A — Pierna", on by
  default, so the rotation moves as if the session had been started from the routine (spec 010 AC19).
  The match is a pure function of `@pt/core`, not the model.
- **Spoken sentences use the keyboard's dictation** (as in spec 007): no microphone button and no
  speech module (E5b, ADR 004). The input method is `text` either way: the app cannot tell typed from
  dictated.
- **No history in the prompt.** The prompt holds the sentence, the locale, today's date and weekday,
  the catalog and the names of the user's own exercises; no profile, no targets, no past sessions.
  Last time's values only fill gaps on the device, after the answer (spec 009 AC7 prefill).
- **Cap:** 20 sentences per user and UTC day (abuse guard, not a plan limit), its own counter apart
  from the meal shortcuts of spec 007.
- **Consent changes.** The text of spec 007 names meal descriptions only; workout descriptions and the
  names of the user's own exercises also reach Anthropic. `CONSENT_VERSION` changes to `2026-11-v9`
  and consent is asked again (spec 002 flow).

## Acceptance criteria

### Entry points

- **AC1** — Given the Training tab, then "Describir entreno" sits next to "Registrar actividad"; given
  the day screen's "Registrar entreno" (spec 010), then "Describir" joins "Sesión de gimnasio" and
  "Actividad" and the draft goes to that day unless the sentence names another. Given no connection,
  then both are disabled with "Necesitas conexión para esto" and everything else keeps working. Given
  a session in progress, then "Describir entreno" stays available (it fills the `draft` slot, never
  the live session). _(free)_
- **AC2** — Given "Describir entreno", then a multiline field (3–500 characters) opens with an example
  as its placeholder, a hint that the keyboard's microphone works, and "Preparar borrador". The text
  keeps its content if the user goes back. Given the `draft` slot already holds an unsaved session,
  then "Preparar borrador" first asks to discard it (the same question as "Registrar entreno pasado").
  _(free)_

### The reading (API and `@pt/core`)

- **AC3** — Given a sentence of a gym session, then `POST /me/workouts/drafts/text` returns a draft
  with one exercise per exercise said, in the order said, at most 30, each with the catalog or own
  exercise, the words it came from ("press banca 4x8 con 60") and its sets, at most 20. Every notation
  is read: "4x8 con 60", "4 series de 8 a 60 kilos", "3x10x40", "8, 8, 7 y 6 con 60", pyramids
  ("8 con 60, 6 con 65 y 4 con 70"), "dominadas 3x6 con 10 kg de lastre", "plancha 3 x 45 segundos",
  "remo 2000 m en 8:30", weights in pounds (converted to kg in `core`). A value that is not said is
  null, never invented. _(free)_
- **AC4** — Given a sentence that says the duration ("una hora", "45 minutos"), the effort as a number
  ("RPE 8", "un 8 sobre 10"), the day ("ayer", "el martes") or a start time, then the draft holds them;
  otherwise they are null. A day outside today and the 6 days before is dropped (the draft keeps the
  screen's day) and the day chip is marked "Revisa el día". Words about effort without a number ("muy
  duro") leave the RPE empty. _(free)_
- **AC5** — Given a sentence of an activity ("pádel hora y media", "partido de fútbol", "corrí 5 km en
  28 minutos", "clase de spinning de 45"), then the draft is an activity with its type (the chips of
  spec 009 AC16), minutes (5–600, null when not said) and RPE when said as a number. Distance and pace
  of an activity are not stored (spec 009 has no column) and the draft says so when they were said. A
  treadmill, a stationary bike or a rowing machine said inside a gym session are exercises of the
  catalog, not activities. _(free)_
- **AC6** — Given a sentence with a gym session and an activity, or two activities, then the draft is
  the first gym session (else the first activity) and each other activity, at most 2, comes as a line
  "También: Pádel · 60 min" with "Registrar" (AC10). _(free)_
- **AC7** — Given an exercise the catalog and the user's own exercises lack ("press Larsen"), then the
  draft keeps it as "No lo encuentro: press Larsen" with its sets, and the editor offers "Buscar"
  (picker with those words) and "Crear ejercicio" (spec 009 custom exercise with the words as its
  name). The exercise chosen receives the sets said for it, checked against its tracking (AC8). An
  unresolved mention is never saved. _(free)_
- **AC8** — Given `workoutDraft` (`@pt/core`, test-first) and the model's reading, then a ref the API
  did not hand out in that request becomes an unresolved mention (AC7); a value the exercise's
  tracking does not use is dropped (weight on a time exercise), except extra weight on a reps-only
  exercise (lastre); a value outside `WORKOUT_LIMITS` is clamped and marked "Revisa"; set groups are
  expanded into sets (a group of 4 × 8 is 4 sets) and cut at 20 per exercise; pounds become kg with 2
  decimals. Two mentions of the same exercise stay two exercises (the user may have done it twice).
  _(free)_
- **AC9** — Given a sentence with no workout ("hola", "¿qué entreno hoy?", "he comido lentejas"),
  then the answer is `unreadable` with `not_workout` and the field stays as typed; given words that
  look like a workout but cannot be read ("lo de siempre", "pierna"), then `unclear`, with a hint to
  name the exercises or use "Repetir". _(free)_

### The draft on screen

- **AC10** — Given a draft of a gym session, then the session editor opens with the draft's day and
  start time, a banner "Borrador de tu frase: revisa y guarda", the exercises in order and their sets.
  A set with every value its tracking needs is **completed**; a set missing a value ("press banca 4
  series", "sentadilla 3x10" without weight) is **left uncompleted**, its known values filled and the
  missing ones prefilled from last time as placeholders (spec 009 AC7), and marked "Completa esta
  serie". Given a draft of an activity, then the activity sheet opens with its type, day, minutes and
  RPE. "Registrar" on an extra activity (AC6) opens its sheet the same way and returns to the editor.
  _(free)_
- **AC11** — Given a completed draft set whose weight is more than 50 % above that exercise's heaviest
  weight (spec 009 typing check), then it is left uncompleted instead, so ✓ asks "¿Seguro?" as when
  typed. Given a draft set that beats a personal best, then it shows the "Récord" badge as any set
  (spec 009 AC10). _(free)_
- **AC12** — Given the editor with a draft, then every action of spec 009 works (edit, add and remove
  sets, add, remove and reorder exercises), plus "Cambiar ejercicio" on an exercise (picker in replace
  mode): the sets move to the exercise picked, keeping the values its tracking uses; sets left without
  a needed value go back to uncompleted. "Cambiar ejercicio" is available in every past or edited
  session, not only in drafts. _(free)_
- **AC13** — Given a routine (spec 010) and a draft holding at least half of the exercises of one of
  its sessions, then the editor shows "Cuenta como Rutina A — Pierna", on by default; given several
  sessions qualify, then the one with most exercises in common, and on a tie the next in the rotation.
  Saving with it on stores that routine session's id, so the rotation moves (spec 010 AC19); off, the
  workout is free. `matchRoutineSession` lives in `@pt/core`. _(free)_
- **AC14** — Given "Guardar" (the finish sheet of spec 009 AC12, with the duration and RPE of the
  draft when said), then the workout is saved with `PUT /me/workouts/{id}` and `inputMethod` `text`,
  only the completed sets are stored, the Training tab and Today show it, and offline it waits in the
  queue like any workout (spec 009 AC22). An activity is saved the same way with `inputMethod` `text`.
  _(free)_
- **AC15** — Given a sentence that mentions pain or an injury ("me dolía el hombro"), then the draft
  shows the fixed line "Si algo te duele, para y consulta a un profesional sanitario" (the copy of spec
  009). The model only flags it (`painMentioned`); it writes no text the user reads. _(free)_

### Failures and limits

- **AC16** — Given a refusal, an invalid output, a time-out of 20 s or an error from the model, then
  the API returns 503 `ai_unavailable`, the screen keeps the sentence and offers "Registrar entreno
  pasado" and "Registrar actividad"; nothing is half-saved. _(free)_
- **AC17** — Given the 20th sentence of the UTC day by a user, then the next one returns 429
  `ai_cap_reached` and the screen points to the same two buttons. Every call writes one `ai_usage` row
  (feature `workout_text`, model, tokens, cost, latency, status), and the counter only counts its own
  feature. _(free)_

### AI quality (eval)

- **AC18** — Given the eval (`apps/api/evals/workout-text/`, at least 120 sentences in Spanish and 15
  in English, written as people type or dictate them: every notation of AC3, slang and typos
  ("jalón", "hip thrust", "press militar", "sentadila"), pounds, lastre, time and distance exercises,
  cardio machines inside a session, activities with and without minutes, day words and times,
  duration and RPE, a gym session plus an activity, exercises the catalog lacks, pain mentions, and
  sentences without a workout), then **at least 95 % of the sentences parse correctly** (the E5 exit
  criterion) and no sentence without a workout gives a draft. A sentence parses correctly when the
  draft has the expected exercises in order (each matched to one of its accepted keys, or left
  unresolved when none is expected) and nothing else, every set has the expected values (reps and
  seconds exact, weight within 0.1 kg, distance within 1 m, null when not said), and the duration,
  RPE, day, start time, activity type and `painMentioned` are the expected ones. The report gives the
  exercise match rate, the set value accuracy, the failures by kind, the cost per call and the median
  and 90th percentile latency. _(free)_
- **AC19** — Given the eval, then it runs before the feature ships and on every change of the prompt,
  the model, its settings or the exercise catalog. _(free)_

### Data and privacy

- **AC20** — Given a sentence, then it lives only in the memory of the request: it is not stored or
  logged, nor in `ai_usage`; only the saved workout keeps its exercise labels. Text in the sentence is
  data: the output can only be the fields of the schema, which `core` validates, and the mention is
  shown as typed, never followed. _(free)_
- **AC21** — Given the consent text, then it says that workout descriptions and the names of the
  user's own exercises are read by an AI provider (Anthropic), are not stored and travel without the
  user's profile; `CONSENT_VERSION` changes to `2026-11-v9` and consent is asked again. _(free)_
- **AC22** — Given "Descargar mis datos" or "Borrar mi cuenta", then nothing changes: the shortcut
  stores only ordinary workouts, already covered by spec 009 AC25. _(free)_

## Data changes

| Table    | Column       | Type                                     | Notes                     |
| -------- | ------------ | ---------------------------------------- | ------------------------- |
| workouts | input_method | enum `workout_input_method` gains `text` | how the workout was added |

- RLS: unchanged (`workouts` and `workout_sets` readable only where `user_id = auth.uid()`; writes
  through the API).
- `ai_usage` gets the feature `workout_text` (a text column, no migration).
- Migration `0012`: one `ALTER TYPE workout_input_method ADD VALUE 'text'`. The `voice` value that
  spec 009 reserved is dropped: the app cannot tell dictation from typing.

## API contracts

- Schemas to add to `@pt/contracts` (`workout-draft.ts`):
  - `WorkoutTextDraftRequestSchema`: `text` 3–500, `locale`, `today` (the user's local date, ±1 day of
    server UTC as every write), `localDate` (the day the screen is on).
  - `WorkoutReadingSchema` (AI output): `status: ok` with `gym` (null or `{ exercises[] of { mention,
exerciseRef | null, setGroups[] of { count, reps, weight, weightUnit: kg | lb, durationS,
distanceM } }, minutes, sessionRpe }`), `activities[]` (at most 3, `{ mention, activity, minutes,
sessionRpe, distanceSaid }`), `daysAgo` (null or 0–30), `startTime` (`HH:MM` or null),
    `painMentioned`; or `status: unreadable` with `reason` (`not_workout`, `unclear`).
  - `WorkoutDraftSchema`: `localDate`, `startedAt | null`, `dayChecked` (false when AC4 dropped a
    day), `minutes`, `sessionRpe`, `exercises[]` of `{ exercise: ExerciseSchema, mention, sets[] of
{ values: SetValues (nulls allowed), clamped } }`, `unresolved[]` of `{ mention, sets }`,
    `activity` (null or `{ activity, minutes, sessionRpe, distanceDropped }`), `extraActivities[]`,
    `painMentioned`, `ignored` (count of what AC6 left out).
  - `WorkoutDraftResponseSchema`: `ok` with `draft`, or `unreadable` with a reason.
  - `WORKOUT_DRAFT_LIMITS` (text 3–500, 30 exercises, 2 extra activities, 20 sentences per day, 20 s
    time-out).
- Schemas to change: `WorkoutInputMethodSchema` (+ `text`; the gym and activity requests accept it),
  `CONSENT_VERSION`.
- `POST /me/workouts/drafts/text` → 200 / 400 / 401 / 403 / 429 / 503. Needs the current consent. It
  does not write the log: saving is spec 009's `PUT /me/workouts/{id}`.
- `@pt/core` (test-first), `training/draft.ts`: `workoutDraft(reading, refs, today, localDate)` (AC3–AC9),
  `draftToSession(draft, stats, ids, now)` (AC10, AC11: completed or uncompleted sets, placeholders,
  weight jump), `matchRoutineSession(exerciseIds, routine, nextSessionId)` (AC13); the session reducer
  gains `replaceExercise` (AC12) and `resolveMention` (AC7), and `LiveSession` gains optional
  `unresolved`, `extraActivities`, `painMentioned` and `inputMethod` `text`.
- `@pt/ai`: `FEATURES.workout_text` (Haiku 5.5, effort `low`, no tools, provisional until the eval
  runs), the prompt in `prompts/workout/`, the catalog block built from the exercise catalog (short
  refs such as `e12`, names and synonyms in es and en, tracking) and cached with the system prompt; the
  user's own exercises (`u1`…, at most 200) go in the user message.
- `apps/api`: a workout-draft service that builds the refs, calls the model, maps refs back to ids,
  applies `workoutDraft`, meters and caps.
- `@pt/api-client`: `draftWorkoutFromText` (no offline queue: it needs a connection), and the mock
  backend with simple rules (split at commas and "y", "N x R con W") for a few sentences, one activity,
  one unresolved exercise, one sentence without a workout and the cap.

## UI

- Route `training/describe` (modal: the field, preparing, unreadable, errors). The draft itself is the
  session editor (`training/session?slot=draft`) or the activity sheet (`training/activity`, which
  gains `type`, `minutes`, `rpe` and `date` params).
- Components: `DescribeWorkoutButton`, `WorkoutTextInput`, `DraftBanner` (with the pain line of AC15
  and the extra activities of AC6), `UnresolvedExerciseRow` ("Buscar", "Crear ejercicio", the sets
  said), `RoutineLinkChip` (AC13); `SetRow` gains the marks "Completa esta serie" and "Revisa";
  `ExerciseCard` gains "Cambiar ejercicio".
- States: offline (AC1), typing, preparing (the sentence visible, "Cancelar"), draft, unresolved
  exercises, unreadable (AC9), AI unavailable (AC16), cap reached (AC17), saving, saved, pending sync.
- Mobile-first (360–430 px), light and dark, touch targets of 44 px (48 px for ✓ and the steppers as
  in spec 009), the keyboard never covers "Preparar borrador".
- i18n (es reference + en): `training.describe.*`, `training.draft.*`, the reasons of AC9,
  `training.changeExercise`, `consent.points.*`.
- E2E (`apps/e2e`, mock backend): a sentence → editor with completed and uncompleted sets → complete
  one, change an exercise, resolve an unresolved one by creating it → save → Training tab and Today;
  a sentence that matches a routine session saved with the chip on moves "Siguiente"; an activity
  sentence → sheet filled in → save; a gym session with an extra activity registered from its line; a
  sentence without a workout; the cap message; offline disables the shortcut, and a draft saved offline
  syncs once.

## Safety & edge cases

- **Typing mistakes become dictation mistakes.** "Sesenta" heard as "seiscientos": the limits clamp
  (500 kg) and mark "Revisa", and the 50 % jump check (AC11) leaves the set uncompleted. A wrong value
  never becomes a record without a tap.
- **No advice and no judgement.** The output has no free text the user reads; the only fixed lines are
  the banner, the marks and the pain line. The app never comments on the volume or the effort.
- **Pain and injuries** (AC15): a fixed line, no diagnosis, no change to the session. The profile's
  injury line of spec 009 keeps showing.
- **`ed_soft_stop`.** The shortcut stays (it puts no numbers the user did not say on screen); records
  and volume for reps-only and time exercises stay hidden as in spec 009. To confirm with the
  professional reviewer.
- **Minors (16–17) and pregnancy:** no change; this spec adds no targets and no advice.
- **Dumbbells and per-side weights** are stored as said ("mancuernas de 20" is 20 kg), the same as
  typing; the app does not double them.
- **Units.** Weights in kg internally, pounds converted in `core` (round trip as spec 009); distances
  in metres ("2 km" is 2000 m); times in seconds ("1:30" is 90 s).
- **Dates.** `daysAgo` is resolved by `core` against `today` with the day start of spec 010; future
  days and days beyond the 6 before are dropped (AC4). A session that crossed midnight stays on its
  start day.
- **Prompt injection.** "Ignora las instrucciones…" can only produce schema fields; unknown refs become
  unresolved mentions (AC8) shown as typed.
- **Calories burned:** none, as in spec 009; a sentence never changes the targets.

## Out of scope

- A sentence inside a live session (adding sets by voice while training).
- A microphone button and on-device speech recognition (E5b, ADR 004).
- Several gym sessions or days from one sentence; "lo mismo que el lunes" ("Repetir" of spec 009
  covers it).
- The typical week or a routine from a sentence (BLUEPRINT feature map: optional, later if an eval
  shows it helps); the check-in from a sentence ("dormí 6 horas").
- Distance and pace of outdoor activities; supersets, drop sets, RIR, per-set RPE, warm-up sets (spec
  009 out of scope).
- Storing sentences, learning from the user's corrections, the user's history in the prompt.
- Calories burned, plan-based caps and `canUse()` (E5b / E6).

## Open questions

- **For the human:** the go-ahead to run the eval (about 0.1 USD for 135 sentences, Haiku 5.5) and a
  review of a sample of its cases, written by an agent that sees only the catalog.
- **If the eval misses 95 %:** first the failures by kind; then effort `medium`, or a `search_exercises`
  tool for the matching only. Decide with the report, not before.
- **For the professional reviewer:** the pain line (AC15) and whether a pain mention should also skip
  the "Récord" badges of that session; the 50 % jump check on drafts (AC11); the "half of the
  exercises" threshold of the routine match (AC13); keeping the shortcut with `ed_soft_stop`.
- Whether to record how much the user changed each draft (as spec 007): needs a column and a line in
  the consent text; not in this spec.

## Progress

- [x] contracts (56c5096) · [x] db (cb9a583, `0012` applied on dev) · [x] core (6b45e96, helpers
      a821b49) · [x] ai (248a09a) · [x] api (4792e49) · [x] client (559fdea) · [x] ui (40c7214,
      de1054b; checked on web at 390 and 1280 px, light and dark) · [x] e2e (5e68d7d, 6 journeys,
      full suite 52/52 green) · [x] eval (44a4e61)
- Eval run on 2026-11-24 (Haiku 5.5, effort `low`): **PASS**, 174 of 178 sentences parse correctly
  (97.8 %; 161 es + 17 en, written by an agent that saw only the catalog); 0 of 16 sentences without a
  workout gave a draft; exercise match 273/276 (98.9 %); set values 898/903 (99.4 %); 0.0015 USD per
  call at most (cache reads counted at the input price); latency median 1.6 s, p90 2.0 s. The four
  failures:
  - es-085, es-092: a cardio machine said first ("bici estatica 15 km en 30 minutos y…", "cinta
    inclinada 30 minutos, …") is missing from the draft, with no notice.
  - es-119: "hace dos semanas" gives no day, so the draft goes to the screen's day without "Revisa el
    día" (AC4).
  - en-013: "chin ups 3x8 with 25 lbs added" is read as weighted pull-ups (`dominadas-lastradas`); the
    values are right.
- Decisions taken during implementation:
  - `WorkoutReadingSchema` is flat (`status`: `ok` | `not_workout` | `unclear`), like the meal reading,
    and carries no number bounds: `core` clamps and marks instead of failing the call.
  - The draft gives `startTime` (`HH:MM`), not `startedAt`: the API has no time zone, so the device builds
    `startedAt`. `dayChecked` is named `dayDropped` (true when the day said was dropped).
  - Unresolved mentions keep a `position` (resolved exercises said before them) and go back to that place
    when resolved; mentions said after it move one place down.
  - A clamped set is left uncompleted (mark "Revisa"), like a weight jump, so a wrong value never saves
    without a tap. Minutes and RPE out of range become null (no mark).
  - `LiveSession.textDraft` groups what the editor shows besides the exercises (unresolved, extra
    activities, pain, ignored, day mark, matched routine session); `LiveSet.mark` is `incomplete` or
    `review`, cleared when the set is completed.
  - With the routine chip on, the workout keeps `inputMethod` `text` and stores `programSessionId`.
  - `voice` never reached the database, so `0012` only adds `text`.
  - The catalog refs follow the store order (most popular first); the user's own exercises are all sent
    (a user has at most 200), in the store order.
  - UI decisions approved on 2026-11-24: (a) the AC2 question did not exist for "Registrar entreno
    pasado"; it now guards all three ways into the `draft` slot (Describir, Registrar entreno pasado,
    a day's "Sesión de gimnasio") with "Descartar y seguir", "Abrir el que tengo" and "Cancelar", and
    discards at once; an empty past session is replaced without asking (`sessionHasContent`). (b)
    "Describir" shows on day screens of today and the 6 days before only (the API limit). (c) The
    finish sheet of a draft keeps the duration said, else an empty field (its sets carry no times).
    (d) An activity saved from a sentence goes to the Training tab; a "También" activity goes back to
    the draft it came from. (e) "Cambiar ejercicio" shows in past and edited sessions, not live ones.
  - `training/describe` is a card screen, not a modal, so the editor is pushed on top of it and going
    back (or "Cambiar la frase" in the banner) finds the sentence as typed.
  - The activity sheet takes `source=text`, `type`, `minutes`, `rpe`, `time`, `date`, `pain`,
    `distance`, `dayDropped`, and `extra`/`extraOf` for a "También" line; the other activities of an
    activity draft live in memory (`lib/activityDraft.ts`). Without minutes said, the field is empty.
  - "Buscar" and "Crear ejercicio" use `mentionName` (the words without the sets) and
    `trackingFromSets` (the tracking the form starts with); the picker has a one-exercise mode for
    `replace` and `resolve`.
  - The E2E found that `Checkbox` rendered no `aria-checked` on the web (react-native-web ignores
    `accessibilityState`), so a screen reader could not tell whether "Cuenta como Rutina A" or any
    other checkbox was ticked; it now sets `role` and `aria-checked` like the set ✓.
