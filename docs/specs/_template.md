# NNN — Feature name

- Status: draft | approved | in progress | done
- Phase: N
- Tier: free | premium | mixed

## Problem / user story

As a <user>, I want <capability> so that <outcome>.

## Acceptance criteria

- **AC1** — Given …, when …, then … _(free)_
- **AC2** — …

## Data changes

| Table | Column | Type | Notes |
| ----- | ------ | ---- | ----- |

RLS: …

## API contracts

- Schemas to add to `@pt/contracts`: `XRequestSchema`, `XResponseSchema`
- `POST /domain/name` → 200 / 400 / 401 / 403

## UI

Screens and states (loading / empty / error / success); i18n keys.

## Safety & edge cases

Health guardrails, units, timezones, minors, invalid input.

## Out of scope

-

## Open questions

-

## Progress

- [ ] contracts · [ ] db · [ ] core · [ ] api · [ ] client · [ ] ui · [ ] e2e
- Decisions taken during implementation:
