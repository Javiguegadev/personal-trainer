---
name: api-endpoint
description: Add a typed Hono + zod-openapi endpoint in apps/api with auth, entitlement check, service and tests. Use whenever a new API route is needed.
---

# API endpoint

Follow `apps/api/CLAUDE.md`. Template:

```ts
// apps/api/src/routes/<domain>/<name>.ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { XRequestSchema, XResponseSchema } from '@pt/contracts';

const route = createRoute({
  method: 'post',
  path: '/<domain>/<name>',
  tags: ['<domain>'],
  request: { body: { content: { 'application/json': { schema: XRequestSchema } } } },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: XResponseSchema } } },
    401: { description: 'Unauthenticated' },
    403: { description: 'Not entitled' },
  },
});
```

Checklist:

- [ ] Schemas live in `@pt/contracts`, not inline.
- [ ] Auth middleware applied. For Premium features, `canUse(feature, plan)` from `@pt/core` returns 403
      with `{ error: 'premium_required' }`.
- [ ] Handler calls one service function, and the service calls `@pt/core` for rules.
- [ ] Tests with `app.request()`: 200, 400, 401, 403.
- [ ] Router registered in `src/app.ts`, and the route appears in `/openapi.json`.
- [ ] Matching method added to `@pt/api-client`.
