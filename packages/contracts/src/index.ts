/**
 * @pt/contracts — single source of truth for data shapes shared by web, mobile and API.
 * Rules: Zod schemas only, no runtime dependencies besides zod, no I/O.
 */
export * from './checkin';
export * from './context';
export * from './errors';
export * from './feedback';
export * from './food';
export * from './health';
export * from './meal-draft';
export * from './onboarding';
export * from './plan';
export * from './privacy';
export * from './profile';
export * from './training';
export * from './weight';
export * from './workout-draft';
