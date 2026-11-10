---
name: ui-screen
description: Build a screen or component in the Expo universal app (apps/app) that works on iOS, Android and web, mobile-first, with shared hooks, tokens, i18n, all states and an AI input path. Use for any UI work.
---

# UI screen (Expo Router, universal)

Read `apps/app/CLAUDE.md` and `apps/app/AGENTS.md` first. Check the versioned Expo docs for any Expo API
you use.

1. **Route** in `apps/app/src/app/` (file-based). Components go in `src/components/`, hooks in
   `src/hooks/`.
2. **Data** from `@pt/api-client` hooks. If a hook is missing, add it there, not in the app.
3. **Derived values** (totals, percentages, formatting) are pure functions in `@pt/core` with a test.
4. **Copy** in `@pt/i18n` (`es` first, then `en`; the type system enforces parity). **Styles** from
   `@pt/ui` tokens. No ad-hoc hex colors.
5. **AI-first input**: if the screen captures data, provide the natural-language path (text field with
   dictation, camera for photos) as the primary action and a manual form as the fallback.
6. **States**: loading (skeleton), empty (with a call to action), error (retry), success. Light and dark
   mode.
7. **Mobile-first layout**: 360–430 px first; safe areas; keyboard avoidance on inputs; hit targets
   ≥ 44 px; cap content width on web/tablet.
8. **Accessibility**: `accessibilityLabel`/`accessibilityRole` on controls, color never the only signal,
   respect reduced motion.
9. **Platform differences** in `*.web.tsx` / `*.native.tsx`. If you add a native library, add it with
   `expo install`, run `pnpm --filter @pt/app doctor`, and check it works on web or add a fallback.
10. **Verify**: run `pnpm --filter @pt/app web` and check with the Playwright MCP at 390 px (light and
    dark) and 1280 px, with no console errors. List what the human must check on a phone in Expo Go.
