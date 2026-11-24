# Personal Trainer: AI nutrition & fitness app (freemium)

Mobile-first, touch-first, with AI where it is faster. One Expo universal app (iOS, Android, web) plus a
Hono API. Full plan: `docs/BLUEPRINT.md` (v5, see ADR 002 to 006). Current stage: see "Status" at the
bottom of this file.

**Language: always answer the human in Spanish** (explanations, summaries, questions), even after
`/clear` and even when the prompt or a skill is in English. Code, docs, specs and commits stay in English.

## Commands

```bash
pnpm dev                          # app (Expo, web on :8081) + api (:8787)
pnpm check                        # typecheck + lint + test (run before saying "done")
pnpm build                        # API bundle + Expo web export
pnpm --filter @pt/app dev         # Expo only: press w (web), scan QR with Expo Go (phone)
pnpm --filter @pt/core test -- --watch
pnpm --filter @pt/app exec expo install <pkg>   # ALWAYS add app deps this way (SDK-compatible versions)
pnpm --filter @pt/app run doctor  # expo-doctor
pnpm db:generate                  # after changing packages/db/src/schema (then REVIEW the SQL)
pnpm db:migrate                   # apply to the DEV database only
pnpm format
```

## Layout

- `apps/app` Expo SDK 58 + Expo Router (routes in `src/app/`) · `apps/api` Hono + zod-openapi ·
  `apps/landing` Astro (created at launch)
- `packages/contracts` Zod schemas = source of truth for every API payload, AI tool input and AI output
- `packages/core` pure domain logic (nutrition, training, scoring, entitlements, safety rules)
- `packages/db` Drizzle schema, migrations, knowledge-base importers · `packages/ai` Claude integration
- `packages/api-client` typed client + TanStack Query hooks · `packages/ui` tokens · `packages/i18n` es/en

## Dependency rules (ESLint enforces them, never disable)

- `contracts` → only `zod`.
- `core` → only `contracts`. No React, React Native, Expo, DB, fetch, or `Date.now()` without injection.
- Only `apps/api` may import `@pt/db` and `@pt/ai`. Secrets never reach the app bundle
  (`EXPO_PUBLIC_*` values are public).
- The app talks to data **only** through `apps/api` via `@pt/api-client` (Supabase client in the app is
  for auth only).

## Conventions

- TypeScript strict; no `any`; `import type` for types. Workspace packages export TS source (no build step).
- New payload → schema in `contracts` first, then API route, then client, then UI.
- Touch first (ADR 004): taps and forms are the primary input of every feature. An AI input (a photo, or
  a typed or spoken sentence) is a shortcut, added only where it is faster, and it always produces an
  editable draft. The chat is for questions about the recommendations, not for data entry.
- The AI chooses, the code computes: Claude returns catalog IDs + quantities; `core` computes and validates.
  AI answers are grounded in the knowledge base and cite sources (see BLUEPRINT §4).
- Models: Claude Haiku 5.5 for high-volume/fast tasks, Claude Opus 5.5 for planning, coaching and
  adaptation. Changing a feature's model requires an eval run.
- Store nutrition per 100 g in `foods`, and **snapshot** kcal/macros on each log entry.
- Units: metric internally (kg, cm, g, kcal). Convert only at the UI edge (`core/units`).
- UI copy goes through `@pt/i18n` (es is the reference locale). No hard-coded strings.
- Platform-specific code uses `.web.tsx` / `.native.tsx` files, not runtime `Platform.OS` branches spread
  through screens.
- Tests: Vitest beside the file (`x.test.ts`). `core` is test-first. API routes: happy path + 401 + 403.
- Commits: Conventional Commits (`feat(nutrition): ...`). Small PRs.

## Workflow

1. Every feature starts from a spec in `docs/specs/` (skill `feature-spec`). Implement with skill
   `implement-spec`.
2. Plan before editing more than 3 files. Ask instead of guessing on product decisions.
3. Human-only actions (hooks block them): editing `.env*`, editing applied migrations, `supabase db push`,
   `drizzle-kit push`, force-push, production deploys.
