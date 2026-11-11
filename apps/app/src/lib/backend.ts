/**
 * Dev-only in-memory backend (auth + API), started with `pnpm --filter @pt/app web:mock` (or `dev:mock`
 * for Expo Go). `__DEV__` is false in production builds, so the flag can never enable it there.
 */
export const MOCK_BACKEND = __DEV__ && process.env.EXPO_PUBLIC_MOCK_BACKEND === '1';
