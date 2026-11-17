import { format, messages, resolveLocale, type Locale, type Messages } from '@pt/i18n';
import { useLocales } from 'expo-localization';

/** UI language from the device's preferred languages (es/en, Spanish by default). */
export function useI18n(): { locale: Locale; t: Messages; format: typeof format } {
  const locales = useLocales();
  const locale = resolveLocale(locales.map((l) => l.languageCode));
  return { locale, t: messages[locale], format };
}