4. Definition of Done: `pnpm check` green · acceptance criteria covered by tests · i18n keys for es+en ·
   UI verified on web (Playwright) and on a phone (Expo Go) · spec "Progress" updated.

## Gotchas

- Expo changes every SDK: check versioned docs (`apps/app/AGENTS.md`) instead of relying on memory.
- TypeScript is pinned to 6.0.x (typescript-eslint doesn't support 7 yet). TS 6 defaults `types: []`:
  add `"types": ["node"]` to a package's tsconfig if it needs Node globals.
- pnpm blocks dependency build scripts by default. Allow them in `pnpm-workspace.yaml` → `allowBuilds`.
- Expo web dev runs on :8081. The API's CORS list comes from `WEB_ORIGINS`.
- On a physical phone, `localhost` is the phone: set `EXPO_PUBLIC_API_URL` to the computer's LAN IP.
  For Google sign-in in Expo Go also set `REACT_NATIVE_PACKAGER_HOSTNAME=<lan-ip>.nip.io`: Supabase
  rejects redirect URLs whose host is an IP. Under `pnpm dev` Expo shows no QR: run the app alone.
- Windows dev machine: `.mcp.json` stdio servers use `cmd /c npx`.

## Status

- E0 Accounts ✅ · E1 Foundation ✅ (monorepo, CI, Expo universal app, typed API).
- E2 auth + onboarding ✅ (`docs/specs/001-auth-onboarding.md`): the Supabase auth adapter (email code +
  Google) signs in against dev on web and in Expo Go (human check 2026-11-17). Apple sign-in is a later
  spec.
- E2b logging & context foundations ✅: spec 002 (job, weekly training, `targets-v2`, user context, consent
  version, chat retired) and spec 003 (tabs Today/Progress/Profile, weight log with trend, offline cache
  and write queue; ADR 005), plus spec 004 (training focus: muscle, strength, sport performance, general
  fitness; `targets-v3`, `context-v3`).
- E4 food logging: slices (a) to (c) are implemented with E2E and passed the phone check in Expo Go
  (2026-11-17); migrations up to `0008` are applied to dev. Spec 005 (catalog, search, Food tab, log,
  offline writes): left for the human, the review of the catalog and the BEDCA request. Spec 006
  (barcode with Open Food Facts, the user's own foods, label photo with Claude Haiku 5.5): left, the
  Open Food Facts hit rate on ~20 products and the label eval (30 photos, `ANTHROPIC_API_KEY`). Spec
  007 (plate photo and sentence shortcuts, editable draft, Claude Haiku 5.5 with a `search_foods`
  tool): the sentence eval passed (2026-11-17); left, the ~30 weighed plates for the photo eval, a
  sample review of the eval sentences and the catalog gaps. See each spec's "Progress".
- Spec 008 (daily feedback, last piece of E4): implemented with E2E on 2026-11-18
  (`POST /me/food-log/feedback`, Claude Haiku 5.5 wording with a fixed-wording fallback, consent
  `2026-11-v6`). The eval passed on 2026-11-18 (after a fix: notes of "en" days came in Spanish).
  Left: a human read of 20 notes of its report, the phone check, the professional review of the
  thresholds.
- Spec 009 (E5 a: exercise catalog, Training tab, live session, activities, records): every step
  implemented with E2E on 2026-11-19; migration `0009` applied and the catalog imported on dev. Left:
  the phone check in Expo Go (rest haptic and chime, keep-awake, keyboard), the review of 50 exercise
  names and the search fixture, the professional review (see its Open questions).
- Spec 010 (E5 b: "Mi semana", week view and day screen, starter routine): every step implemented
  with E2E on 2026-11-20; migration `0010` applied on dev; consent `2026-11-v8`. Left: the phone check
  in Expo Go (time pickers, chips at 360 px, wizard, editor), the professional review (Open questions).
- Next (ADR 003, ADR 006): E5 spec 011 (daily check-in) →
  E5c weekly planner (meals and sessions planned by hand) → E5b adaptive loop → beta without paywall → E7
  premium AI → E6 payments.
