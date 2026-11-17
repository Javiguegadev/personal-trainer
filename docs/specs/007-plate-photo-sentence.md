# 007 — Plate photo and sentence shortcuts for the food log

- Status: approved (2026-11-17)
- Phase: E4, slice (c) of three (after specs 005 and 006). The daily feedback that BLUEPRINT §7 puts in
  this slice gets its own spec (008), decided with the human on 2026-11-17.
- Tier: free with an abuse cap per day (BLUEPRINT §3: "daily cap" free, unlimited premium; plans and
  `canUse()` arrive in E5b / E6).

## Problem / user story

As a user at the table, I want to log a whole meal from one photo of my plate or from one sentence
("dos huevos fritos, una tostada con aceite y un café con leche"), and get a draft I can fix with taps,
so that a meal with several foods takes seconds instead of one search per food.

Stage E4 is done when "text and barcode totals are within ±5 % of a reference" (BLUEPRINT §7). Plate
photos are measured apart: food identification and portion error against a weighed reference set.

## Decisions taken with the human (2026-11-17)

- **Scope:** the plate photo and the sentence. The daily feedback is spec 008.
- **Caps (abuse guard, not a plan limit):** 20 plate photos and 40 sentences per user and UTC day, each
  with its own counter, apart from the 20 label photos of spec 006.
- **Plate reference set:** the human weighs about 30 real Spanish plates (photo + grams of each food).

## Assumptions (to confirm in the review)

- **The draft is the product, not the AI answer** (ADR 004). Both shortcuts open the same draft screen:
  a list of catalog foods with their portions, each editable with the portion sheet of spec 005. Nothing
  is logged until the user taps "Añadir".
- **The AI chooses, the code computes.** Claude Haiku 5.5 splits the input into mentions, calls a
  `search_foods` tool over our catalog (the curated foods, the user's own foods and the products the
  user has logged, as the search of spec 006 does), and returns catalog ids with a serving count or
  grams. `@pt/core` rejects any id the tool did not return in that request, clamps the portions to the
  limits of spec 005 and computes every number.
- **One meal per draft.** The draft goes to the meal preselected as in spec 005 AC12 (or the meal the
  add screen was opened on), changeable with chips. "Desayuné X y comí Y" gives one draft.
- **Spoken sentences use the keyboard's dictation.** No microphone button and no speech module in this
  slice: the on-device module is chosen in the E5b spec (ADR 004). The text field says that dictation
  works.
- **No `meals` table yet.** The items keep the shape of spec 005 with `input_method` `photo` or `text`.
  The photo is not stored, so a meal has no data of its own. BLUEPRINT §5 is updated in the same change
  (the `meals` row arrives with saved meals or with a stored photo).
- **The user's recent foods help the match through the tool, not the prompt.** `search_foods` ranks the
  foods the user logged in the last 60 days first among equal matches, so "café con leche" finds the
  user's usual one. The prompt carries the sentence or the image, the locale and fixed instructions; no
  profile data, no targets, no history.
- **Consent changes.** The text of spec 006 covers label photos only; plate photos and sentences, and
  the food names the tool returns, also reach Anthropic. `CONSENT_VERSION` changes and consent is asked
  again (spec 002 flow).

## Acceptance criteria

### Entry points

- **AC1** — Given the add screen of spec 005, then beside "Escanear" sit "Foto del plato" and
  "Describir". Given no connection, then both are disabled with "Necesitas conexión para esto" and the
  search, recents, favourites and barcode keep working as before. _(free)_
- **AC2** — Given "Describir", then a multiline field (3–300 characters) opens with an example as its
  placeholder, a hint that the keyboard's microphone works, and "Preparar borrador". The text keeps its
  content if the user goes back. _(free)_
- **AC3** — Given "Foto del plato", then the user takes a photo or picks one from the library; the app
  resizes it on the device (longest side 1568 px, JPEG, same helper and limits as spec 006 AC14) and
  sends it. The photo shows at the top of the draft screen while the draft is prepared and reviewed; it
  lives only in the app's memory. _(free)_

### The draft

- **AC4** — Given a sentence, then `POST /me/food-log/drafts/text` returns a draft: one item per food
  mentioned, in the order said, at most 15. Each item has the catalog food, a portion (a serving and a
  count in steps of ½, or grams) and the words it came from ("una tostada"). Explicit quantities are
  respected ("200 g de arroz" → 200 g; "2 huevos" → 2 × "1 huevo mediano"); a food without a quantity
  gets the food's first serving and is marked "cantidad supuesta". _(free)_
