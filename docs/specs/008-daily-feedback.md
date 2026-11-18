# 008 — Daily feedback on the food log

- Status: approved (2026-11-18)
- Phase: E4, last piece (BLUEPRINT §7 puts the daily feedback in slice (c); spec 007 left it to this
  spec on 2026-11-17).
- Tier: free. The AI wording has a daily cap per user; past the cap the notes use fixed wording, so
  the feature never stops working (BLUEPRINT §3: daily feedback ✅ free and premium).

## Problem / user story

As a user who logs what I eat, I want a few short notes on my day ("you are short on protein for
dinner, try…") with foods I already eat, so that I know what to change in the next meal, not only how
many kcal are left.

## Decisions taken with the human (2026-11-18)

- **The code decides, the AI words it.** `@pt/core` finds the observations and computes every number.
  Claude Haiku 5.5 only writes 1–3 short notes for those observations and picks foods for them from a
  list core gives it. If the AI is unavailable or the cap is reached, fixed i18n wording is used.
- **On request, any day of the Food tab.** A "¿Cómo va el día?" button on the summary card (Food tab,
  and Today for today). For today it points to the meals left; for a past day (up to 6 days back) it
  is a recap.
- **Topics of v1:** protein and kcal against the targets, fiber, the protein spread across meals, and
  carbohydrates on training days.

## Assumptions (to confirm in the review)

- **Training days come from a tap, for now.** The typical week stores sessions per week but not which
  days (spec 002); the days arrive with the week grid of E5. Until then the feedback card has a chip
  "Hoy entreno" (or "Ese día entrené" for a past day), off by default, that is sent with the request
  and not stored. E5 prefills it from the week grid.
- **Suggestions come only from the user's own foods** (recents and favourites of spec 005, last 60
  days). The catalog has no allergen or diet data, so suggesting foods the user never logged could
  break an allergy or a vegetarian diet. A note with no fitting food gives no suggestion.
- **Nothing is stored.** No table: the client keeps the last feedback per day in its query cache with
  a fingerprint of that day's items, and shows "Has registrado algo desde entonces · Actualizar" when
  the items change.
- **Sources are fixed per observation**, not retrieved: the guideline text of the knowledge base
  arrives in E5b. Each observation kind carries one citation in core (see "Sources").
- **Consent changes.** Food names from the user's history, the diet type, allergies and dislikes now
  reach Anthropic. `CONSENT_VERSION` changes and consent is asked again (spec 002 flow).

## Acceptance criteria

### Entry point

- **AC1** — Given the Food tab with numeric targets, then the summary card shows "¿Cómo va el día?" for
  today and "Resumen del día" for a past day; Today shows the same button for today. Given a day with
  no items, then the button is disabled with "Registra algo primero". Given no connection, then it is
  disabled with "Necesitas conexión para esto". _(free)_
- **AC2** — Given a profile with `ed_soft_stop`, or without numeric targets (pregnancy, spec 005 AC16),
  then the button is not shown and `POST /me/food-log/feedback` answers 422 `feedback_unavailable`.
  _(free)_
- **AC3** — Given writes of that day still in the offline queue, then the button shows
  "Sincronizando…" and the request is sent only after they are acknowledged, so the API reads the
  same items the user sees. _(free)_

### Observations (`@pt/core`, test-first; thresholds provisional for the professional reviewer)

- **AC4** — Given `dailyObservations(day, targets, breakdown, context, now)`, then a day is **in
  progress** when it is today, before 22:00 local time and the cena has no items; otherwise it is
  **closed**. The meals left of a day in progress are the main meals (desayuno, comida, cena) whose
  slot (spec 005 AC12) has not ended and that have no items. _(free)_
