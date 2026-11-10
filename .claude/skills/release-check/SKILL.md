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
5. Secrets: grep the app bundle (`apps/app/dist` after `pnpm --filter @pt/app build`) and every
   `EXPO_PUBLIC_*` value for `sk_`, `sk-ant-`, `service_role`, `sb_secret_`.
6. Expo: `pnpm --filter @pt/app exec expo install --check` and `pnpm --filter @pt/app doctor` pass;
   `app.json` version/build numbers bumped for store releases.
7. Run `/security-review` on the diff since the last release if it touches auth, payments, webhooks or AI.
8. AI: evals for every changed prompt/model pass their gates; the average cost per call is within target.
9. Knowledge base: every source in use has its license and attribution recorded.
10. Specs: every spec in this release has all ACs ticked.
11. List the manual checks the human must do: critical journeys on the web preview and on a phone (Expo
    Go / TestFlight / Play internal testing), and sandbox purchases (App Store, Play, Paddle) unlocking
    Premium everywhere.
