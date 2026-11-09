---
name: implement-spec
description: Implement an approved spec from docs/specs/ layer by layer (contracts, db, core, api, client, ui, e2e) with green tests and a commit after each step. Use when the user says "implement spec NNN", "implementa", or points at a spec file.
---

# Implement a spec

Preconditions: the spec exists and the human has approved it. If not, use `feature-spec` first.

## Steps (one commit each, `pnpm check` green before every commit)

1. **Plan**: list the files per package and map each AC to the test that will prove it. Show the plan and
   wait for approval if it touches more than 3 files.
2. **Contracts**: add Zod schemas to `packages/contracts/src/<domain>.ts` and export them.
3. **DB** (if needed): follow the `db-migration` skill.
4. **Core**: use the `test-writer` agent (or write failing Vitest tests yourself), then implement pure
   functions in `packages/core/src/<domain>/`.
5. **API**: follow the `api-endpoint` skill.
6. **Client**: add methods plus TanStack Query hooks in `packages/api-client`.
7. **UI**: follow the `ui-screen` skill.
8. **E2E** (critical journeys only): Playwright test, then verify manually with the Playwright MCP.
9. **Close**: tick the ACs in the spec's "Progress" section, note any decisions taken, and summarize what
   the human must check by hand.

## Rules

- Never weaken a test to make it pass. If an AC is wrong, stop and ask.
- If context gets long, update the spec's Progress section, then tell the human to `/clear` and resume
  with "continue spec NNN".
