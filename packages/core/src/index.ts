/**
 * @pt/core — pure domain logic (nutrition, training, gamification, entitlements).
 * Rules: no React, no DB, no fetch, no Date.now() without injection. 100% unit-testable.
 * May import only from @pt/contracts.
 */
export * from './dates';
export * from './format';
export * from './units';
export * from './nutrition/activity';
export * from './nutrition/focus';
export * from './nutrition/targets';
export * from './checkin/adjust';
export * from './checkin/checkin';
export * from './checkin/readiness';
export * from './context/snapshot';
export * from './safety/profile';
export * from './profile/evaluate';
export * from './profile/form';
export * from './profile/notices';
export * from './weight/apply';
export * from './weight/form';
export * from './weight/trend';
export * from './food/barcode';
export * from './food/custom-food';
export * from './food/feedback';
export * from './food/item-request';
export * from './food/label';
export * from './food/meal-draft';
export * from './food/meal-type';
export * from './food/nutrition';
export * from './food/portion';
export * from './food/product';
export * from './food/quick-add';
export * from './food/repeat';
export * from './food/search';
export * from './food/write';
export * from './training/bests';
export * from './training/program';
export * from './training/routine';
export * from './training/search';
export * from './training/session';
export * from './training/sets';
export * from './training/view';
export * from './training/write';
export * from './week/day';
export * from './week/typical';
export * from './week/view';
