# apps/api — Hono + @hono/zod-openapi

The only place with DB access, AI calls, secrets and webhooks.

## Route recipe (one folder per domain under `src/routes/<domain>/`)

1. Request/response schemas come from `@pt/contracts` (add them there first).
2. `createRoute({ method, path, tags, request, responses, middleware: [requireAuth] })`.
3. Handler stays thin: parse → `canUse()` entitlement check (Premium) → service in `src/services/` → return.
4. Business rules live in `@pt/core`; services just orchestrate DB + core + AI.
5. Register the router in `src/app.ts`. Test with `app.request()` (see `src/app.test.ts`):
   happy path, 401 unauthenticated, 403 not entitled, 400 invalid body.

## Errors

JSON `{ error: "<snake_case_code>", message?: string }`. Never leak stack traces or SQL.

## Webhooks (Stripe/RevenueCat)

Verify the signature against the raw body, make handlers idempotent (store event id), return 2xx fast and
move heavy work to a background job.

## AI endpoints (Phase 8)

Rate limit → entitlement → build context → `@pt/ai` → Zod validate → `@pt/core` validate → persist → meter
cost in `ai_generations`. Long generations run as background jobs.
