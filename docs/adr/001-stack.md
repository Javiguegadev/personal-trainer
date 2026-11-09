# ADR 001 — Core stack and monorepo layout

- Status: accepted
- Date: 2026-11-09

## Context

Freemium nutrition and fitness app, web first, with Android/iOS later, without duplicating business
logic. One developer working with Claude Code.

## Decision

pnpm + Turborepo monorepo. Next.js 16 web, Hono API as a separate app, Supabase Postgres (EU) with
Drizzle, Supabase Auth, Stripe → RevenueCat, Anthropic API server-side, Expo for mobile in Phase 10.
Internal packages export TypeScript source (no build step). Next uses `transpilePackages` and the API
bundles them with tsup.

TypeScript is pinned to 6.0.x because typescript-eslint 8 doesn't support TypeScript 7 yet. Revisit
when it does.

## Consequences

- Mobile reuses contracts, core, api-client, ui tokens and i18n, so only screens need writing.
- A separate API adds one deployment, but it keeps mobile independent of Next.js.
- Package boundaries are enforced in ESLint, so architecture drift fails CI.