- **AC5** — Given a plate photo, then `POST /me/food-log/drafts/photo` returns a draft with one item
  per food it sees, at most 15, each with grams estimated from the photo and a confidence (high, medium,
  low). Low-confidence portions are marked "Revisa la cantidad". A plain food visibly cooked or
  dressed with oil may add the oil (at most 10 g) as an item marked "Probable", which the user keeps
  or removes. _Amended on 2026-11-17 after the domain review: "a visibly fried or dressed dish" made
  fried foods, whose values already hold their fat, count it twice._ The draft always says "Revisa
  las cantidades: una foto no ve el aceite, las salsas ni lo que hay debajo". _(free)_
- **AC6** — Given a mention the tool finds no food for ("salmorejo de mi abuela"), then the draft shows
  it as "No lo encuentro: …" with "Buscar" (opens the search with those words) and "Añadir rápido"
  (spec 005 AC10 with the words as its name). Unresolved mentions are not saved. _(free)_
- **AC7** — Given the draft screen, then each item shows its name, its portion and its kcal (no kcal
  with `ed_soft_stop`, spec 005 AC18), and a total for the draft. Tapping an item opens the portion
  sheet of spec 005 with "Cambiar alimento" (search in replace mode, keeping the portion if the new
  food has the same serving, else its grams) and "Quitar". "Añadir otro" opens the search and adds to
  the draft. The meal chips sit at the top. _(free)_
- **AC8** — Given "Añadir N alimentos", then every item is saved with `PUT /me/food-log/items/{id}`
  (new client ids, `inputMethod` `text` or `photo`), the snapshots are computed as in spec 005 AC9, the
  screen returns to the add screen with "Añadidos: 3 alimentos", and an undo removes all of them for 5
  seconds. Given no connection after the draft arrived, then the items wait in the offline queue as any
  other item (spec 005 AC19). _(free)_
- **AC9** — Given `mealDraft` (`@pt/core`, test-first) and the model's reading, then an item whose food
  id the `search_foods` tool did not return in that request, whose serving is not one of that food's, or
  whose portion falls outside 1–2000 g (servings ½–20) is turned into an unresolved mention (AC6) or
  clamped, never saved as given. Duplicate mentions of the same food are kept apart (the user may eat
  two different portions). _(free)_

### Failures and limits

- **AC10** — Given a photo with no food (a person, a menu, a label), too dark or blurry, then the answer
  is `unreadable` with a reason (`not_food`, `blurry`, `unclear`) and the screen offers "Repetir foto"
  and the search. Given a sentence with no food ("hola", "qué tal"), then the answer is `unreadable`
  with `not_food` and the field stays as typed. Given a label or a barcode in the photo, then the reason
  is `not_food` and the screen points to "Escanear". _(free)_
- **AC11** — Given a refusal, an invalid output, more than 2 tool rounds, a time-out of 20 s or an error
  from the model, then the API returns 503 `ai_unavailable` and the screen keeps the sentence or offers
  the search; nothing is half-saved. _(free)_
- **AC12** — Given the 20th plate photo or the 40th sentence of the UTC day by a user, then the next one
  returns 429 `ai_cap_reached` and the screen says the meal can be added with the search. Every call
  writes one `ai_usage` row (feature `meal_photo` or `meal_text`, model, tokens, cost, latency, status),
  and the counters only count their own feature. _(free)_

### AI quality (evals)

- **AC13** — Given the sentence eval (`apps/api/evals/meal-text/`, at least 120 Spanish sentences with
  the expected food keys and grams: explicit and household quantities, regional names, dishes that are
  several foods such as "pan con tomate", typos, brands used as generic names, sentences without food),
  then at least 90 % of the expected foods are matched to an accepted key, at most 5 % of the draft
  items are foods that were not mentioned, and in at least 90 % of the sentences whose quantities are
  all explicit the draft's kcal are within ±5 % of the reference (the E4 criterion). The report states
  the cost per call and the median and 90th percentile latency. _(free)_
