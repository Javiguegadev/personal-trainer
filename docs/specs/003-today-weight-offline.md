# 003 — Tab shell, "Today", weight log and offline-safe writes

- Status: done (2026-11-13)
- Phase: E2b (second of two specs; 002 covered the job, the weekly training and `targets-v2`)
- Tier: free

## Problem / user story

As a user who weighs myself in the bathroom, often without coverage, I want to note my weight in two taps
from the first screen and see where it is heading, so that I can follow my progress and my targets follow my
current weight.

The app today has one Home screen with buttons. Stages E4 and E5 need a place to live (tabs), a first
screen that grows with them ("Today") and a way to write data that survives a bad connection.

## Decisions taken with the human (2026-11-12 and 2026-11-13)

- **A new weight changes the calorie targets, and the app says so.** The latest logged weight is the
  weight the targets use. When a new entry changes them, the app shows the old and the new calories.
  (First answer, 2026-11-12: "it is only recorded". Changed by the human on 2026-11-13.)
- **One weight entry per day.** A second entry on the same day replaces the first.
- **Three tabs now: Today · Progress · Profile.** Food and Training become tabs when stages E4 and E5
  ship. No "coming soon" screens.

## Assumptions (confirmed by the human on 2026-11-13)

- **The entry is addressed by its day** (blueprint §5: daily signals are one row per user and day). The
  resource is addressed by its date, `PUT /me/weights/:localDate`,
  which is idempotent by itself, so it needs no client-generated id. Client ids arrive with meals (E4).
- **The weight entry is typed once and then adjusted with taps**: the field opens with the last weight
  and has −0.1 / +0.1 buttons (−0.2 / +0.2 lb in imperial).
- **The trend is a 7-day average**, shown from 3 entries in the last 7 days. The raw entries are always
  listed.
- **A low BMI reached through the log removes the deficit, with its notice.** The human asked for "only
  the notice" on 2026-11-13. Since a new weight now recomputes the targets, the existing rule of spec 001
  (BMI below 20, or 22 from 70 years: no deficit, plus the low-BMI notice) applies by itself. Showing the
  notice while keeping the deficit would mean switching that safety rule off for logged weights, so the
  spec keeps the rule as it is.
- **The targets follow single readings**, so they can move by 10–20 kcal from one day to the next with
  normal swings of weight. The notice appears only when the calories actually change.
- **A "losing fast" notice** appears when the 7-day average falls more than 1 % per week (AC24). The
  threshold is provisional until a professional reviews it.
- **Protected profiles see less.** With `ed_soft_stop` or pregnancy, "Today" does not invite the user to
  weigh in and Progress shows the entries without the average, the change per week or the distance to
  the target weight. Ages 16–17 also get the plain link instead of the invitation. The log itself stays
  available to everyone.
- **A reading far from the last one asks for confirmation** (more than 3 % away from the latest entry of
  the previous 7 days), to catch typing mistakes.
- **"Today" shows what exists**: the targets, the weight card and the planned training of the week.
  "Remaining calories" and the quick actions for a meal or a session arrive with E4 and E5.
- **Signing out clears the device**: the offline cache and the pending writes are deleted. If writes are
  pending, the app asks before signing out.

## Acceptance criteria

### Tab shell

- **AC1** — Given a signed-in user with a completed onboarding, then the app shows three tabs, Today,
  Progress and Profile, on iOS, Android and web; the selected tab is announced to screen readers and is
  not shown by colour alone; a reload or a deep link keeps the tab. _(free)_
- **AC2** — Given the Profile tab, then it lists "My details" (the profile form of spec 002), "Privacy and
  data", and "Sign out"; the routes `settings/profile` and `settings/privacy` keep working. _(free)_

### Today

- **AC3** — Given "Today", then it shows the date, the daily targets (calories and macros, with the safety
  notices of spec 002), the weight card and a line with the planned training of the week (sessions and
  minutes, or "no training planned"). _(free)_
- **AC4** — Given no weight entry for today, then the weight card shows the last weight with its date and
  a "Log today's weight" button. Given an entry for today, then it shows that weight and an "Edit"
  button. Given a profile with `ed_soft_stop`, `pregnancy` or `teen_limited`, then the card shows the last
  weight and a plain "Weight log" link, without inviting the user to weigh in. _(free)_
