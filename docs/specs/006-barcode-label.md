# 006 — Barcode scan, custom foods and label photo

- Status: approved (2026-11-16)
- Phase: E4, slice (b) of three (after spec 005). Slice (c), the plate photo and the sentence, gets its
  own spec.
- Tier: free. The label photo is the first AI call of the app; it has an abuse cap, not a plan cap.

## Problem / user story

As a user with a packaged product in my hand, I want to scan its barcode and log it with the values
of its label, so that I do not have to search for a generic food that only resembles it. When the
product is unknown, I want to add it once (by hand, or from a photo of its label) and find it again the
next time.

Stage E4 is done when "barcode totals are within ±5 % of a reference" (BLUEPRINT §7).

## Assumptions (to confirm in the review)

- **Open Food Facts (OFF) is read live, one product per scan, and cached.** The API asks OFF for a
  barcode the first time any user scans it and stores the product in `foods`. OFF allows this use ("1
  API call = 1 real scan by a user") and limits product reads to 15 per minute per IP. No bulk import
  in this slice: the dump of Spain is a follow-up if the limit or the hit rate turns out to be a problem
  (see Open questions).
- **A product the user adds is private to that user.** A food created by hand or from a label photo is
  visible only to its owner, also when it has a barcode. Nothing a user types reaches other users, and
  nothing is sent back to OFF in this slice.
- **The form is the main path and the photo fills it** (ADR 004). "Crear alimento" works with taps and
  a keyboard; "Leer la etiqueta con una foto" fills the same form with a draft the user checks and
  saves.
- **Products do not enter the shared search.** The search keeps the curated catalog and adds only the
  user's own foods and the products that user has logged before. Recents, favourites and "repeat
  yesterday" work with products as with any food.
- **Allergens are shown, not checked.** A product from OFF shows its declared allergens and traces as
  information. They are not matched against the profile: `allergies` is free text today, and a missed
  match would read as "safe". The app never says a product is free of anything.
- **Liquids keep their label unit.** A product labelled per 100 ml is stored per 100 ml and its
  portions are shown in ml. Energy is computed the same way (quantity × value / 100).
- **The barcode is read by the camera on the phone.** Typing the number is always available, and it is
  the only path where the camera cannot read barcodes (to verify on web during implementation: the
  Expo SDK 58 docs list web support without saying which barcode types work).
- **Label reading is free with a cap of 20 photos per user per day** (abuse guard; BLUEPRINT §3 gives it
  to both plans).
- **Consent changes.** The current text says that no AI provider processes the user's data. The label
  photo is sent to Anthropic, so the text and `CONSENT_VERSION` change and consent is asked again.

## Acceptance criteria

### Barcode

- **AC1** — Given the add screen, then a "Escanear" button sits beside the search field. Tapping it
  opens the scanner: the camera with a frame, a torch button and "Introducir el código". Given the
  camera permission was never asked, then the screen explains why before the system prompt; given it
  is denied, then it shows how to enable it and keeps "Introducir el código". _(free)_
- **AC2** — Given a code read by the camera or typed, then `normalizeBarcode` (`@pt/core`) accepts
  EAN-13, EAN-8, UPC-A and UPC-E with a valid check digit and returns one canonical form (UPC-A as
  EAN-13 with a leading 0). An invalid read is ignored and the camera keeps scanning; an invalid typed
  code shows an error under the field. The same code is looked up once, not on every frame. _(free)_
- **AC3** — Given a valid code, then `GET /foods/barcode/{code}` answers in this order: the user's own
  food with that barcode; the product cached from OFF less than 90 days ago; a live read of OFF, which
  is stored and returned. The portion sheet of spec 005 opens with the product's name and brand, and
  the item is saved with `inputMethod: 'barcode'`. _(free)_
- **AC4** — Given an OFF product, then it is accepted only with a name and with kcal (or kJ, converted
  with 4.184), protein, carbohydrates and fat per 100 g or 100 ml; fiber is optional. Values outside
  0–900 kcal, 0–100 g per macro, or macros adding to more than 105 g per 100 g, reject the product as
  incomplete. The name is the Spanish one, else the generic one. Servings: "1 ración (N g)" from the
  serving size and "1 envase (N g)" from the net quantity, when OFF gives them in g or ml within 1–2000;
  with neither, the sheet opens on grams. The values are stored as OFF gives them, never mixed with
  another source. _(free)_
- **AC5** — Given a product whose energy differs by more than 25 % from 4·P + 4·C + 9·F (+ 2·fiber), then
  the portion sheet adds "Comprueba estos valores con el envase". Every OFF product shows "Datos de Open
  Food Facts" with a link to its product page, and its allergens and traces when OFF lists them
  ("Alérgenos según Open Food Facts: leche, soja · Trazas: frutos secos. Comprueba siempre el envase").
  With no allergen data it says so ("Open Food Facts no indica alérgenos para este producto. Eso no
  significa que no los tenga"). _(free)_ _Amended on 2026-11-16 after the domain review: the first
  version showed nothing without data, and next to products that show their allergens an empty space
  reads as "none". To confirm with the human._
- **AC6** — Given a code OFF does not know, or a product rejected by AC4, then the screen says "No
  tenemos este producto" and offers: "Leer la etiqueta con una foto", "Rellenar a mano" (both keep the
  barcode), "Añadir rápido" and "Escanear otro". A miss is remembered for 24 hours, so the same code
  does not reach OFF again in that time. _(free)_
- **AC7** — Given OFF does not answer in 4 seconds, or answers 429 or 5xx, then the API returns 503
  `lookup_unavailable`, the screen offers "Reintentar" and the options of AC6, and nothing is cached.
  Given more than 10 live lookups from one user in a minute, then the API returns 429. _(free)_
- **AC8** — Given no connection, then a code that matches a food in the offline cache (recents,
  favourites, own foods) opens its portion sheet; any other code shows that scanning needs a
  connection. _(free)_

### Custom foods

- **AC9** — Given "Crear alimento" (from the no-results state of the search, from AC6, or from "Mis
  alimentos"), then the form asks for a name (1–80), an optional brand (0–60), "por 100 g" or "por 100
  ml", kcal, protein, carbohydrates and fat (required), fiber (optional) and an optional serving (a
  name and its grams or ml). The barcode shows read-only when the form came from a scan. _(free)_
- **AC10** — Given the form, then `validateCustomFood` (`@pt/core`) applies the ranges of AC4 and blocks
  saving outside them; given an energy difference above 20 % (rule of spec 005 AC10), then it asks for
  confirmation before saving. _(free)_
- **AC11** — Given a saved custom food, then the portion sheet opens for it, and from then on it shows
  in the search (by name and brand), in the recents and favourites, and when its barcode is scanned
  (AC3). It is written with `PUT /me/foods/{id}` (client id, idempotent) and works without a
  connection: the food and its first item wait in the same queue, in order. _(free)_
- **AC12** — Given the add screen, then "Mis alimentos" lists the user's foods; each can be edited or
  deleted (undo for 5 seconds). Editing changes later logs only; deleting keeps the logged items with
  their snapshots (spec 005 AC9). A user can keep at most 200 foods. _(free)_
- **AC13** — Given another user's custom food, then no route returns it and an item cannot point to it
  (404). _(free)_

### Label photo

- **AC14** — Given "Leer la etiqueta con una foto", then the user takes a photo or picks an image; the
  app resizes it on the device (longest side 1568 px, JPEG) and sends it to `POST /me/foods/label-scan`.
  While it is read, the form shows progress and stays usable. _(free)_
- **AC15** — Given a readable label, then Claude Haiku 5.5 returns `LabelReadingSchema` (a structured
  output): the printed values and their column (per 100 g, per 100 ml or per serving with its size),
  energy in kcal and/or kJ, and the product name and brand if they are printed. It transcribes; it never
  estimates a value that is not printed (null instead). `labelDraft` (`@pt/core`) turns the reading
  into values per 100 g or ml (per-serving values are converted with the serving size, kJ with 4.184,
  "trazas" and "< x" become 0 as in spec 005 AC2) and applies the ranges of AC4. _(free)_
- **AC16** — Given the draft, then it fills the form of AC9: the fields the photo filled are marked "leído
  de la foto", the fields it could not read are empty and marked, and nothing is saved until the user
  taps "Guardar". The first item logged from that food has `inputMethod: 'label'`. _(free)_
- **AC17** — Given a photo that is not a nutrition label, or cannot be read, then the answer is
  `unreadable` with a reason (not a label, blurry, cut off) and the form stays empty with "Repetir
  foto". Given a refusal, an invalid output or an error from the model, then 503 `ai_unavailable` and
  the form stays usable by hand. _(free)_
- **AC18** — Given the 20th read of the day (UTC) by a user, then the next one returns 429
  `ai_cap_reached` and the screen says the form can be filled by hand. Every call writes one `ai_usage`
  row (feature `label_scan`, model, tokens, cost, latency, status). _(free)_
- **AC19** — Given a label read, then the image lives only in the memory of the request: it is not
  written to disk, storage, logs or `ai_usage`. The prompt contains the image and the locale, and no
  data of the user. Text printed on the label is treated as data: the output can only be the fields of
  the schema, which `core` validates. _(free)_
- **AC20** — Given the label eval (`packages/ai/evals/label/`, at least 30 photos of labels sold in
  Spain with their values typed by hand: two columns, kJ and kcal, curved or shiny packs, several
  languages, per 100 ml, plus at least 5 photos that are not labels or cannot be read), then at least 95
  % of the readable photos give every required value exactly, no unreadable photo gives values, and the
  report states the cost per call. The eval runs before the feature ships and on every change of the
  prompt or the model. _(free)_

### Data and privacy

- **AC21** — Given the consent text, then it says that label photos are read by an AI provider
  (Anthropic), are not stored and travel without the user's health data, and that the foods the user
  creates are stored; `CONSENT_VERSION` changes and consent is asked again (spec 002 flow). _(free)_
- **AC22** — Given "Download my data", then it includes the user's custom foods; given "Delete my
  account", then they are deleted (the schema-driven test covers the new column). Cached OFF products
  are catalog data and are not exported. _(free)_
- **AC23** — Given "Fuentes de datos", then it lists Open Food Facts with the Open Database License and
  links to both. _(free)_
- **AC24** — Given the reference set of 20 real products (recorded OFF answers in
  `apps/api/src/off/__fixtures__/`, with the label values typed by hand), then the kcal and macros of
  one serving computed by the app are within ±5 % of the label for every product accepted by AC4 (the
  E4 criterion). _(free)_

## Data changes

| Table             | Column               | Type                                             | Notes                                                               |
| ----------------- | -------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| foods             | brand                | text null                                        |                                                                     |
|                   | barcode              | text null, index                                 | canonical form of AC2                                               |
|                   | owner_id             | uuid null FK profiles `on delete cascade`        | set for a custom food; unique (owner_id, barcode)                   |
|                   | quantity_unit        | enum `quantity_unit` (g, ml) default g           | unit of the "per 100" values and of the portions                    |
|                   | allergens, traces    | text[] default `{}`                              | OFF tags (`en:milk`); empty for other sources                       |
|                   | origin               | enum `food_origin` (catalog, off, manual, label) |                                                                     |
|                   | fetched_at           | timestamptz null                                 | when OFF was read (90 days, AC3)                                    |
| meal_items        | quantity_unit        | `quantity_unit` default g                        | snapshot, so a deleted product still shows "250 ml"                 |
|                   | input_method         | enum gains `barcode`, `label`, `custom`          | `custom`: first log of a food created by hand                       |
| barcode_misses    | barcode / checked_at | text PK / timestamptz                            | AC6; no user data                                                   |
| knowledge_sources | (rows)               |                                                  | `open-food-facts` (ODbL, attribution es/en) and `user` (not listed) |

- RLS: `foods` is readable where `owner_id is null or owner_id = auth.uid()`, and `food_servings`
  where its food is readable. `barcode_misses` has no policy (API only). No write policies: every write
  goes through the API.
- OFF products use `source = 'open-food-facts'`, `source_id` = the barcode and `key = 'off-<barcode>'`;
  custom foods use `source = 'user'` and `key = 'user-<id>'`.
- Migration `0007`. The two `knowledge_sources` rows are upserted by the importer.

## API contracts

- Schemas to add to `@pt/contracts` (`food.ts`): `BarcodeSchema`, `BarcodeParamSchema`,
  `QuantityUnitSchema`, `CustomFoodUpsertRequestSchema`, `CustomFoodsResponseSchema`,
  `LabelScanRequestSchema` (`image: { mediaType: jpeg | png | webp, data: base64 }`, `locale`),
  `LabelReadingSchema` (AI output), `LabelScanResponseSchema` (`ok` with the draft and the fields
  read, or `unreadable` with a reason), `LABEL_SCAN_LIMITS` (4 MB, 20 per day).
- Schemas to change: `FoodSchema` (`brand`, `barcode`, `unit`, `allergens`, `traces`, `owned`,
  `sourceUrl`, `energyMismatch`), `MealItemSchema` (`unit`), `FoodInputMethodSchema` and
  `MealItemUpsertRequestSchema` (new input methods), `RecentFoodSchema` unchanged in shape,
  `ExportResponseSchema` (`customFoods`), `CONSENT_VERSION`, error codes `product_not_found`,
  `product_incomplete`, `lookup_unavailable`, `ai_cap_reached`, `ai_unavailable`, `image_too_large`,
  `food_limit_reached`.
- `GET /foods/barcode/{code}?locale` → 200 / 400 / 401 / 403 / 404 (`product_not_found`,
  `product_incomplete`) / 429 / 503
- `GET /me/foods` → 200 / 401 / 403
- `PUT /me/foods/{id}` → 200 / 400 / 401 / 403 · `DELETE /me/foods/{id}` → 200 / 401 / 403
- `POST /me/foods/label-scan` → 200 / 400 / 401 / 403 / 413 / 429 / 503
- `GET /foods/search` also searches the caller's own foods and the products they have logged.
- Every route needs the current consent.
- `@pt/core` (test-first): `normalizeBarcode`, `productFromOff` (AC4, AC5: pure, on the parsed OFF
  answer), `validateCustomFood`, `labelDraft`, and the unit in `formatPortion`.
- `apps/api`: `off/` (client with an injected `fetch`, the `User-Agent` OFF asks for, the 4 s limit) and
  the label service; `@pt/ai`: `FEATURES.label_scan` (Haiku 5.5), the prompt in `prompts/label/` and
  the eval.
- `@pt/api-client`: methods, query options, offline mutations for custom foods, and the mock backend
  with 10 products by barcode, one unknown code, one incomplete product and a fixed label reading.

## UI

- Routes: `food/scan` (scanner; `.native.tsx` with the camera, `.web.tsx` with the code field unless
  the camera reads EAN on web), `food/custom?barcode&id` (the form, also for editing), "Mis alimentos"
  as a section of `food/add`.
- Components: `BarcodeScanner`, `BarcodeField`, `ProductNotFound`, `CustomFoodForm`, `LabelPhotoButton`,
  `AllergenNote`; `PortionSheet` gains the brand, the unit and the notes of AC5.
- States: permission (not asked, denied), scanning, looking up, found, not found, incomplete, lookup
  failed, offline, reading the label, unreadable, cap reached, AI unavailable, saved, pending sync.
- New app dependencies (`expo install`): `expo-camera`, `expo-image-picker`, `expo-image-manipulator`.
  All three run in Expo Go. The iOS camera text goes in the config plugin, in es and en.
- i18n (es reference + en): `food.scan.*`, `food.product.*`, `food.custom.*`, `food.label.*`, the new
  error codes, `sources.*`, `consent.points.*`, the export description.
- E2E (`apps/e2e`, mock backend, typed code): log a product by its code; an unknown code → fill the form
  by hand → log it → find it by the same code and by search; an unknown code → label reading → check the
  draft → save and log; delete a custom food and keep its logged item; a custom food created without
  connection that syncs once.

## Safety & edge cases

- **Allergens.** OFF data is written by volunteers and can be wrong or missing. The note of AC5 always
  ends with "Comprueba siempre el envase", and missing data shows nothing instead of "sin alérgenos".
- **Wrong values.** OFF values are not reviewed by us; AC4 rejects impossible ones and AC5 warns about
  doubtful ones. A label read by the AI is never saved without the user seeing every value (AC16).
- `ed_soft_stop` (spec 005 AC18): the portion sheet shows no numbers for products either. The custom
  food form shows the numbers the user types, as the quick add does.
- Alcoholic drinks fail the energy check (alcohol has 7 kcal/g); they get the note of AC5, not a
  rejection.
- Codes that start with 2 (weighed in the shop) and codes of non-food products give "No tenemos este
  producto".
- The label photo may show more than the label. The app asks to frame only the table; the image is not
  kept (AC19).
- Limits: quantity 1–2000 g or ml per item (spec 005), 200 custom foods, image up to 4 MB after the
  resize.
- Minors (16–17) and pregnancy: no change; this spec adds no targets and no advice.

## Out of scope

- Plate photo, sentence shortcut, daily feedback (slice (c)).
- A bulk import of Open Food Facts, branded products in the shared search, sending products or photos
  back to Open Food Facts.
- Sharing a user's food with other users; a review queue for user foods.
- Matching allergens against the profile (it needs structured allergies; E7 at the latest).
- Micronutrients, sugar, salt, saturated fat, Nutri-Score, NOVA, ingredients.
- Density conversion between g and ml; ounces.
- Plan-based AI caps and `canUse()` (E5b / E6).

## Open questions

- **ODbL share-alike (the human, before the beta).** OFF rows stay apart (`source`), unchanged and
  attributed, so they can be offered under the ODbL on request. Whether that is enough for the rest of
  the catalog to stay outside the share-alike is a legal reading that OFF's pages do not state.
- **OFF limits.** 15 product reads per minute per IP, and the API's IP may be shared on Vercel. The
  phone check records the hit rate and the failures of 20 products scanned at home; if either is poor,
  the next step is the nightly dump filtered to products sold in Spain.
- **For the human:** an Anthropic API key in the API's `.env`, a contact email for OFF's `User-Agent`
  (`AppName/Version (email)`), the 30 label photos and the 20 reference products, and the go-ahead to
  run the label eval (it spends API money, well under 1 USD).
- For the professional reviewer: the ranges of AC4, the 25 % note of AC5, treating ml as the label
  gives it, and the allergen note. Also, from the domain review: a product sold by volume but labelled
  per 100 g (ice cream) is read per 100 ml, because Open Food Facts does not say which of the two its
  values are (an error of 40–80 % that only the package settles); and whether, with `ed_soft_stop`,
  the custom-food form should exist at all, since editing a food shows its numbers again.
- **For the human:** confirm the amended AC5 (the "no allergen data" line) and the label photo hidden
  with `ed_soft_stop`. Both make the app more cautious than the approved text; say so if you prefer
  the first version.

## Progress

- [x] contracts · [x] db · [x] core · [x] api · [x] client · [x] ui · [x] e2e
- Done so far (2026-11-16), one commit per step: contracts (`bc67d47`), db schema and migration
  `0007` (`bcd8c74`), core (`d5335c0`), API and `@pt/ai` (`fc8574d`), client and mock backend
  (`7deaa4c`), UI (`3f4cd10`), E2E (`3e266ed`).
- Client (2026-11-16): `@pt/api-client` has `foodByBarcode`, `customFoods`, `saveCustomFood`,
  `deleteCustomFood` and `scanLabel`; `foods.ts` adds `customFoodsQueryOptions`,
  `foodByBarcodeQueryOptions` (fetched on demand, a "not found" is not retried),
  `cachedFoodByBarcode` (AC8) and `registerCustomFoodMutations` (`foodKeys.saveFood`,
  `foodKeys.deleteFood`, in the queue of the food log, so a food made offline is sent before its
  first item). The mock backend (`mock/products.ts`, storage key `pt.mock-db.v6`) serves ten
  recorded products, custom foods and a fixed label reading with the rules of the API. Tests:
  `api-client/src/products.test.ts` (AC3, AC8, AC11, AC12 and the mock).
- UI (2026-11-16): the add screen (`food/add`) gains "Escanear" beside the search, "Crear alimento"
  and the "Mis alimentos" section. New components: `BarcodeScanner` (`.tsx` for the phone: camera
  with a frame, a torch button and the permission states; `.web.tsx`: the typed code),
  `BarcodeField`, `ProductNotFound`, `CustomFoodForm` (with the label photo), `ProductNotes` (source,
  "check the package", allergens and traces). `PortionSheet` shows the brand and the unit (g or ml);
  `FoodRow` shows the brand. `lib/labelPhoto.ts` takes or picks the photo and resizes it to 1568 px;
  `useDeferredFoodDelete` holds a delete for the 5 seconds of its undo. Dependencies:
  `expo-camera`, `expo-image-picker`, `expo-image-manipulator` (all in Expo Go), with the permission
  texts in `app.json` and `apps/app/locales/{es,en}.json`. Checked on web with Playwright at 390 px
  (light and dark) and 1280 px, without console errors: a product by its code, a drink in ml, the
  energy note, an unknown and an incomplete code, the form with its confirmation, an own food in the
  lists.
- E2E (2026-11-16): `apps/e2e/tests/barcode.spec.ts`, five journeys on the mock backend with the code
  typed: products in grams and in millilitres with their notes, and a wrong check digit (AC1–AC5); an
  unknown code filled by hand, logged, and found again by code and by search (AC6, AC9–AC11); a label
  photo that fills the form, an unreadable one, an edited value and the save (AC6, AC14–AC17, and the
  metering of AC18); edit, delete with undo and without it (AC12); a food created offline that
  survives a reload and syncs before its item (AC8, AC11). The whole suite passes (19 journeys).
- Not covered by a test: the camera and its permission states (AC1, phone only); the cap message on
  screen (AC18: the 429 is tested in the API and in the mock); `ed_soft_stop` on screen for a product
  (the portion sheet uses the same `showNumbers` as spec 005 AC18).
- Left for the human: the phone check in Expo Go (the camera reads EAN-13, EAN-8 and UPC codes; the
  torch; the permission asked, denied and re-enabled in the settings; the label photo from the camera
  and from the library; the keyboard over the custom-food form; 20 products of the pantry, with the
  hit rate of Open Food Facts). `expo-doctor` reports two patch mismatches that were there before
  this spec (`expo` 58.0.24 → 58.0.25, `expo-sqlite` 58.0.16 → 58.0.17).
- **Migration `0007_barcode_custom_foods` is generated and not applied to dev yet.** It only adds:
  two enums, three values of `food_input_method`, the new columns (with defaults), `barcode_misses`,
  and the stricter `select` policies of `foods` and `food_servings`. After applying it, run
  `pnpm --filter @pt/db import:foods` once: it upserts the `open-food-facts` and `user` rows of
  `knowledge_sources`, which products and custom foods reference. Then
  `pnpm --filter @pt/api test:integration` covers the new SQL (custom food, product, miss, the
  `owner_id` cascade of AC22).
- Tests by criterion so far: AC2 `core/food/barcode.test.ts`; AC4, AC5 `core/food/product.test.ts`;
  AC9, AC10, AC16 (the form and the draft) `core/food/custom-food.test.ts`; AC15
  `core/food/label.test.ts` and `ai/prompts/label/label.test.ts`; AC3, AC6, AC7, AC11–AC13, AC17–AC19,
  AC22 (export), AC23 `api/routes/foods/products.test.ts` (401 and 403 for every route); AC7 (the
  time limit) and AC24 `api/off/client.test.ts`.
- AC24: 20 answers of Open Food Facts were recorded on 2026-11-16
  (`apps/api/src/off/__fixtures__/products/`). 18 are accepted and 2 rejected (Nesquik gives values
  only "as prepared"; the mineral water has no table). The reference (`reference.json`) holds Open
  Food Facts' own per-serving values for the 16 products that state a serving (`verified: false`):
  it proves the app's arithmetic, not that Open Food Facts matches the package. **Left for the human:**
  check those values on the real packages, set `verified`, and type the label of the two products
  without a serving (Nutella, Hacendado peanut butter).
- AC20: the harness is `pnpm --filter @pt/api eval:label-scan` (`apps/api/evals/label/README.md`
  explains the photos and `cases.jsonl`). **Not run:** it needs the human's 30 photos, the API key and
  the go-ahead to spend.
- Left for the human in `.env` (a hook blocks me): `ANTHROPIC_API_KEY` (without it a label read
  answers 503 and the form is filled by hand) and `OFF_CONTACT_EMAIL` (the contact of the
  `User-Agent` Open Food Facts asks for; without it the API warns at start and sends the app name
  only). Both should also be listed in `.env.example`.
- Domain review (`domain-reviewer`, 2026-11-16), fixed in the same change:
  - **Blocker: the unit of a product.** A product became "ml" when its package or its serving was in
    ml, and both sizes were then read in that unit. A cocoa powder sold in grams with a serving of
    "200 ml prepared" would have opened on a serving about 15 times too large. Now the unit is the one
    the product is sold by (else the unit of its serving), and a size in the other unit is dropped.
  - **Declared allergens are never dropped.** Tags that were not `xx:word` disappeared (a real
    fixture has `de:Schalenfrüchte (keine Erdnüsse)` among its traces). Every tag is kept and shown;
    one the app cannot translate shows as the source has it.
  - **AC5 amended** (see above): a product without allergen data says so. "Alérgenos declarados"
    became "Alérgenos según Open Food Facts" (it is not the manufacturer's declaration), and the
    legal term "frutos de cáscara" gained "(frutos secos)".
  - **The label prompt** now covers the "as prepared" column, the reference-intake column, a table
    with several products and the dot of thousands ("1.046 kJ"). `labelDraft` leaves the energy empty
    when the kcal and the kJ it read disagree by more than 5 %.
  - **`ed_soft_stop`:** the label photo is not offered with the flag (it would put numbers in front
    of the user), on the form and on the not-found screen; the form by hand stays, as the quick add
    does. The confirmation of the form no longer names the calories.
  - An energy a hair above 900 kcal after a kJ conversion (an oil of 3766 kJ) counts as 900.
  - No finding on the constants (4/4/9, fibre 2, 4.184), the ranges or the tone of the copy.
- Decisions taken during implementation:
  - **Scanning and creating a food are steps of the add screen**, not the routes `food/scan` and
    `food/custom` of "UI" above: the search, the meal and the day stay as they were, as with the
    portion sheet in spec 005.
  - **On web the code is typed.** The Expo docs do not say which barcode types the camera reads in a
    browser, so the camera scanner is for the phone until a test in a real browser shows it works.
  - **"Editar" and "Borrar" of an own food are in its portion sheet**, one tap from "Mis alimentos",
    so the list stays as clean as the recents at 360 px.
  - **The delete of an own food is sent after the 5 seconds of its undo** (or when the screen
    closes): once the API deletes a food it unlinks the logged items, and an undo could not link them
    again.
  - **"Leer la etiqueta con una foto" on the not-found screen takes the photo at once** and the form
    opens reading it; inside the form the same button repeats the photo. A second button picks an
    image from the library.
  - **The mock calls "not a label" any image under 2000 base64 characters** (a few pixels), so the
    E2E can show the unreadable state with a real, tiny JPEG.
  - No haptic feedback on a read (no haptics library is installed).
  - **`Food.origin` replaces the `owned` flag** of the contracts above (`catalog`, `off`, `manual`,
    `label`); `isOwnFood` in core reads it. No `origin` column was planned for the API response.
  - **The image limit is 3 MB, not 4 MB** (`LABEL_SCAN_LIMITS.imageBytesMax`): in base64 it is 4 MB,
    and the API's host (Vercel) rejects requests above 4.5 MB. A photo resized to 1568 px is well
    under 1 MB.
  - **The policies keep their names** (`foods_select_all`, `food_servings_select_all`): a rename makes
    drizzle-kit ask a question that needs a terminal. Only their `using` changed.
  - **The catalog cache holds only the curated foods.** Products and own foods are read per request
    (`resolveFoods`), so nothing of one user stays in memory shared by all.
  - **A product cached more than 90 days ago is still returned** when Open Food Facts does not answer,
    is not asked (limit reached) or no longer knows it. A stale label is better than "try again".
  - **The limit of 10 live lookups per minute lives in one API instance** (in memory). With several
    instances the real limit is higher: it stops a loop in one client, it is not an exact quota.
  - **In-store codes (EAN-13 starting with 2) never reach Open Food Facts.**
  - **An unknown code is HTTP 404 at Open Food Facts** (seen on 2026-11-16), and `status: 0` with
    HTTP 200 in their docs: the client treats both as "not found". Their search endpoint answered
    503 with an HTML page the same day: anything that is not their JSON counts as "unavailable".
  - **"trazas" and "< x" become 0 in the prompt**, not in `labelDraft`: the reading is numbers only.
  - **The prompt carries no locale**, only the image and a fixed instruction: the reading does not
    depend on the user's language, and less data leaves the API.
  - **Model settings:** Claude Haiku 5.5, effort `low`, 2048 max tokens (adaptive thinking counts
    towards them), no sampling parameters (the model rejects them). Provisional until the eval runs.
    The system prompt is too short to be cached, so there is no cache breakpoint.
  - **The eval lives in `apps/api/evals/`**, not in `packages/ai/evals/`: it needs `@pt/core`
    (`labelDraft`), which only `apps/api` may combine with `@pt/ai`.
  - **One food per barcode and user**: a second custom food with the same barcode is rejected (400
    `barcode: already_used`), so a scan always has one answer.
  - `PUT /me/foods/{id}` answers 404 for an id that is a catalog food, a product or another user's
    food; `DELETE` answers 204 also when nothing was deleted.
  - `GET /foods/sources` leaves out the `user` source (a technical row for the foreign key).
  - The serving of a custom food has a client id, so the first item can use it before the sync.
