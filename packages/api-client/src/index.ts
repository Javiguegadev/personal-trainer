/**
 * @pt/api-client — typed client for apps/api, shared by web and mobile.
 * Every response is validated against @pt/contracts at runtime; errors carry the API's
 * `{ code, fields }` body. TanStack Query hooks live in `./hooks`.
 */
export * from './checkins';
export * from './client';
export * from './feedback';
export * from './foods';
export * from './hooks';
export * from './plan';
export * from './training';
export * from './week';
export * from './weights';
