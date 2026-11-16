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
export * from './food/item-request';
export * from './food/label';
export * from './food/meal-type';
export * from './food/nutrition';
export * from './food/portion';
export * from './food/product';
export * from './food/quick-add';
export * from './food/repeat';
export * from './food/search';
export * from './food/write';