- **AC14** — Given the plate eval (`apps/api/evals/meal-photo/`, about 30 plates photographed and
  weighed by the human, plus at least 5 photos that are not food), then (provisional thresholds, for
  the professional reviewer) at least 80 % of the weighed foods that make up 10 % or more of the plate
  are identified, the draft's kcal are within ±25 % of the weighed kcal in at least 70 % of the plates,
  the median absolute error of the plate's kcal is at most 20 %, and no non-food photo gives items. The
  report states the cost and latency as in AC13. _(free)_
- **AC15** — Given either eval, then it runs before the feature ships and on every change of the prompt,
  the tool, the model or the catalog's search, as the label eval does. _(free)_

### Data and privacy

- **AC16** — Given a plate photo, then it lives only in the memory of the request: it is not written to
  disk, storage, logs or `ai_usage`. Given a sentence, then it is not stored or logged either; only the
  saved items keep their food name. The prompt holds the image or the sentence, the locale and fixed
  instructions; tool results hold food names, servings and values from the catalog. Text in the photo
  or the sentence is data: the output can only be the fields of the schema, which `core` validates.
  _(free)_
- **AC17** — Given the consent text, then it says that plate photos and meal descriptions are read by
  an AI provider (Anthropic), are not stored and travel without the user's profile; `CONSENT_VERSION`
  changes and consent is asked again (spec 002 flow). _(free)_
- **AC18** — Given "Download my data" or "Delete my account", then nothing changes: the shortcuts store
  only ordinary items, already covered by spec 005 AC23. _(free)_

## Data changes

| Table      | Column       | Type                                           | Notes                  |
| ---------- | ------------ | ---------------------------------------------- | ---------------------- |
| meal_items | input_method | enum `food_input_method` gains `photo`, `text` | how the item was added |

- RLS: unchanged (`meal_items` readable only where `user_id = auth.uid()`; writes through the API).
- `ai_usage` gets the features `meal_photo` and `meal_text` (a text column, no migration).
- Migration `0008`: the two enum values only.

## API contracts

- Schemas to add to `@pt/contracts` (`food.ts`, or `meal-draft.ts` if `food.ts` grows past reading):
  - `ImageUploadSchema` (the `{ mediaType, data }` of `LabelImageSchema`, which becomes an alias).
  - `MealTextDraftRequestSchema` (`text` 3–300, `locale`), `MealPhotoDraftRequestSchema` (`image`,
    `locale`).
  - `MealReadingSchema` (AI output: `status: ok` with `items[]` of `{ mention, foodId | null, servingId
| null, servings | null, grams | null, confidence, quantityAssumed, inferred }`, or `status:
unreadable` with `reason`).
  - `DraftItemSchema` (`food: FoodSchema`, `portion: PortionSchema`, `mention`, `confidence`,
    `quantityAssumed`, `inferred`), `UnresolvedMentionSchema`, `MealDraftResponseSchema`
    (`ok` with `items` and `unresolved`, or `unreadable` with a reason).
  - `MEAL_DRAFT_LIMITS` (text 3–300, 15 items, 20 photos and 40 sentences per day, 20 s time-out; the
    image limits are those of `LABEL_SCAN_LIMITS`).
- Schemas to change: `FoodInputMethodSchema` (+ `photo`, `text`), `CONSENT_VERSION`.
- `POST /me/food-log/drafts/text` → 200 / 400 / 401 / 403 / 429 / 503
- `POST /me/food-log/drafts/photo` → 200 / 400 / 401 / 403 / 413 / 429 / 503
- Both need the current consent. Neither writes the log: saving is spec 005's `PUT`.
- `@pt/core` (test-first): `mealDraft(reading, candidates)` (AC4, AC6, AC9), `draftTotals`, and a
  `recentIds` boost in `searchFoods` (equal score → recently logged first).
- `@pt/ai`: `FEATURES.meal_text` and `FEATURES.meal_photo` (Haiku 5.5, effort `low`, `maxToolRounds:
2`, provisional until the evals run), prompts in `prompts/meal/`, the `search_foods` tool definition
  (input: up to 15 queries; output per query: up to 5 foods with id, name, servings and kcal per 100 g),
  and a small tool loop in the client (the label call has no tools). Prompt caching on the system
  prompt and the tool definition if they reach the model's minimum cacheable length.
