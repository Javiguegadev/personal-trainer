/**
 * @pt/core — pure domain logic (nutrition, training, gamification, entitlements).
 * Rules: no React, no DB, no fetch, no Date.now() without injection. 100% unit-testable.
 * May import only from @pt/contracts.
 */
export * from './dates';
export * from './units';
export * from './nutrition/targets';
export * from './safety/profile';
export * from './onboarding/draft';
