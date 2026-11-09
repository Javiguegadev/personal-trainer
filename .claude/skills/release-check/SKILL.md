---
name: release-check
description: Pre-release / pre-merge gate for the monorepo. Use before merging a phase, tagging a release or deploying ("release check", "listo para producción?").
---

# Release check

Run each step and report a ✅/❌ table. Don't fix things silently: list them.

1. `pnpm install --frozen-lockfile && pnpm format:check && pnpm turbo typecheck lint test build`
2. Run `git status` (must be clean) and `git log` since the last tag (summarize as a changelog).
3. Migrations: new files since the last release are listed, and each destructive statement is flagged.
4. RLS: every user-owned table has policies (query the dev DB with the Supabase MCP, read-only).
5. Secrets: grep the client bundles (`apps/web/.next/static`) for `sk_`, `sk-ant-`, `service_role`.
6. Run `/security-review` on the diff since the last release if it touches auth, billing, webhooks or AI.
7. Specs: every spec in this release has all ACs ticked.
8. List the manual checks the human must do: critical E2E journeys on the preview URL, and Stripe test
   events (Phase 7+).
