# apps/mobile — placeholder (Phase 10)

The Expo app is created in Phase 10, not before. Until then, keep all reusable
logic in `packages/*` so mobile only needs screens.

When starting Phase 10:

```powershell
cd apps
pnpm dlx create-expo-app@latest mobile --template default
```

Then rename the package to `@pt/mobile`, depend on `@pt/contracts`, `@pt/core`,
`@pt/api-client`, `@pt/ui` and `@pt/i18n`, and add NativeWind and RevenueCat.
The `apps/mobile` folder is outside the pnpm workspace until it has a `package.json`.