- **AC5** — Given "Today" opened without a connection, then it shows the last data received (targets,
  weight, training) and an "offline" indicator, not an error. _(free)_

### Weight log

- **AC6** — Given the weight sheet, then the field opens with the last weight, has −0.1 / +0.1 kg buttons
  (−0.2 / +0.2 lb in imperial), and the day defaults to today with chips for the 6 days before. The user
  saves with one tap. _(free)_
- **AC7** — Given a weight outside 30–300 kg, a day in the future, or a day more than 5 years ago, then
  the form shows a field error and the API returns 400. Given a weight more than 3 % away from the latest
  entry of the previous 7 days, then the sheet asks for confirmation before saving ("79.6 → 70.6 kg, is
  that right?"). _(free)_
- **AC8** — Given an entry for a day that already has one, when the user saves, then the new weight
  replaces it and there is still one row for that day. _(free)_
- **AC9** — Given an entry, when the user deletes it and confirms, then it disappears from the list, the
  chart and the trend. Deleting an entry that no longer exists succeeds. _(free)_
- **AC10** — Given a saved weight entry that is the user's most recent one (by day), then
  `profiles.weight_kg` takes that weight and the profile is evaluated again with it, in the same
  transaction: the safety rules of specs 001 and 002 and `targets-v2`. Given different targets, then a
  new targets row is stored and the old one is closed with `valid_to`; given the same targets, nothing
  else changes. _(free)_
- **AC11** — Given an entry that changed the targets, then the app shows a notice with the old and the
  new calories ("Your daily calories go from 2450 to 2430 kcal with your new weight") and a link to "How
  is this calculated?". Given an entry that did not change them, no notice is shown. Given a profile
  without numeric targets (pregnancy), nothing is said about calories. _(free)_
- **AC12** — Given a new weight that puts the BMI below the low-BMI threshold of spec 001, then the
  deficit is removed (applied goal "maintain"), the profile stores `low_bmi`, and the notice of AC11 comes
  with the low-BMI notice. Given a later weight above the threshold, then the requested goal applies
  again. `ed_soft_stop` stays sticky whatever the weight. _(free)_
- **AC13** — Given an entry for a day before the user's most recent entry, or the deletion of such an
  entry, then the targets do not change. Given the deletion of the most recent entry, then the targets
  are recomputed with the entry that is now the most recent; with no entries left, the profile weight
  and the targets stay as they are. Given the profile form, then its weight field opens with the latest
  logged weight, and saving it with another weight stores that weight as the entry of the user's current
  day. _(free)_

### Progress

- **AC14** — Given the Progress tab, then it shows a chart of the last 90 days (entries and the 7-day
  average), with 30 / 90 / 365-day chips, and below it the list of entries, newest first, each with edit
  and delete. The chart has a text alternative. Weights are shown in the user's units. _(free)_
- **AC15** — Given at least 3 entries in the last 7 days and 3 in the 7 days before, then Progress shows
  the 7-day average and its change per week ("−0.4 kg per week"). With fewer entries it shows the last
  weight and a neutral explanation ("the trend appears with 3 entries in a week"), without counting the
  entries that are missing. Given `ed_soft_stop` or `pregnancy`, then Progress shows only the list and the
  raw points: no average line, no change per week and no explanation of what the trend needs. _(free)_
- **AC16** — Given a target weight and none of the flags `ed_soft_stop`, `pregnancy`, `teen_limited`,
  `low_bmi` or `low_target_bmi`, then Progress shows the distance from the 7-day
  average (or from the last weight) to it, in neutral wording. Given one of those flags, or no target,
  the line is not shown. Given a 7-day average that reached or passed the target in the direction of the
  goal, then the line becomes "target reached" with a link to review the goal in the profile. _(free)_
- **AC17** — Given no entries, then Progress shows an empty state with a "Log your weight" button.
  _(free)_

### Offline-safe writes

- **AC18** — Given no connection, when the user saves or deletes a weight, then the change appears at
  once marked "waiting to sync", and it is sent when the connection returns, also after the app was
  closed and opened again in between. _(free)_
- **AC19** — Given a write that was sent but whose answer was lost, when it is sent again, then the
  database has one row for that day with that weight (`PUT` and `DELETE` are idempotent). _(free)_
- **AC20** — Given two writes for the same day made on different devices, then the one recorded later on
  its device (`recordedAt`) is kept, whatever the order of arrival; the API answers 200 with the stored
  entry, and the app shows that entry. _(free)_
- **AC21** — Given a queued write that the API rejects (400), then the optimistic change is undone and
  the user sees why. Given a network error or a 5xx, then the write stays queued and is retried. _(free)_
- **AC22** — Given sign-out or account deletion, then the offline cache and the queue are removed from
  the device. Given pending writes, sign-out first asks for confirmation and says how many would be lost.
  Given a different account on the same device, then it never sees the previous account's cached data.
  _(free)_

### Trend and user context (computed in `@pt/core`)

- **AC23** — Given the entries and `today`, then `weightTrend(entries, today)` returns:
  - the last entry;
  - `averageKg`: the mean of the entries dated from 6 days ago to today (W1), or null with fewer than 3;
  - `changePerWeekKg`: with avg0 the mean of the entries dated from 13 to 7 days ago (W0), and d1 and d0
    the mean day of the entries in each window, (averageKg − avg0) / (d1 − d0) × 7; null with fewer than
    3 entries in either window or with d1 − d0 below 5 days;
  - `fastLoss`: true when changePerWeekKg is not null and −changePerWeekKg / avg0 is above 0.01, on
    unrounded values, and the same holds after removing the lowest entry of W1 (so one mistyped or
    unusual reading cannot raise it);

  It is pure and tested with hand-calculated fixtures: no entries, 2 entries, gaps, an entry replaced the
  same day, a steady loss, a gain, exactly 1.00 % (no flag) and 1.01 % (flag), entries bunched at the
  edges of the windows (11 days and 3 days between their means) and one mistyped low reading. _(free)_

- **AC24** — Given `fastLoss`, then Progress shows a notice (losing fast: eat enough, see a professional),
  unless the profile has `ed_soft_stop` or `pregnancy`, where only the professional-advice notice of
  spec 001 applies. _(free)_
- **AC25** — Given weight entries, then `buildContextSnapshot` returns `context-v2`, which adds
  `weight: { lastKg, lastDate, averageKg, changePerWeekKg, fastLoss, trendHidden }` to `context-v1`.
  `trendHidden` is true with `ed_soft_stop` or `pregnancy`, and then `averageKg` and `changePerWeekKg`
  are null, so no later AI feature can comment on the trend. `computeTargets` keeps reading
  `profile.weightKg`, which is the latest logged weight (AC10). _(free)_

### Data and privacy

- **AC26** — Given "Download my data", then the file includes every weight entry. Given "Delete my
  account", then they are deleted (the schema-driven test of spec 002 covers the new table). _(free)_
- **AC27** — Given an account created before this spec, then the migration gives it one entry: its
  profile weight, dated on the day the profile was last updated. _(free)_

## Data changes

| Table             | Column                  | Type                                 | Notes                               |
| ----------------- | ----------------------- | ------------------------------------ | ----------------------------------- |
| body_measurements | user_id                 | uuid FK profiles `on delete cascade` | PK (user_id, local_date)            |
|                   | local_date              | date                                 | the user's day                      |
|                   | weight_kg               | numeric(5,2)                         | check 30–300                        |
|                   | recorded_at             | timestamptz                          | device time of the write (AC20)     |
|                   | created_at / updated_at | timestamptz                          |                                     |
| profiles          | weight_kg               | unchanged                            | always the most recent entry (AC10) |

- RLS: enabled; `authenticated` may `select` only rows where `user_id = auth.uid()`; no
  insert/update/delete policies (writes go through the API).
- Index: the primary key serves the range query `(user_id, local_date)`.
- Migration `0003`: creates the table and backfills one row per existing profile (AC27).
- Difference from blueprint §5: `profiles.weight_kg` stays as a copy of the most recent entry, so the
  targets and the safety rules keep one input. The blueprint is updated in the same change (ADR 005).

## API contracts

- Schemas to add to `@pt/contracts` (`weight.ts`): `WeightEntrySchema`
  (`{ localDate, weightKg, recordedAt }`), `WeightUpsertRequestSchema` (`{ weightKg, recordedAt, today }`),
  `WeightListQuerySchema` (`{ from, to }`, at most 366 days), `WeightListResponseSchema`
  (`{ entries }`, oldest first), `WeightSaveResponseSchema`, `WeightTrendSchema`, `WEIGHT_LIMITS`.
- Schemas to change: `ExportResponseSchema` (`weights`), `ContextSnapshotSchema` (`context-v2`, AC25).
- `GET /me/weights?from&to` → 200 / 400 / 401 / 403
- `PUT /me/weights/{localDate}` → 200 `WeightSaveResponse` / 400 / 401 / 403. The body has the stored
  entry (AC20) and, when the targets changed, `targetsChange: { previous, current }` with the new safety
  evaluation (AC10–AC12).
- `DELETE /me/weights/{localDate}` → 200 `WeightSaveResponse` without an entry / 400 / 401 / 403. It
  succeeds when the entry no longer exists (AC9).
- `PUT /me/profile` → unchanged contract; it also stores the weight entry of AC13.
- The evaluation reuses `evaluateProfileInput` of spec 002 with the stored profile and the new weight;
  no rule is duplicated.
- All three need the current consent (403 `consent_required`), like every health-data route.
- `@pt/core`: `weightTrend`, `weightNotices`, the weight part of `buildContextSnapshot`, and the form
  helpers of the weight sheet (parse, step, unit conversion). Test-first.
- `@pt/api-client`: client methods, query options and mutation defaults with stable mutation keys (so a
  persisted mutation can resume), optimistic updates, and the same routes in the mock backend.

## UI

- Routes: `(tabs)/index` (Today), `(tabs)/progress`, `(tabs)/profile`, and `weight` as a sheet over the
  tabs (query `?date=`). `settings/profile` and `settings/privacy` stay as pushed screens.
- Components: `WeightCard`, `WeightSheet` (field + `Stepper`-style buttons + day chips), `WeightChart`,
  `WeightList`, `TrendSummary`, `OfflineBanner`, `SyncBadge`.
- States: loading, empty (AC17), error with retry, offline (AC5), pending sync (AC18), saved.
- Offline plumbing in the app: the query cache and the mutation queue are persisted in the app's
  key-value storage, keyed by user id; the online state comes from the browser on web and from a native
  network module on phones. The tab bar component, the persister packages and the network module are
  chosen from the Expo SDK 58 docs during implementation; each must work on web.
- Chart: drawn without a charting library if a small SVG is enough; otherwise one library installed with
  `expo install` that supports web.
- Mobile-first (360–430 px), light and dark, touch targets of at least 44 px.
- i18n (es reference + en): `tabs.*`, `today.*`, `weight.*`, `progress.*`, `offline.*`,
  `safety.fast_loss`; `home.*` is removed.
- E2E (`apps/e2e`): log today's weight from Today and see it in Progress; replace it; log a weight with
  the browser offline, reload, go online and see one synced entry; Home assertions of specs 001 and 002
  move to Today.

## Safety & edge cases

- Weighing is sensitive for people with an eating disorder. The app never asks for a daily weigh-in, has
  no streak for it, and with `ed_soft_stop` or pregnancy it removes the invitation and the trend
  judgement (AC4, AC24). There are no weight reminders in this spec.
- The fast-loss notice uses averages, never a single reading (AC23). The targets do follow single
  readings (human decision): 1 kg changes them by about 15–25 kcal, so normal daily swings move them by
  10–20 kcal and never across a safety limit without the matching notice.
- A mistyped weight would change the targets. The confirmation of AC7 catches large mistakes, and
  correcting or deleting the entry recomputes them (AC13).
- A queued offline entry changes the targets when it reaches the server; the notice of AC11 is shown
  then, not when it was typed.
- Ages 16–17 can log weight; they get no deficit (spec 001), the plain link instead of the invitation
  (AC4), no distance to a target weight (AC16) and the same fast-loss notice.
- A weight that falls into the low-BMI range removes the deficit even when the loss was slow (AC12),
  through the rule that already exists.
- The fast-loss rule, its 1 % threshold, and the 3 % confirmation are
  provisional: `domain-reviewer` during implementation, the professional reviewer before the beta.
- Units: kg internally; lb only in the UI. One decimal in kg, one in lb.
- Dates: the client sends the user's local day. The API accepts `today` within ±1 day of server UTC
  (same rule as spec 001) and rejects a `localDate` after it. The day starts at midnight;
  `day_start_minute` for shift workers arrives with the work schedule (E5).
- A queued write whose session expired cannot be sent: the user signs in again and the entry is lost
  with the cleared queue (AC22). This is rare (the session refreshes itself) and is accepted for the beta.
- The device clock can be wrong: `recordedAt` more than 1 day ahead of the server is rejected (400).
- The offline cache holds health data on the device. It lives in the app's own storage, is cleared on
  sign-out and deletion, and never contains another account's data (AC22).

## Out of scope

- Food and workout logging, "remaining calories", quick actions for a meal or a session (E4, E5).
- Client-generated ids and the offline queue for meals and workouts (E4, E5); this spec builds the queue
  and proves it with the weight log.
- Adjusting targets from the weight trend and the adherence (weekly review, E5b). This spec only
  recomputes the formula with the new weight.
- Other measurements (waist, body fat), progress photos, import from Apple Health or Health Connect.
- Reminders and notifications; streaks and points (E8).
- `day_start_minute`, the work schedule, sleep and stress check-ins (E5).
- The "What I know about you" screen (E7).
- The Supabase auth adapter (spec 001).

## Open questions

- For the professional reviewer: the fast-loss threshold in the first two weeks of a diet (water loss
  often exceeds 1 %), a lower threshold at 16–17, a notice for sustained loss when the goal is to
  maintain or gain, whether pregnancy and `ed_soft_stop` need more than the generic notice when weight
  falls fast, and whether a fast-gain notice is needed.
- People who weigh in once a week never get a trend or the safety rules that depend on it. A fallback
  (a slope over 4 entries in 28 days) is left for after the beta.
- Whether signing out with pending writes should keep them for the same account instead of deleting
  them (more work; decided after the beta).

## Progress

- [x] contracts · [x] db · [x] core · [x] api · [x] client · [x] ui · [x] e2e
- Tests by criterion: AC1–AC5 `apps/e2e` (`weight.spec.ts`, `onboarding.spec.ts`, `privacy.spec.ts`);
  AC6–AC9 `core/weight/form.test.ts`, `api/routes/me/weights.test.ts` and E2E; AC10–AC13
  `core/weight/apply.test.ts`, `api/routes/me/weights.test.ts`, `api-client/mock/backend.test.ts` and
  `api/store/account-deletion.integration.test.ts` (dev database); AC14–AC17 `core/weight/trend.test.ts`,
  `app/lib/weightChart.test.ts` and E2E; AC18–AC22 `api-client/weights.test.ts` (optimistic writes,
  queue saved and resumed after a restart, rollback on 400, retry on network errors) and the offline E2E
  journey; AC23–AC25 `core/weight/trend.test.ts`, `core/context/snapshot.test.ts`; AC26 the API export
  test and the integration test (the schema-driven table list now includes `body_measurements`); AC27
  the backfill in migration `0003`, applied to the dev database.
- Commits: `0cc6d42` contracts and core (trend, form helpers, `context-v2`) · `facf083` table,
  migration, API, client and mock backend · `8dcb073` app and E2E.
- Verified on 2026-11-13: `pnpm check` green, 6 E2E journeys green on the mock backend, Today, Progress
  and the weight sheet checked on web at 390 px in light and dark mode, migration `0003` applied to the
  dev database and the account-deletion integration test green on it.
- Decisions taken during implementation:
  - **ADR 005** records the change to BLUEPRINT §5: `profiles.weight_kg` is a copy of the latest entry
    and recomputes the targets.
  - **One rule for the API and the mock**: `applyLatestWeight` and `evaluateStoredProfile` in
    `@pt/core` evaluate the stored profile with the new weight, the goal the user asked for and the
    reported health facts recovered from the stored flags. `checkWeightWrite` holds the date and clock
    checks.
  - **The store decides inside one transaction**: `writeWeight(userId, write, decide, at)` locks the
    profile row (`for update`), so one user's writes are serialised and "most recent entry" is read
    consistently. The later `recordedAt` wins with `on conflict … do update … where`, and the response
    carries the entry actually stored (AC20).
  - **A write before there is a profile** is a 400 with `{ profile: 'required' }`. An account from
    before spec 002 (no job) stores the entry but keeps its profile and targets until it fills in the form
    again.
  - **The profile form stores today's entry** only when the weight differs from the stored one (or the
    profile is new). The backfill dates each existing profile's entry on the UTC day of `updated_at`.
  - **One cached list** (`['weights']`, the last 366 days) serves every screen, so an optimistic write
    shows everywhere. Writes are registered as mutation defaults by key (`['weights', 'save' | 'remove']`)
    and serialised with one scope; network errors and 5xx retry with backoff, a 4xx undoes the change and
    leaves a notice. The targets-change notice also lives in the query cache until dismissed.
  - **Offline cache**: `persistQueryClient` (not `PersistQueryClientProvider`, which restores once and
    cannot switch users) with `@tanstack/query-async-storage-persister` over the app's key-value storage,
    key `pt.query-cache.<userId>`, 7 days (`gcTime` matches), buster `spec-003`; targets previews are
    not saved. `IsRestoringProvider` holds queries until the user's copy is restored. Sign-out stops
    saving, signs out, clears the cache and the queue, then deletes the saved copy.
  - **Online state**: `expo-network` on phones (`lib/online.ts`); on web the browser's state, read at
    start too (`lib/online.web.ts`).
  - **Tabs**: JS `Tabs` from expo-router (`role="tab"` and `aria-selected` on web) with SVG icons drawn
    with `react-native-svg`, filled when selected, and a bold label.
  - **The sheet** is the `weight` route with `presentation: 'modal'` (a normal screen on web).
  - **Chart**: `react-native-svg`, no charting library. Its two colours (`tokens.chart`) passed the
    dataviz palette validator on both surfaces. A tap shows the closest entry; the list is the table view;
    the axis labels are app text over the drawing (SVG text used a serif font on web).
  - **i18n**: the Profile tab copy is under `profileTab.*`, besides the keys listed in the spec.
  - **The mock database key changed** (`pt.mock-db.v3`).
  - **The offline E2E journey emulates the browser state** (`navigator.onLine` and the online/offline
    events): with a really offline browser the page cannot be reloaded from the dev server.
  - **Known limit**: TanStack saves only paused writes. A write that is retrying because the server is
    unreachable while the device reports a connection is lost if the app is closed during the retry. The
    offline case of AC18 is covered.