- `apps/api`: a meal-draft service that runs the loop, answers the tool from the same in-memory search
  as `GET /foods/search` (catalog + `userSearchFoods`), applies `mealDraft`, meters and caps.
- `@pt/api-client`: `draftFromText`, `draftFromPhoto` (no offline queue: they need a connection), and
  the mock backend with fixed drafts for a few sentences, one plate photo, one unresolved mention, one
  non-food image (the "tiny image" rule of spec 006) and the cap.

## UI

- The draft is a step of the add screen (`food/add`), as the portion sheet and the custom-food form
  are (spec 006 decisions), so the search, the meal and the day stay in place.
- Components: `ShortcutButtons` (Escanear · Foto del plato · Describir), `MealTextInput`,
  `MealDraftView`, `DraftItemRow` (with "cantidad supuesta", "Revisa la cantidad", "Probable"),
  `UnresolvedMentionRow`, `DraftPhotoHeader`. `PortionSheet` gains "Cambiar alimento" and "Quitar" in
  draft mode. The photo helper of spec 006 (`lib/labelPhoto.ts`) becomes a shared `lib/photo.ts`.
- States: offline (AC1), typing, preparing (progress; the photo or the sentence visible), draft,
  unresolved mentions, unreadable (AC10), AI unavailable (AC11), cap reached (AC12), saving, saved with
  undo, pending sync.
- Preparing takes a few seconds: the progress text changes once ("Buscando los alimentos…") and a
  "Cancelar" returns to the add screen.
- Mobile-first (360–430 px), light and dark, touch targets of 44 px, the keyboard never covers
  "Preparar borrador" or "Añadir N alimentos".
- i18n (es reference + en): `food.shortcuts.*`, `food.describe.*`, `food.platePhoto.*`, `food.draft.*`,
  the reasons of AC10, `consent.points.*`.
- E2E (`apps/e2e`, mock backend): a sentence → draft → change a portion, replace a food, remove one,
  resolve a mention with quick add → save → totals on Food and Today → undo; a plate photo → draft with a
  "Probable" item removed → save; a non-food photo → unreadable → search; the cap message; offline
  disables both shortcuts, and a draft received online and saved offline syncs once after a reload.

## Safety & edge cases

- **Wrong portions.** A photo cannot weigh food; the draft says so (AC5), marks doubtful portions and is
  never saved without the user's tap. The plate eval (AC14) measures the error; if it misses the
  thresholds, the plate photo ships hidden until it passes.
- **`ed_soft_stop`.** The draft shows foods and portions without numbers, like the log (spec 005 AC18).
  Unlike the label photo (spec 006), both shortcuts stay: they put no numbers in front of the user. To
  confirm with the professional reviewer.
- **The app never judges the meal.** No comment on the plate, no "healthy" or "unhealthy", no advice:
  the AI output has no free text the user reads, only catalog foods and portions. Advice is spec 008.
- **Allergies are not checked** (spec 005): the draft lists what the user ate, not what to eat.
- **Prompt injection.** A sentence such as "ignora las instrucciones…" or text in the photo can only
  produce schema fields; unknown ids are dropped (AC9) and the mention text is shown as typed, never as
  an instruction.
- **Quantities.** Grams 1–2000 and servings ½–20 per item (spec 005), 15 items per draft, 150 items per
  day (spec 005). Liquids in ml follow spec 006 (products in ml keep their unit).
- **Alcohol.** Drinks are matched like any food; the catalog's values include their alcohol energy.
- **Minors (16–17) and pregnancy:** no change; this spec adds no targets and no advice.
- **Dates:** the draft is saved to the day the add screen is on (spec 005 date rules); a sentence that
  says "ayer" does not move it.

## Out of scope

- Daily feedback (spec 008).
- A microphone button and on-device speech recognition (E5b, ADR 004).
- Several meals or days from one sentence; reading the time or the meal from the sentence.
- Storing photos or sentences; learning from the user's corrections; a "my usual breakfast" memory
  (saved meals and AI memory come later).
- Creating a custom food from the draft (the unresolved mention offers search and quick add only).
- Packaged products in the photo (the barcode and label of spec 006 cover them).
- Restaurant menus, recipes with many steps, nutrition of home recipes by ingredient weights.
- Allergen checks, plan-based caps and `canUse()` (E5b / E6).

## Open questions

