/**
 * @pt/i18n — translation dictionaries shared by web and mobile.
 * `es` is the reference locale: every other locale must have the same keys (type-checked).
 */
import { es } from './locales/es';
import { en } from './locales/en';
import type { DeepStringRecord } from './types';

export type Messages = DeepStringRecord<typeof es>;
export const locales = ['es', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'es';

export const messages: Record<Locale, Messages> = { es, en };
