# Personal Trainer: AI nutrition & fitness app (freemium)

Mobile-first, AI-first. One Expo universal app (iOS, Android, web) plus a Hono API. Full plan:
`docs/BLUEPRINT.md` (v2, see ADR 002). Current stage: see "Status" at the bottom of this file.

## Commands

```bash
pnpm dev                          # app (Expo, web on :8081) + api (:8787)
pnpm check                        # typecheck + lint + test (run before saying "done")
pnpm build                        # API bundle + Expo web export
pnpm --filter @pt/app dev         # Expo only: press w (web), scan QR with Expo Go (phone)
pnpm --filter @pt/core test -- --watch
pnpm --filter @pt/app exec expo install <pkg>   # ALWAYS add app deps this way (SDK-compatible versions)
pnpm --filter @pt/app doctor      # expo-doctor
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
- AI-first: every logging/planning feature has a natural-language path (text, photo or dictation) **and**
  a manual fallback.
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
- Windows dev machine: `.mcp.json` stdio servers use `cmd /c npx`.

## Status

- E1 Foundation: ✅ monorepo, CI, Expo universal app (web verified), typed API.
- Next: E0 accounts (Supabase EU, Vercel, Expo, Anthropic) → E2 auth + conversational onboarding
  (`docs/specs/001-auth-onboarding.md`, to be written).
