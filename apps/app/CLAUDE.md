# apps/app: Expo Router universal app (iOS, Android, web)

@AGENTS.md

## Project rules (on top of AGENTS.md)

- Routes live in `src/app/` only. Components, hooks and helpers go in `src/components`, `src/hooks`,
  `src/lib`.
- Data comes from `@pt/api-client` (see `src/lib/api.ts`). Never call Claude, the DB or payment APIs
  directly from the app.
- Derived values (totals, percentages, formatting) are pure functions in `@pt/core` with tests, so the
  API and every platform agree.
- Copy comes from `@pt/i18n`; colors, spacing and radii from `@pt/ui` tokens.
- Mobile-first layouts: design for 360–430 px wide first, and cap content width on large screens
  (web/tablet).
- Every data screen has loading, empty (with a call to action), error (with retry) and success states.
- Touch first: taps and forms are the primary input. AI inputs (camera, a typed or spoken sentence) are
  shortcuts and always produce an editable draft.
- Web differences go in `*.web.tsx` files. Check that new native libraries support web, or provide a
  web fallback.
- Add dependencies with `pnpm --filter @pt/app exec expo install <pkg>`, then run
  `pnpm --filter @pt/app run doctor`.
- Verify UI on web with the Playwright MCP (`pnpm --filter @pt/app web`, port 8081) at 390 px wide, in
  light and dark mode. Ask the human to check native behavior in Expo Go when the change touches
  gestures, the camera, haptics or keyboard handling.
