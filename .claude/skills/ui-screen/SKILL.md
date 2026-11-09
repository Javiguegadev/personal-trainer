---
name: ui-screen
description: Build a web screen or component in apps/web that is ready to port to Expo (shared hooks, tokens, i18n, all states, verified in the browser). Use for any UI work.
---

# UI screen

1. Data comes from `@pt/api-client` hooks. If a hook is missing, add it there, not in the app.
2. Any derived value (totals, percentages, formatting) is a pure function in `@pt/core` with a test.
3. Copy goes in `@pt/i18n` (`es` first, then `en`; the type system enforces parity).
4. Build from shadcn/ui primitives in `apps/web/components/ui` with Tailwind theme tokens. No ad-hoc hex
   colors.
5. Implement loading (skeleton), empty (with a call to action), error (retry) and success states.
   Lay out mobile-first, starting at 360 px.
6. Accessibility: labels on inputs, focus states, color is never the only signal, and hit targets ≥ 44 px.
7. Verify with the Playwright MCP: navigate, take a snapshot, check the console for errors, and test at
   360 px and 1280 px widths. Report what you saw.
