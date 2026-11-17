# 005 — Food catalog, Spanish food search and food log

- Status: approved (2026-11-16)
- Phase: E4, slice (a) of three. Slice (b), barcode and label photo, and slice (c), the plate photo and
  sentence shortcuts with daily feedback, get their own specs.
- Tier: free (no AI in this spec, so there is no cap)

## Problem / user story

As a user at the table, I want to find what I am eating by its Spanish name and log it in a few taps, in
the meal it belongs to, so that I can see how much of today's calories and macros I have eaten and what
is left.

Stage E4 is done when "a full day is logged in under 1 minute" (BLUEPRINT §7). Search, recents,
favourites and "repeat yesterday" are what make that possible. The AI shortcuts come later and will reuse
this catalog and this log.

## Decisions taken with the human (2026-11-15)

- **Catalog from open sources: CIQUAL + USDA.** BEDCA requires written permission from AESAN for any
  commercial use ([conditions of use](https://www.bedca.net/bdpub/UsoBD.pdf)), so it is not used until
  that permission exists (the human asks for it in parallel). CIQUAL (ANSES, Licence Ouverte / Etalab
  2.0: reuse allowed, also commercial, with attribution) gives the values; USDA FoodData Central (public
  domain) fills the gaps. Neither source has Spanish names, so the catalog is a **curated list of about
  800 foods common in Spain**, with Spanish names, synonyms and household servings written by us.
- **Five fixed Spanish meals plus "Other"**: desayuno, media mañana, comida, merienda, cena, otros. The
  meal is preselected from the time of day.
- **Servings and grams**: each food has 1–3 household servings ("1 huevo mediano (60 g)", "1 cucharada
  (10 g)", "1 plato (250 g)") chosen with a stepper, and grams are always available.

## Assumptions (to confirm in the review)

- **Food becomes a tab**: Hoy · Comida · Progreso · Perfil (spec 003 said Food and Training become tabs
  when E4 and E5 ship).
- **The log is a list of items, without a `meals` table yet.** A meal is the set of items with the same
  day and meal type. Each item has a client-generated id and is written with `PUT` (offline-safe, as
  BLUEPRINT §5 asks). The blueprint's `meals` row (`eaten_at`, `input_method` per meal) adds nothing a
  user can see in this slice; it arrives when a meal gets its own data (the plate photo in slice (c), saved
  meals). BLUEPRINT §5 is updated in the same change to say so.
- **"Quick add"** (a name and the calories, macros optional) is the fallback when a food is not in the
  catalog. Creating a full custom food comes with the label photo in slice (b).
- **Favourites are foods** (a star). Saved meals ("my usual breakfast") are out of scope; "repeat
  yesterday" covers the most common case.
- **Search runs on the server** (Postgres full-text + trigram, accent-insensitive). Without a
  connection, recents and favourites still work from the offline cache, so a meal can be logged at a
  table without coverage.
- **The Spanish names are written during implementation**: Claude Code drafts names, synonyms and
  servings from the source records; the human reviews a sample of 100 foods and `domain-reviewer` checks
  the servings. No AI runs at request time.

## Acceptance criteria

### Catalog (import)

- **AC1** — Given the curated list (`packages/db/src/knowledge/catalog/foods.csv`: key, source,
  source id, Spanish name, Spanish synonyms, English name, popularity, servings), when the importer runs,
  then every food gets kcal, protein, carbohydrates, fat and fiber per 100 g from its source record
  (CIQUAL: energy per Regulation (EU) 1169/2011; USDA: energy in kcal), `source`, `source_id` and the
  source version. Running it again updates the rows and never duplicates them (unique `source` +
  `source_id`). _(free)_
- **AC2** — Given a source value "traces" or "< x", then it is stored as 0; given a missing fiber value,
  then fiber is null; given a missing value for kcal, protein, carbohydrates or fat, then the food is
  skipped and listed in the import report. Given a food whose kcal differs by more than 15 % from
  4·protein + 4·carbohydrates + 9·fat (+ 7·alcohol where present), then the report lists it for review.
  The importer is tested on a small fixture of each source and spot-checked against known values (olive
  oil ≈ 900 kcal, raw chicken breast ≈ 23 g protein, whole milk ≈ 65 kcal per 100 g). _(free)_
- **AC3** — Given the imported catalog, then `knowledge_sources` has one row per source with name, URL,
  license, version, import date and attribution text, and Profile → "Fuentes de datos" shows that
  attribution in the user's language. _(free)_

### Search

- **AC4** — Given a query of at least 2 characters, then `GET /foods/search` returns at most 25 foods,
  ignoring case and accents, matching names and synonyms by word prefix ("pech poll" finds "Pechuga de
  pollo") and tolerating one typo in words of 5 letters or more ("platano", "plátno"). Ranking: whole-name
  match, then prefix of the name, then synonyms, then similarity; ties go to the curated popularity, so
  "leche" shows "Leche semidesnatada" before "Leche de cabra". With the English locale it also searches
  the English names. _(free)_
- **AC5** — Given the search eval (`apps/api/evals/food-search.jsonl`, at least 200 real-world Spanish
  queries with the expected food keys: plurals, regional names such as "papa"/"patata" or
  "judías verdes"/"vainas", brands-as-generic such as "colacao", typos), then the expected food is first
  in at least 75 % of the queries and in the top 3 in at least 90 % (provisional thresholds). The eval runs
  against the dev database with `pnpm --filter @pt/api eval:food-search` and on every change to the
  catalog or the search query. _(free)_
- **AC6** — Given a query with no results, then the screen says so and offers "Quick add" with the query
  as its name. Given no connection, then the search field says that search needs a connection and the
  recents and favourites stay usable. _(free)_

### Logging

- **AC7** — Given the Food tab, when the user taps "Añadir" on a meal (or "Registrar comida" on Today),
  then the add screen opens with the search field focused and, while the field is empty, the recents
  (the 20 foods logged most recently in the last 60 days, with the portion last used) and the favourites.
  Given a new user with neither, then it shows a short hint to search. _(free)_
- **AC8** — Given a food tapped from search, recents or favourites, then a portion sheet shows its
  servings as chips (the first preselected, or the serving and quantity last used for that food), a
  stepper for the number of servings (steps of ½, from ½ to 20) and a "Gramos" option with a numeric
  field (1–2000 g); it previews kcal, protein, carbohydrates and fat as the portion changes, and "Añadir"
  saves the item with one tap. After saving, the add screen stays open with a confirmation ("Añadido: 2
  huevos") so several foods can be added in a row, and "Listo" closes it. _(free)_
- **AC9** — Given a saved item, then it stores a snapshot of its name, grams, kcal and macros, computed by
  `@pt/core` from the food's values per 100 g; the API computes the snapshot again from the catalog and
  ignores client values for catalog foods. Later changes to the catalog do not change logged items.
  _(free)_
- **AC10** — Given "Quick add", then the user enters a name (1–80 characters), kcal (0–5000) and
  optionally protein, carbohydrates and fat (0–500 g each); the item has no food and no grams. Given
  macros whose energy (4·P + 4·C + 9·F) exceeds the kcal by more than 20 %, then the form asks for
  confirmation before saving. _(free)_
- **AC11** — Given an item, when the user taps it, then a sheet lets them change the portion and the meal,
  or delete it (with an undo for 5 seconds instead of a confirmation). A deleted item disappears from the
  meal and the totals. _(free)_
- **AC12** — Given the add screen opened from the Food tab on a meal, then the item goes to that meal.
  Given it opened from Today, then the meal is preselected from the device's local time (05:00–10:59
  desayuno, 11:00–12:59 media mañana, 13:00–16:29 comida, 16:30–19:59 merienda, 20:00–04:59 cena) and can
  be changed with chips before saving. _(free)_
- **AC13** — Given a meal with no items today and items in the same meal yesterday, then the meal shows
  "Repetir lo de ayer (3 alimentos · 520 kcal)"; one tap copies those items to today as new items (new
  ids, same portions, snapshots computed again from the catalog; quick-add items copied as they are), and
  an undo is offered for 5 seconds. _(free)_
- **AC14** — Given a food, when the user taps its star (in the portion sheet or in search results), then
  it is added to or removed from the favourites. _(free)_

### The day

- **AC15** — Given the Food tab, then it shows a day selector (today and the 6 days before, as chips;
  today by default), a summary card and the six meals in order, each with its items (name, portion,
  kcal), its total kcal and "Añadir". Empty meals take one line. _(free)_
- **AC16** — Given the summary card with numeric targets, then it shows the kcal eaten and the kcal left
  ("Te quedan 650 kcal") or above the target ("150 kcal por encima"), with neutral wording and colors (no
  red for being above), and protein, carbohydrates and fat as eaten / target in grams with a bar that is
  not read by color alone. Totals are computed by `dailyTotals` in `@pt/core` (sum of the snapshots,
  rounded only for display). Given no numeric targets (pregnancy), then it shows only the eaten totals.
  _(free)_
- **AC17** — Given Today, then the targets card becomes the summary card of AC16 for today and gains a
  "Registrar comida" button (AC12). The "How is this calculated?" link stays. _(free)_
- **AC18** — Given a profile with `ed_soft_stop`, then the food log shows foods and portions without
  numbers: no kcal on items, meals or the summary, no "left" or "above", and Today keeps its current
  targets card instead of the summary. Logging works the same. _(free)_

### Offline-safe writes (same rules as spec 003)

- **AC19** — Given no connection, when the user adds, edits or deletes an item, toggles a favourite, or
  repeats yesterday, then the change shows at once marked "waiting to sync" and is sent when the
  connection returns, also after a restart. Recents and favourites are in the offline cache. _(free)_
- **AC20** — Given a write sent twice (lost answer), then the database has one item with that id (`PUT`
  and `DELETE` are idempotent). Given two writes to the same item from different devices, then the one
  with the later `recordedAt` wins whatever the order of arrival. Given a delete, then a later `PUT` of
  that id with an earlier `recordedAt` does not bring the item back (a tombstone keeps the delete time).
  _(free)_
- **AC21** — Given a queued write the API rejects (400), then the optimistic change is undone and the user
  sees why; network errors and 5xx stay queued (spec 003 AC21). _(free)_

### Data and privacy

- **AC22** — Given the consent text, then it lists the food log ("lo que comes") among the data we store,
  `CONSENT_VERSION` changes, and existing users are asked again before any health-data route works
  (spec 002 flow). _(free)_
- **AC23** — Given "Download my data", then it includes every logged item and the favourites; given
  "Delete my account", then they are deleted (the schema-driven test covers the new tables). The catalog
  is not user data and is not exported. _(free)_

## Data changes

| Table             | Column                                              | Type                                                                             | Notes                                                              |
| ----------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| knowledge_sources | id                                                  | text PK                                                                          | `ciqual-2025`, `usda-fdc-2025-04`…                                 |
|                   | name, url, license, version, attribution            | text                                                                             | attribution in es and en (`attribution_es`, `attribution_en`)      |
|                   | imported_at                                         | timestamptz                                                                      |                                                                    |
| foods             | id                                                  | uuid PK                                                                          |                                                                    |
|                   | key                                                 | text unique                                                                      | stable curated key (`huevo-entero`), used by the eval and fixtures |
|                   | source / source_id                                  | text FK knowledge_sources / text                                                 | unique (source, source_id)                                         |
|                   | name_es, name_en                                    | text                                                                             |                                                                    |
|                   | synonyms_es                                         | text[]                                                                           |                                                                    |
|                   | popularity                                          | smallint                                                                         | tie-break in search (AC4)                                          |
|                   | kcal_100g, protein_g_100g, carbs_g_100g, fat_g_100g | numeric(6,2)                                                                     | not null, check ≥ 0                                                |
|                   | fiber_g_100g                                        | numeric(6,2) null                                                                |                                                                    |
|                   | search                                              | tsvector, generated (unaccent, `simple` config) + GIN; trigram GIN on the names  | extensions `unaccent`, `pg_trgm`                                   |
| food_servings     | id                                                  | uuid PK                                                                          |                                                                    |
|                   | food_id                                             | uuid FK foods `on delete cascade`                                                |                                                                    |
|                   | label_es, label_en, grams, sort                     | text, text, numeric(6,1) check > 0, smallint                                     |                                                                    |
| meal_items        | id                                                  | uuid PK (client-generated)                                                       |                                                                    |
|                   | user_id                                             | uuid FK profiles `on delete cascade`                                             | index (user_id, local_date)                                        |
|                   | local_date                                          | date                                                                             |                                                                    |
|                   | meal_type                                           | enum `meal_type` (breakfast, mid_morning, lunch, afternoon_snack, dinner, other) |                                                                    |
|                   | food_id                                             | uuid FK foods `on delete set null`, null for quick add                           |                                                                    |
|                   | serving_id / servings                               | uuid FK food_servings `on delete set null` null / numeric(4,2) null              | to reopen the item as "2 huevos"                                   |
|                   | label                                               | text                                                                             | snapshot of the name                                               |
|                   | grams                                               | numeric(6,1) null                                                                | null for quick add                                                 |
|                   | kcal, protein_g, carbs_g, fat_g, fiber_g            | numeric(7,2), fiber null                                                         | snapshot (AC9)                                                     |
|                   | input_method                                        | enum `food_input_method` (search, recent, favourite, repeat, quick_add)          | slices (b) and (c) add barcode, label, photo, text                 |
|                   | recorded_at                                         | timestamptz                                                                      | device time; the later write wins (AC20)                           |
|                   | deleted_at                                          | timestamptz null                                                                 | tombstone (AC20); purged after 30 days                             |
|                   | created_at / updated_at                             | timestamptz                                                                      |                                                                    |
| favourite_foods   | user_id, food_id, created_at                        | uuid FK profiles cascade, uuid FK foods cascade, timestamptz                     | PK (user_id, food_id)                                              |

- RLS: `foods`, `food_servings` and `knowledge_sources` are readable by `authenticated`; `meal_items` and
  `favourite_foods` are readable only where `user_id = auth.uid()`. No write policies: every write goes
  through the API (the importer uses the service connection).
- Migration `0006`: extensions, enums, tables, indexes. The catalog is loaded by the importer
  (`pnpm --filter @pt/db import:foods`), not by the migration, so the migration stays small and the
  catalog can be refreshed.
- Raw source files are downloaded to a cache outside git; only the curated CSV is committed.

## API contracts

- Schemas to add to `@pt/contracts` (`food.ts`): `FoodSchema` (id, key, name, per-100 g values,
  servings, source), `FoodServingSchema`, `FoodSearchQuerySchema` (`q` 2–60 chars, `locale`),
  `FoodSearchResponseSchema`, `MealTypeSchema`, `MealItemSchema`, `MealItemUpsertRequestSchema`
  (catalog item: `foodId`, `servingId` + `servings` or `grams`; quick add: `label`, `kcal`, optional
  macros; always `localDate`, `mealType`, `inputMethod`, `recordedAt`, `today`),
  `FoodLogQuerySchema` (`from`, `to`, at most 31 days), `FoodLogResponseSchema` (items of the range),
  `RecentFoodsResponseSchema`, `FavouriteFoodsResponseSchema`, `FOOD_LOG_LIMITS` (grams 1–2000,
  servings ½–20, quick-add kcal 0–5000 and macros 0–500, 150 items per day).
- Schemas to change: `ExportResponseSchema` (`mealItems`, `favouriteFoods`), `CONSENT_VERSION`.
- `GET /foods/search?q&locale` → 200 / 400 / 401 / 403
- `GET /me/food-log?from&to` → 200 / 400 / 401 / 403
- `PUT /me/food-log/items/{id}` → 200 (the stored item, or the newer one that won) / 400 / 401 / 403 /
  404 (unknown `foodId`)
- `DELETE /me/food-log/items/{id}?recordedAt` → 200 / 400 / 401 / 403 (succeeds when the item does not
  exist)
- `GET /me/foods/recent` → 200 / 401 / 403
- `GET /me/foods/favourites` → 200 / 401 / 403; `PUT` and `DELETE /me/foods/favourites/{foodId}` → 200 /
  401 / 403 / 404
- Every route needs the current consent (403 `consent_required`); `/foods/search` too, because the query
  is about what the user eats.
- `@pt/core` (test-first): `itemNutrition(per100g, grams)`, `portionGrams(serving, servings)`,
  `dailyTotals(items)`, `mealTotals`, `remaining(targets, totals)`, `mealTypeForTime(minutes)`,
  `quickAddEnergyMismatch`, `repeatMeal(items, today, newIds)`.
- `@pt/api-client`: methods, query options, mutation defaults with stable keys, optimistic updates
  (spec 003 pattern), and the same routes in the mock backend with a fixture of about 60 foods and an
  in-memory search good enough for the E2E journeys.

## UI

- Routes: `(tabs)/food` (new tab), `food/add?date&meal` (full-screen modal: search, recents, favourites,
  quick add), `food/item/[id]` (sheet to edit or delete), `settings/sources` ("Fuentes de datos").
- Components: `DaySelector` (shared with the weight sheet's day chips), `NutritionSummaryCard`,
  `MealSection`, `FoodRow`, `PortionSheet`, `QuickAddForm`, `UndoToast`.
- States: loading, empty day (each meal shows "Añadir"; the first day ever adds a one-line hint), search
  loading / no results (AC6) / offline (AC6) / error with retry, pending sync, saved.
- Search: debounced (≈250 ms), the field keeps focus between additions, results show the name, the
  default serving and its kcal (no kcal with `ed_soft_stop`).
- Mobile-first (360–430 px), light and dark, touch targets of at least 44 px, the keyboard never covers
  the portion sheet's buttons.
- i18n (es reference + en): `tabs.food`, `food.*` (meal names, summary, add, portion, quick add, repeat,
  favourites, errors), `sources.*`, the updated `consent.points.what` and the export description.
- E2E (`apps/e2e`, mock backend): log breakfast from search with a serving and lunch with grams, see the
  totals on the Food tab and on Today; repeat yesterday; favourite a food and log it from favourites; a
  quick add; delete with undo; add an item offline, reload, go online and see one synced item; a timed
  journey that logs a 5-meal day from recents in under 60 seconds of test time (AC proxy for "a full day
  in under 1 minute").

## Safety & edge cases

- Counting calories can harm people with an eating disorder. With `ed_soft_stop` the log shows no
  numbers (AC18). The app never judges a day: no "bad day", no red, no notice for eating little or a
  lot in one day; adherence is the weekly review's job (E5b), on averages.
- Pregnancy has no numeric targets (spec 001), so the summary shows totals only.
- Ages 16–17 log like everyone else; their targets already have no deficit.
- Allergies are not checked when logging: the catalog has no allergen data (CIQUAL and USDA generic
  foods do not list allergens). Allergen checks belong to the AI features that propose food (E7) and to
  branded products with allergen lists (slice (b), Open Food Facts).
- Limits (AC8, AC10, `FOOD_LOG_LIMITS`) catch typing mistakes: grams up to 2000 per item; quick-add kcal
  up to 5000 with the energy check of AC10.
- Catalog values are approximate (a generic "tortilla de patatas" is not the user's). The "Fuentes de
  datos" screen says so. Dishes are mapped to the closest source record, which may be a French or US
  recipe; those mappings are listed for the professional reviewer.
- Units: grams and kcal internally; the UI shows grams in both unit systems in this spec (ounces are out
  of scope).
- Dates: same rules as spec 003 (`today` within ±1 day of server UTC, no future `localDate`, at most 1
  year back for writes, `recordedAt` at most 1 day ahead). The day starts at midnight until
  `day_start_minute` arrives (E5).
- `GET /foods/search` is a free text field: the query is validated (length, characters) and never
  logged with the user id.

## Out of scope

- Barcode, label photo, custom foods with full nutrition, branded products, Open Food Facts (slice (b)).
- Plate photo and sentence shortcuts, daily feedback, AI caps and `ai_usage` metering (slice (c)).
- BEDCA (until AESAN grants permission), CIQUAL and USDA foods outside the curated list.
- Saved meals and recipes made by the user; copying a whole day; copying to another day than today.
- Micronutrients, water, alcohol tracking as its own field, ounces.
- Allergen checks (see Safety), meal plans (E7), weekly adherence and the weekly review (E5b).
- Adding the food log to `ContextSnapshot` (the weekly review in E5b defines what it needs).
- `day_start_minute` for shift workers (E5).

## Open questions

- For the professional reviewer: the servings of the curated catalog, the dish mappings to French or US
  records, storing "traces" and "< x" as 0, the 15 % energy check of the importer, the meal hours of
  AC12, and the no-numbers mode for `ed_soft_stop` (AC18).
- The human: send the permission request to AESAN for BEDCA (commercial use in an app with a paid plan).
- Whether the search eval thresholds (75 % first, 90 % top 3) are enough for "a full day in under 1
  minute", or the eval needs a real timed test with users in the beta.

## Progress

- [x] contracts · [x] db · [x] core · [x] api · [x] client · [x] ui · [x] e2e
- Done so far (2026-11-16), one commit per step: contracts + core (`154c3bf`), tables and migration
  `0006` applied to dev (`b8b1d3d`), core search and write rules (`f4ba1df`), curated catalog of 811
  foods and the Ciqual importer, run on dev (`6e76648`), API routes (`4079202`), `GET /foods/:foodId`,
  `itemToRequest` in core and the client (this step).
- Client (2026-11-16): `@pt/api-client` has the 10 food methods; `foods.ts` holds the query options
  (log of the last 8 days under one key, search, one food, sources, recents, favourites) and the three
  mutations registered by key (`registerFoodMutations`: save item, delete item, favourite), optimistic,
  queued in one scope so a delete or an undo follows its add, and restored after a restart.
  `saveItemVariables(id, request, food)` previews the snapshot with the same core function as the API.
  The mock backend serves every route with a fixture of 70 foods from the dev catalog
  (`mock/foods.ts`, real Ciqual values, fixed ids) and the same search, tombstones and limits.
  The app registers the mutations in `lib/api.ts`; search results are not saved in the offline cache.
  Tests: `api-client/src/foods.test.ts` (optimistic add, delete + undo, move to another meal, repeat
  yesterday, offline queue across a restart, rejection, retries, favourites) and the mock suite.
- Search eval (AC5, 2026-11-16): 355 real-world queries in `apps/api/evals/food-search.jsonl` (written by
  an agent that saw only the official names), 95.8 % first and 98.6 % in the top 3 (thresholds 75 %
  and 90 %). The 5 misses are multi-food sentences ("pan con tomate"), left to the sentence shortcut of
  slice (c). Plurals and quantity words ("un vaso de") were added to the search on the way.
- UI (2026-11-16): the Food tab (`(tabs)/food`: day chips, summary, six meals, "Repetir lo de ayer",
  undo in the footer), the add screen (`food/add`: search with a 250 ms pause, recents, favourites,
  no results → quick add, offline notice; the portion sheet and the quick-add form are steps of the same
  screen, so the search keeps its place and its focus), the item sheet (`food/item/[id]`), "Fuentes de
  datos" (`settings/sources`, linked from Profile) and the summary card on Today with "Registrar
  comida". New pure functions in `core/food/portion.ts` (`initialPortion`, `portionPreview`,
  `formatPortion`, `parseGramsField`, `targetProgress`) and `parseQuickAddFields`, with tests.
  Checked on web with Playwright at 390 px (light and dark) and 1280 px, without console errors: add
  by serving, by grams and by quick add, edit and move, delete and undo, repeat yesterday, favourites,
  an add without connection that syncs afterwards, and a reload.
- E2E (2026-11-16): `apps/e2e/tests/food.spec.ts`, five journeys on the mock backend: breakfast by
  serving and lunch by grams with the totals on Food and Today, and an add from Today with the meal
  chips (AC4, AC7–AC9, AC12, AC15–AC17); favourites, quick add with its confirmation, delete with undo
  and without it, another portion and meal (AC6, AC10, AC11, AC14); repeat yesterday with undo (AC13);
  an add without connection that survives a reload and syncs once (AC6, AC19, AC20); a 5-meal day from
  recents in under 60 s. The helpers shared with the weight journeys moved to `tests/app.ts`, and the
  weight journey reads the mock database under its current key (`pt.mock-db.v5`). BLUEPRINT §5 says
  that there is no `meals` table yet.
- Not covered by a test: AC18 on screen (no numbers with `ed_soft_stop`). The flag cannot be reached
  from the onboarding form, so only `showsFoodNumbers` is tested (core); check it by hand, or add a
  mock account with the flag.
- Known limit: the recents are refreshed while the add screen is open. A food added and closed within
  the latency of the write shows in the recents the next time the screen opens with a connection, not
  offline.
- Left for the human: the phone check in Expo Go (keyboard over the portion sheet and the quick-add
  form, the modal gestures, `expo-crypto` ids), and the review of 100 foods and of the servings.
- The search eval
  runs with `pnpm --filter @pt/api eval:food-search` (cases in `apps/api/evals/food-search.jsonl`).
- Tests by criterion so far: AC1–AC2 `db/knowledge/*.test.ts` (parsers, values, report) and the import
  run on dev; AC3–AC4, AC6 (API part), AC8–AC10, AC14, AC20, AC23 `api/routes/foods/foods.test.ts`; AC4
  `core/food/search.test.ts`; AC9–AC13, AC16, AC18 `core/food/*.test.ts`; AC20, AC23 on the real SQL in
  `api/store/account-deletion.integration.test.ts`; AC22 consent text and `CONSENT_VERSION` 2026-11-v3.
- Decisions taken during implementation:
  - **The summary bars share one colour** (the primary green): the fat token is red, and a full red bar
    reads as a warning, which AC16 forbids. The numbers beside each bar carry the information.
  - **The kcal left are computed from the rounded kcal eaten**, so "699 kcal" and "Te quedan 1681 kcal"
    always add up to the target.
  - **Today keeps the test ids of the targets card** (`targets-card`, `targets-kcal`, `targets-protein`…)
    on the summary card: the target is still there ("de 2380 kcal", "0 / 122 g"). "¿Cómo se calcula?"
    opens the profile settings, where the breakdown lives.
  - **A quick add can be moved or deleted, not edited** (AC11 speaks of the portion and the meal; a quick
    add has no portion). The same for an item whose food left the catalog.
  - **Item ids come from `expo-crypto`** (`randomUUID`; Hermes has no `crypto.randomUUID`).
  - The meal chips of the add screen (opened from Today) wrap in two rows instead of scrolling, so the
    preselected meal is always visible. The day chips of the Food tab scroll in one row.
  - The sign-out warning of the Profile tab now also counts food-log writes waiting to sync.
  - **`GET /foods/:foodId` added** (not in the API contracts above): the edit sheet (AC11) needs the
    food's servings, and a food logged days ago may no longer be in the recents.
  - **Undo, move and repeat write the item again** with `itemToRequest` (core): an undo of a delete is a
    `PUT` with a later `recordedAt`, which beats the tombstone (AC20), so a delete is sent at once and
    survives closing the app during the 5 s of the undo.
  - **The cached log covers 8 days**: today and the 6 days of the day selector, plus the day before the
    oldest one for "Repetir lo de ayer".
  - English search ranks by the same tiers, so "milk" shows "Coffee with milk" before "Semi-skimmed
    milk" (same popularity, shorter Spanish name). Left as is: the eval and the users are Spanish.
  - **Search runs in memory, in `@pt/core`** (`searchFoods`), not in Postgres: the catalog is small (811
    foods), so the API caches it per instance, and the API, the mock backend and the eval rank the same
    way. No `unaccent`/`pg_trgm` extensions and no `search` column (Data changes above are superseded
    on this point). Revisit with Open Food Facts (slice (b)), where the catalog grows.
  - **Ciqual only, no USDA yet**: Ciqual covered the curated list. Spanish foods it lacks (croquetas,
    cocido, churros, turrón, salmorejo, Spanish cheeses with PDO…) and every approximate mapping are in
    `docs/knowledge/catalog-review.md` for the professional reviewer and for later sources.
  - **The catalog was curated by six agents, one per food group**, then merged and checked by the real
    parser (duplicates removed). Servings are written `label (N g)` in the CSV.
  - **Energy check counts fiber at 2 kcal/g** (Regulation (EU) 1169/2011, the energy Ciqual gives); the 6
    remaining flags are foods with organic acids (lemon, lime, vinegars, pickles).
  - `meal_items.serving_label` added (snapshot of the serving's name, to show "2 × 1 huevo mediano").
  - Writes carry `locale` (language of the name and serving snapshots).
  - `GET /foods/sources` added for the "Fuentes de datos" screen (auth only: no health data).
  - A delete that reaches the server before the item's first `PUT` leaves no tombstone (the device
    queue keeps the order of one device's writes, so this needs two devices; accepted).