- **AC5** — Given a closed day with fewer than 2 meals with items or with kcal below 50 % of the target,
  then the only observation is `day_incomplete` ("si comiste algo más, añádelo para que el resumen
  sirva"), with no other note: a forgotten meal must not read as under-eating. _(free)_
- **AC6** — Protein. Given a closed day with protein below 80 % of the target, then `protein_low`
  (eaten, target). Given a day in progress with at least 20 g and 30 % of the protein target left and
  at least one meal left, then `protein_gap` (left, meals left). _(free)_
- **AC7** — Kcal. Given a closed day between 50 % and 80 % of the kcal target, then `kcal_low`. Given a
  closed day above 115 %, then `kcal_above`, a neutral fact ("un día no cambia la tendencia, cuenta la
  semana") that never suggests eating less the next day; it is not produced for `teen_limited`. A day
  in progress gets no kcal note: the summary card already shows what is left. _(free)_
- **AC8** — Fiber. Given items without a fiber value (quick add, products without it) that hold more
  than 25 % of the day's kcal, then no fiber observation. Otherwise, given a closed day below 70 % of
  the fiber target, then `fiber_low`; given a day in progress with at least 10 g and 50 % of the target
  left and a meal left, then `fiber_gap`. _(free)_
- **AC9** — Protein spread. Given the focus `hypertrophy` or `strength`, a closed day and protein at
  80 % of the target or more, when fewer than 2 meals reach 0.25 g/kg of the reference weight (at least
  20 g) and one meal holds more than 50 % of the day's protein, then `protein_uneven` (grams per meal).
  _(free)_
- **AC10** — Carbohydrates. Given "Hoy entreno" / "Ese día entrené" on, then a closed day below 75 % of
  the carbohydrate target gives `carbs_low_training`, and a day in progress with at least 50 g and 40 %
  left and a meal left gives `carbs_gap_training`. With the focus `sport_performance`, a closed training
  day below the carbohydrate minimum (`carbsMinGPerKg` × reference weight) always gives
  `carbs_low_training`. Without the chip, no carbohydrate note. _(free)_
- **AC11** — Given several observations, then at most 3 are kept, in this order: `protein_low` /
  `protein_gap`, `carbs_low_training` / `carbs_gap_training`, `fiber_low` / `fiber_gap`, `kcal_low`,
  `protein_uneven`, `kcal_above`. Given none, then a single `on_track` ("proteína, fibra e hidratos
  cerca de tus objetivos"). _(free)_
- **AC12** — Given an observation that can be fixed with food (`protein_*`, `fiber_*`, `carbs_*`), then
  core ranks the user's foods (recents with their last portion, favourites with their first serving)
  by the missing nutrient per portion, drops portions above 50 % of the day's kcal target, and gives
  up to 5 candidates per observation. _(free)_

### The notes

- **AC13** — Given the observations, then the API asks Claude Haiku 5.5 for one note per observation
  (at most 200 characters, in the user's language) and up to 2 suggested foods per note, chosen from
  that observation's candidates. Each note shows its text, the numbers from core as a chip
  ("Proteína 62 / 140 g") and its suggestions. _(free)_
- **AC14** — Given the AI output, then `validateFeedback` (`@pt/core`) replaces a note with its fixed
  wording when its text has digits (numbers come only from core), exceeds 200 characters, or contains a
  term of the compensation list (skip a meal, fast, burn it off, compensate, purge, eat less tomorrow…,
  es and en); drops notes for observations core did not produce and suggestions not among the
  candidates; and adds the fixed wording for any observation the AI left out. _(free)_
- **AC15** — Given an AI failure (refusal, invalid output, time-out of 10 s, error) or the 11th AI note
  request of the UTC day by a user, then the answer is still 200 with every note in fixed wording
  (`source: template`). Every AI call writes one `ai_usage` row (feature `daily_feedback`). _(free)_
- **AC16** — Given a suggestion on a day in progress, when the user taps it, then the add screen opens
  on the next meal left with the portion sheet of that food and the suggested portion (spec 005 AC8);
  nothing is logged until "Añadir". On a closed day, suggestions show as "La próxima vez: …" and are not
  tappable. _(free)_
- **AC17** — Given a feedback shown, when the day's items change (added, edited, deleted, synced from
  another device), then the card shows "Has registrado algo desde entonces · Actualizar"; the
  fingerprint (`feedbackFingerprint` in core, from the item ids and their `recordedAt`) is computed the
  same way by the API and the app. _(free)_
- **AC18** — Given any feedback, then the card ends with its sources (one line per citation kind used,
  each a link) and "Orientativo, no es consejo médico". _(free)_

### AI quality (eval)

- **AC19** — Given the eval (`apps/api/evals/daily-feedback/`, at least 40 days built from fixtures:
  each observation kind, today and past days, every focus, vegetarian and allergy profiles, both
  languages), then 100 % of the answers are valid after `validateFeedback`, at most 10 % of the notes
  fall back to fixed wording, 0 suggestions are outside the candidates, and the report lists every note
  for a human read of 20 of them (tone, no judgement, no advice to restrict). It states the cost per
  call and the latency. It runs before shipping and on every change of the prompt, the model or the
  observation rules. _(free)_

### Data and privacy

- **AC20** — Given a feedback request, then the prompt holds only: the locale, the training focus, the
  diet type, allergies and dislikes (so the wording does not name unsuitable foods), the observations
  with their numbers, and the candidate foods (name, portion, nutrient per portion). No name, age, sex,
  weight, goal, safety flags or other days. Nothing of the request or the answer is stored or logged
  besides `ai_usage`. _(free)_
- **AC21** — Given the consent text, then it says that a summary of the day and the names of the user's
  usual foods are sent to an AI provider (Anthropic) to word the daily notes; `CONSENT_VERSION` changes
  and consent is asked again. "Download my data" and "Delete my account" do not change (nothing new is
  stored). _(free)_

## Data changes

None. No table and no migration.

- `ai_usage` gets the feature `daily_feedback` (a text column, no migration).
- RLS: unchanged.

## API contracts

- Schemas to add to `@pt/contracts` (`feedback.ts`):
  - `FeedbackObservationKindSchema` (`day_incomplete`, `protein_low`, `protein_gap`, `kcal_low`,
    `kcal_above`, `fiber_low`, `fiber_gap`, `protein_uneven`, `carbs_low_training`,
    `carbs_gap_training`, `on_track`).
  - `FeedbackObservationSchema` (`kind`, `numbers`: eaten / target / left in g or kcal, meals left,
    grams per meal; `citation` id).
  - `DailyFeedbackRequestSchema` (`localDate`, `localTime` `HH:mm` of the device, `trainingDay:
boolean`, `locale`).
  - `FeedbackReadingSchema` (AI output: `notes[]` of `{ observation, text, suggestionRefs[] }`).
  - `FeedbackNoteSchema` (`observation`, `text`, `source: ai | template`, `suggestions[]` of
    `{ food: FoodSchema, portion: PortionSchema }`), `DailyFeedbackResponseSchema` (`localDate`,
    `state: in_progress | closed`, `notes`, `citations`, `fingerprint`).
  - `FEEDBACK_LIMITS` (3 notes, 200 characters, 2 suggestions per note, 5 candidates, 10 AI requests
    per UTC day, 10 s time-out, the thresholds of AC4–AC10).
- Schemas to change: `CONSENT_VERSION`.
- `POST /me/food-log/feedback` → 200 / 400 (date in the future or outside the last 7 days) / 401 / 403
  (consent) / 422 (`feedback_unavailable`, AC2). It reads the day's items, the targets and their
  breakdown, the context snapshot, the recents and favourites, and the dietary preferences on the
  server; it never trusts numbers from the client. No 429 and no 503: AC15 falls back to fixed wording.
- `@pt/core` (test-first): `dailyObservations`, `feedbackCandidates`, `validateFeedback`,
  `templateNotes`, `feedbackFingerprint`, the compensation term list and the citation table.
- `@pt/ai`: `FEATURES.daily_feedback` (Haiku 5.5, effort `low`, `maxTokens` 1024, no tools), prompts
  in `prompts/feedback/` (the candidates use short refs, as in spec 007), prompt caching on the system
  prompt if it reaches the minimum.
- `@pt/api-client`: `dailyFeedback` and its query options keyed by day and fingerprint (not in the
  offline queue); the mock backend answers with fixed wording plus one scripted "AI" note per kind.

## Sources

Fixed in core, shown per observation (AC18). To confirm with the professional reviewer:

| Observation                        | Citation                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `protein_*`, `protein_uneven`      | Jäger R. et al., ISSN position stand: protein and exercise, JISSN 2017             |
| `fiber_*`                          | EFSA NDA Panel, Dietary reference values for carbohydrates and dietary fibre, 2010 |
| `carbs_*_training`                 | Thomas D.T. et al., Nutrition and Athletic Performance (ACSM, AND, DC), 2016       |
| `kcal_*`, `day_incomplete`, others | The user's own targets: the "¿Cómo se calcula?" screen (spec 002)                  |

## UI

- `FeedbackButton` on `DaySummaryCard` (Food tab and Today); `FeedbackCard` below the summary:
  training-day chip, notes (`FeedbackNoteRow`: icon per kind, text, number chip, suggestion chips),
  sources, the disclaimer, the stale banner with "Actualizar".
- States: unavailable (no button), empty day, offline, syncing (AC3), loading (skeleton of 2 notes),
  notes from the AI, notes in fixed wording (looks the same; no "AI" badge needed), stale, error of the
  request itself (retry).
- Neutral visuals: no red, no "bad day", no scores (ADR 006); `on_track` uses the same style as any
  other note.
- Mobile-first (360–430 px), light and dark, touch targets of 44 px, screen-reader labels for the
  number chips ("62 de 140 gramos de proteína").
- i18n (es reference + en): `feedback.button.*`, `feedback.state.*`, `feedback.trainingChip.*`,
  `feedback.template.<kind>` (with interpolated numbers and meals), `feedback.sources.*`,
  `feedback.disclaimer`, `consent.points.*`.
- E2E (`apps/e2e`, mock backend): a day with little protein → feedback → tap a suggestion → portion
  sheet on the next meal → add → stale banner → update → the protein note is gone; a past day →
  recap with "La próxima vez"; the training chip adds the carbohydrate note; an empty day and offline
  disable the button; `ed_soft_stop` hides it.

## Safety & edge cases

- **No restriction, no compensation.** The notes never suggest eating less, skipping a meal, fasting or
  training to burn food: the prompt forbids it and `validateFeedback` enforces it (AC14). `kcal_above`
  is a neutral fact about the week, and is dropped for `teen_limited`.
- **`ed_soft_stop` and pregnancy:** no feedback at all (AC2). A note about a day's numbers is
  monitoring, which the soft stop avoids (spec 005 AC18).
- **Under-logging is not under-eating.** A thin closed day only asks whether something is missing
  (AC5). Repeated low intake over days is the weekly review's job (E5b), not this spec's.
- **Minors (16–17):** same notes except `kcal_above`; to confirm with the reviewer.
- **Allergies and diets:** suggestions come only from foods the user has logged; the wording receives
  the allergies and diet type so it does not name other foods against them. Allergen data on the
  catalog is still out of scope.
- **Numbers are core's.** The AI text has no digits (AC14); every number shown is computed by core from
  the snapshots of the items (spec 005 AC9).
- **Prompt injection.** Food names from quick add or custom foods are user text inside the prompt: they
  are data, the output is only schema fields, and a note text that fails validation falls back to the
  fixed wording.
- **Day boundaries:** the day is the `local_date` of spec 005 (with `day_start_minute`); "in progress"
  uses the device's local time sent by the client as `now` only to pick the state, never to change the
  numbers.

## Out of scope

- An automatic recap of yesterday, notifications, or feedback without a tap.
- Storing feedback or a history of notes; weekly insights (E8); the weekly review (E5b).
- Training days from the week grid (E5 prefills the chip); workouts logged (E5).
- Sugar, salt, alcohol, micronutrients, water, meal timing around training.
- Suggesting catalog foods the user never logged; allergen data for the catalog.
- Questions about a note (the questions assistant, E5b); points, streaks or praise badges.

## Open questions

- **For the professional reviewer:** every threshold of AC4–AC10 (80 % protein, 70 % fiber, 0.25 g/kg
  per meal, 75 % carbohydrates, 115 % kcal, 50 % "incomplete"); whether `on_track` is itself a
  judgement; `kcal_above` for minors; the citations table; the compensation term list.
- **Training chip vs. asking nothing.** If the chip feels like noise, the carbohydrate notes could wait
  for the week grid of E5. Decide after the phone check.
- **For the human:** the go-ahead to run the eval (well under 0.10 USD) and the human read of 20 notes.

## Progress

- [ ] contracts · [ ] db (none) · [ ] core · [ ] ai · [ ] api · [ ] client · [ ] ui · [ ] e2e
- Decisions taken during implementation:
