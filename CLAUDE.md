# Personal Trainer — AI nutrition & fitness app (freemium)

Web first (Next.js), mobile later (Expo) reusing the same packages. Full plan: `docs/BLUEPRINT.md`.
Current phase and progress: see "Status" at the bottom of this file.

## Commands

```bash
pnpm dev            # web :3000 + api :8787
pnpm check          # typecheck + lint + test (run before saying "done")
pnpm build
pnpm --filter @pt/core test -- --watch
pnpm db:generate    # after changing packages/db/src/schema (then REVIEW the SQL)
pnpm db:migrate     # apply to LOCAL db only
pnpm format
```

## Layout

- `apps/web` Next.js 16 App Router + Tailwind 4 · `apps/api` Hono + zod-openapi · `apps/mobile` (Phase 10)
- `packages/contracts` Zod schemas = source of truth for every API payload and AI output
- `packages/core` pure domain logic (nutrition, training, gamification, entitlements)
- `packages/db` Drizzle schema + migrations · `packages/ai` Claude integration
- `packages/api-client` typed client + TanStack Query hooks (web & mobile) · `packages/ui` tokens · `packages/i18n` es/en

## Dependency rules (ESLint enforces them, never disable)

- `contracts` → only `zod`.
- `core` → only `contracts`. No React, DB, fetch, or `Date.now()` without injection.
- Only `apps/api` may import `@pt/db` and `@pt/ai`. Secrets never reach client bundles.
- Apps talk to data **only** through `apps/api` via `@pt/api-client`.

## Conventions

- TypeScript strict; no `any`; `import type` for types. Workspace packages export TS source (no build step).
- New payload → schema in `contracts` first, then API route, then client, then UI.
- Store nutrition as numbers per 100 g in `foods`, and **snapshot** kcal/macros on each log entry.
- Units: metric internally (kg, cm, g, kcal). Convert only at the UI edge (`core/units`).
- AI never does arithmetic: it picks catalog IDs + quantities; `core` computes and validates.
- UI copy goes through `@pt/i18n` (es is the reference locale). No hard-coded strings.
- Tests: Vitest beside the file (`x.test.ts`). `core` is test-first. API routes: happy path + 401 + 403 (entitlement).
- Commits: Conventional Commits (`feat(nutrition): ...`). Small PRs.
- `@hono/zod-openapi` routes: `createRoute` + `.openapi()` so `/openapi.json` stays complete.

## Workflow

1. Every feature starts from a spec in `docs/specs/` (skill `feature-spec`). Implement with skill `implement-spec`.
2. Plan before editing more than 3 files. Ask instead of guessing on product decisions.
3. Human-only actions (hooks block them): editing `.env*`, editing applied migrations, `supabase db push`,
   `drizzle-kit push`, force-push, production deploys.
4. Definition of Done: `pnpm check` green · acceptance criteria covered by tests · i18n keys for es+en ·
   spec "Progress" updated · no TODOs without an issue.

## Gotchas

- TypeScript is pinned to 6.0.x (typescript-eslint doesn't support 7 yet). TS 6 defaults `types: []`:
  add `"types": ["node"]` to a package's tsconfig if it needs Node globals.
- pnpm blocks dependency build scripts by default. Allow them in `pnpm-workspace.yaml` → `allowBuilds`.
- Windows dev machine: `.mcp.json` stdio servers use `cmd /c npx`.

## Status

- Phase 1 (monorepo foundation): ✅ scaffolded — pending: GitHub remote, Vercel preview, Supabase projects.
- Next: Phase 2 — auth, profile, onboarding (`docs/specs/001-auth-onboarding.md`, to be written).