- Domain review of the code (`domain-reviewer`, 2026-11-13): the trend maths, the 1.00 % / 1.01 %
  boundary, what protected profiles see, the sticky `ed_soft_stop`, pregnancy without numbers and the
  single evaluation path were checked correct. Fixed from it:
  - The confirming fast-loss check (without the lowest recent entry) no longer needs 5 days between the
    windows: in a real loss the lowest entry is often today's, and dropping it hid a 2.3 %-per-week loss.
    New fixture in `trend.test.ts`.
  - `context-v2` passes `fastLoss: false` when `trendHidden` (AC25: no trend judgement for protected
    profiles).
  - Progress shows the safety notices behind a targets change (a new `low_bmi`, AC12); "Today" already
    showed them.
  - With `ed_soft_stop`, the targets-change notice gives no calorie numbers ("your targets have been
    updated with your new weight").
  - The empty state of Progress uses neutral copy, without inviting protected profiles to track.
  - The fast-loss copy takes its percentage from `WEIGHT_TREND_RULES`.
- Notes for the professional reviewer, not changed: the low-BMI rule follows single readings with no
  margin, so a user right at BMI 20 can see the deficit switch on and off from one day to the next (a
  one-way rule with a margin on the 7-day average is proposed to the human, as it changes AC12); the 3 %
  confirmation only compares with the previous 7 days, so an occasional weigher gets no confirmation; one
  mistyped high reading in the earlier window can still raise the fast-loss notice (a false notice, low
  harm).