- **Tool loop or parse-then-search.** The spec uses a tool loop (BLUEPRINT §4). If the sentence eval
  shows the latency above about 5 s at the median, the alternative is one call that only splits the
  sentence into queries and quantities, with the match done by `searchFoods` and the alternatives shown
  as chips. Decide with the eval report, not before.
- **For the human:** weigh and photograph about 30 plates (instructions in
  `apps/api/evals/meal-photo/README.md`, written in the core step), the go-ahead to run both evals (well
  under 1 USD each), and the `ANTHROPIC_API_KEY` of spec 006 in `.env`.
- **For the professional reviewer:** the thresholds of AC14 (with n = 30 the 70 % figure has a margin
  of about ±16 points; a second set before shipping?); the "Probable" oil item of AC5 and the photo note
  ("una foto no ve el aceite…") for `ed_soft_stop` (the domain review suggests dropping probable items
  and a neutral note with the flag); keeping both shortcuts with `ed_soft_stop` (grams still show,
  quick add asks for kcal, and photographing every plate is itself monitoring; should frequent drafts
  be a soft signal?); the first serving as the default for a food said without a quantity (1 loncha
  de pavo is 10 g: a "typical portion" per food?); alcohol entries for users aged 16–17; whether
  "Ensalada mixta" of the catalog already includes its dressing.
- **For the human:** the catalog gaps of the domain review (fried egg with oil, croquetas, churros,
  salmorejo, horchata), in `docs/knowledge/catalog-review.md`.
- Whether to record how much the user changed each draft (items removed, portions changed) to improve
  the prompt. It needs a column or a table and a line in the consent text; not in this spec.

## Progress

- [x] contracts · [x] db · [x] core · [x] api · [x] client · [x] ui · [x] e2e
- Done (2026-11-17), one commit per step: contracts and consent text (`a476858`), migration `0008`
  (`65c3e44`), core (`667580f`), `@pt/ai` and API (`ea4904d`), client and mock (`81f6eb5`), the 135
  sentences of the eval (`7313599`), UI (`b648658`), E2E (`f28566c`).
- **Migration `0008_meal_draft_input_methods` is generated and not applied to dev.** It only adds
  `photo` and `text` to `food_input_method` (two `ALTER TYPE … ADD VALUE`). Apply it after `0007`.
- Tests by criterion: AC4–AC6, AC9 `core/food/meal-draft.test.ts`, `api/routes/foods/drafts.test.ts`
  and the prompt in `ai/prompts/meal/meal.test.ts`; AC7 (`portionForReplacement`, `draftTotals`) core;
  AC10–AC12, AC16 `drafts.test.ts` (401 and 403 for both routes, 400, 413, 429, 503, the caps per
  feature and per UTC day) and the mock in `api-client/src/drafts.test.ts`; AC11 (rounds, refusal,
  `max_tokens`, invalid output, the 20 s limit) `meal.test.ts`; AC17 `i18n/format.test.ts` and
  `CONSENT_VERSION` 2026-11-v5; AC1–AC8, AC10 on screen `apps/e2e/tests/meal-draft.spec.ts` (four
  journeys; the whole suite passes, 23 journeys). AC18 needs nothing new (ordinary items).
- Not covered by a test: the cap message on screen (AC12: the 429 is tested in the API and the mock);
  `ed_soft_stop` on the draft screen (it uses the same `showNumbers` as spec 005 AC18).
- AC13–AC15: the harness is `pnpm --filter @pt/api eval:meal-text` and `eval:meal-photo`
  (`apps/api/evals/meal-draft.ts`, READMEs in `meal-text/` and `meal-photo/`). **Not run**: it needs
  the API key, the dev database with `0008`, the go-ahead to spend, and for the photos the ~30
  weighed plates of the human. The 135 sentences were written by an agent that saw only the catalog;
  a human should review a sample (its judgement calls are in the commit and below).
- Checked on web with Playwright at 390 px (light and dark) and 1280 px, without console errors: the
  add screen with the shortcuts, the sentence, the draft with its marks, the portion sheet in draft
  mode, the photo draft.
- Left for the human: apply `0008`; the phone check in Expo Go (camera and library for the plate
  photo, the keyboard's dictation in "Describir", the keyboard over "Preparar borrador" and over the
  draft footer); weigh and photograph the plates; the go-ahead for both evals.
