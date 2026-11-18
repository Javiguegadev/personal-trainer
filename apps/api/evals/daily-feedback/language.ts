import type { Locale } from '@pt/contracts';

/**
 * A rough language check for the eval: the notes are one or two short sentences, so counting common
 * words that exist in only one of the two languages is enough to tell Spanish from English. Food
 * names are mixed in either way, so a note is wrong only when the other language clearly wins.
 */
const WORDS: Record<Locale, ReadonlySet<string>> = {
  es: new Set(
    'el la los las de del que en para con por un una unos unas tu tus te hoy más día y o puedes como al se es lo le sumar añadir añade suma queda quedó próxima vez comida cena desayuno merienda también muy'.split(
      ' ',
    ),
  ),
  en: new Set(
    'the and to of for with your you is are at in on or some would could try day more it this that next time add still left dinner lunch breakfast snack also very'.split(
      ' ',
    ),
  ),
};

/** Characters that never appear in an English note. */
const SPANISH_MARKS = /[ñáéíóú¿¡]/i;

export function noteLanguage(text: string): Locale | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const score = (locale: Locale) => words.filter((w) => WORDS[locale].has(w)).length;
  const es = score('es') + (SPANISH_MARKS.test(text) ? 1 : 0);
  const en = score('en');
  if (es === en) return null;
  return es > en ? 'es' : 'en';
}

/** True when the note is clearly in the other language. */
export function wrongLanguage(text: string, locale: Locale): boolean {
  const found = noteLanguage(text);
  return found !== null && found !== locale;
}
