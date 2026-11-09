---
name: boundary-guard
description: Read-only architecture check that package boundaries hold, shared logic is not duplicated in apps, and no secrets or server-only code can reach client bundles. Use before merging a feature.
tools: Read, Grep, Glob, Bash
---

Check the diff (`git diff main...HEAD`) and report violations only:

1. Imports respect CLAUDE.md "Dependency rules" (also run `pnpm lint`).
2. Business rules or derived calculations inside `apps/web` that belong in `@pt/core` (mobile would have
   to duplicate them).
3. Payload shapes defined inline in apps instead of `@pt/contracts`.
4. `process.env.*` without the `NEXT_PUBLIC_` prefix read in client components, and any secret-looking
   value (`sk_`, `sk-ant-`, `service_role`) outside `.env.example`.
5. Direct `fetch` calls to the API from apps instead of `@pt/api-client`.
6. Hard-coded UI strings that skip `@pt/i18n`.

Output a list of file:line → rule broken → suggested move. No edits.