- Decisions taken during implementation:
  - **The tool shows short refs, not ids** (`f1`, `f1s2`): fewer tokens, and an id the tool never
    showed cannot come back. The API maps the refs back before `mealDraft`.
  - **One `search_foods` call takes all the queries** of a meal (up to 15, 5 foods each, with their
    servings and kcal per 100), so a normal draft needs two calls to the model: search, answer.
  - **Prompt caching** on the system prompt and the tool (one breakpoint). The prefix should be
    above the 512-token minimum of Haiku 5.5; the first eval run confirms it
    (`cache_read_input_tokens` on the second call).
  - **Model settings:** Haiku 5.5, effort `low`, 4096 max tokens, tool choice `auto` with a strict
    tool (forced tool use is not allowed on current models), structured output for the answer.
    Provisional until the evals run.
  - **The tool loop lives in `@pt/ai`** (`runStructuredToolLoop`): every call of a draft adds into one
    `ai_usage` row; a third tool round, a refusal, `max_tokens`, an invalid answer or the 20 s limit
    fail as `ai_unavailable`.
  - **A portion outside the limits is clamped and marked "Revisa la cantidad"** (confidence `low`),
    instead of turning the item into an unresolved mention.
  - **A quick add made from an unresolved mention joins the draft** and is saved with it (same undo),
    instead of being logged at once.
  - **"Cambiar alimento" keeps a serving with the same name, else the grams** (`portionForReplacement`).
  - **The undo of a saved draft is a new `FoodUndo` kind (`added`)**, shown on the add screen and on
    the Food tab.
  - `lib/labelPhoto.ts` became `lib/photo.ts` (`pickPhoto`), shared by the label and the plate.
  - The image helpers of the label route moved to `apps/api/src/images.ts` (base64 check, size, UTC
    day), shared with the plate photo.
  - The mock reads a sentence with simple rules (split at commas and "y", a leading count or grams)
    and any real photo as two fried eggs, chips and a probable oil.
  - BLUEPRINT §5 updated: no `meals` table in this slice.
- Domain review (`domain-reviewer`, 2026-11-17), fixed in the same change:
  - **Blocker: raw and cooked foods.** "Macarrones" ranked dry pasta first (≈350 kcal per 100 g
    against ≈140 cooked). The prompt now says that a plate is always as served (cooked or prepared
    food) and that grams of pasta, rice, legumes or cereals in a sentence are cooked unless "en
    crudo" is said. Eval case "80 g de espaguetis" now says "en crudo".
  - **Blocker: the probable oil.** The prompt's example (chips) already includes its frying fat, so
    the oil counted twice. The oil is now only from a photo and only on a plain food (salad, vegetables,
    an egg or meat "a la plancha"), never on a fried, battered or whole dish. **AC5 is amended
    accordingly** (it said "a visibly fried or dressed dish").
  - **Blocker: `core` enforces the probable item** (it copied the model's flag): kept only from a
    photo, only a fat of the catalog (curated keys `f-…`), at most 10 g, one per draft; otherwise
    dropped, never turned into an unresolved mention.
  - A count with a serving that is not the food's keeps the count on the first serving (it fell back
    to one serving); the 100 g placeholder of a food without servings, and portions over 4 of the
    largest servings or over 1500 kcal, are marked "Revisa la cantidad".
  - The prompt prefers the serving of one unit times the count ("2 kiwis" was at risk of 2 × "2 kiwis").
  - The draft warns that unresolved mentions are not added; in a sentence, an estimated amount
    (confidence `medium`) is marked "Revisa la cantidad".
  - Evals: the kcal reference uses the food that was matched (not always the first key); the plate eval
    counts a food as "big" by weight or by kcal (10 g of oil is 20 % of a plate's kcal), reports extra
    and probable items, and gains a gate on the **mean signed error, within ±10 %** (under-counting
    would make the adaptive loop of E5b lower the targets).
  - Not changed, for the catalog review: "huevo frito" is a synonym of "Huevo a la plancha" (fried
    without added fat), so a typed fried egg is under-counted by 40–60 kcal; the catalog lacks a fried
    egg with its oil, croquetas, churros, salmorejo and horchata ("croquetas" may match "croquetas de
    garbanzo", the falafel). Small errors in the eval data (ml counted as g for oils and sauces; 5 g of
    chorizo in a cocido) are not explicit cases and do not move the gates.
