# apps/api: Hono + @hono/zod-openapi

The only place with DB access, AI calls, secrets and webhooks. Deployed on Vercel (Node, region `fra1`).

## Route recipe (one folder per domain under `src/routes/<domain>/`)

1. Request/response schemas come from `@pt/contracts` (add them there first).
2. `createRoute({ method, path, tags, request, responses, middleware: [requireAuth] })`.
3. Handler stays thin: parse → `canUse()` entitlement check (Premium) → service in `src/services/` → return.
4. Business rules live in `@pt/core`; services just orchestrate DB + core + AI.
5. Register the router in `src/app.ts`. Test with `app.request()` (see `src/app.test.ts`):
   happy path, 401 unauthenticated, 403 not entitled, 400 invalid body.

## Errors

JSON `{ error: "<snake_case_code>", message?: string }`. Never leak stack traces or SQL.

## Payments (RevenueCat is the source of truth)

- `POST /webhooks/revenuecat`: verify the `Authorization` header against `REVENUECAT_WEBHOOK_AUTH`,
  make it idempotent (store the event id), upsert `entitlements`, return 2xx fast.
- Paddle web purchases reach us through RevenueCat's Paddle integration, so there is no Paddle webhook
  here unless a spec says otherwise.
- `canUse()` reads `entitlements`. Never trust a "premium" flag sent by the client.

## AI endpoints

Auth → entitlement and usage cap (`ai_usage`, Postgres) → build context (profile, prefs, recent logs,
minimal personal data) → `@pt/ai` (tools query the knowledge base) → Zod validate → `@pt/core` validate →
persist → record tokens and cost in `ai_usage`.

- Fast tasks (Haiku: food/workout logging, swaps) respond inline, with streaming where it helps the UI.
- Long tasks (Opus: meal plans, programs, weekly adaptation) are queued (Supabase Queues) and processed
  by a worker. The app polls the job status or listens via Supabase Realtime.
