import type { Locale } from '@pt/contracts';

/**
 * Food search (spec 005 AC4), pure, so the API, the mock backend and the search eval rank the same way.
 * The catalog is small (about 800 foods), so it runs over an in-memory index.
 */

export interface SearchableFood {
  id: string;
  nameEs: string;
  nameEn: string;
  synonymsEs: readonly string[];
  /** Curated tie-break: higher first. */
  popularity: number;
}

interface IndexedText {
  text: string;
  tokens: string[];
}

interface IndexedFood {
  food: SearchableFood;
  nameEs: IndexedText;
  nameEn: IndexedText;
  synonyms: IndexedText[];
}

export interface FoodSearchIndex {
  foods: IndexedFood[];
}

/** Lowercase, without accents (ñ → n, ü → u) or punctuation, single spaces. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Words that do not narrow a search ("leche de cabra" = "leche cabra"). "sin" is kept: it matters. */
const STOP_WORDS = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'a',
  'al',
  'con',
  'y',
  'e',
  'en',
  'o',
  'un',
  'una',
  'of',
  'the',
  'and',
  'with',
]);

/** Quantity words a user may type before the food ("un vaso de leche"): ignored in the query only. */
const QUANTITY_WORDS = new Set([
  'unos',
  'unas',
  'poco',
  'poquito',
  'copa',
  'copas',
  'vaso',
  'vasos',
  'taza',
  'tazas',
  'cucharada',
  'cucharadas',
  'cucharadita',
  'cucharaditas',
  'chorrito',
  'chorro',
  'plato',
  'platos',
  'racion',
  'raciones',
  'trozo',
  'trozos',
  'pieza',
  'piezas',
  'punado',
  'loncha',
  'lonchas',
]);

const queryTokens = (text: string) => {
  const tokens = contentTokens(text);
  const food = tokens.filter((t) => !QUANTITY_WORDS.has(t));
  return food.length > 0 ? food : tokens;
};

const contentTokens = (text: string) => {
  const tokens = text.split(' ').filter(Boolean);
  const content = tokens.filter((t) => !STOP_WORDS.has(t));
  return content.length > 0 ? content : tokens;
};

const indexText = (raw: string): IndexedText => {
  const text = normalizeSearchText(raw);
  return { text, tokens: contentTokens(text) };
};

export function buildFoodSearchIndex(foods: readonly SearchableFood[]): FoodSearchIndex {
  return {
    foods: foods.map((food) => ({
      food,
      nameEs: indexText(food.nameEs),
      nameEn: indexText(food.nameEn),
      synonyms: food.synonymsEs.map(indexText),
    })),
  };
}

/** Optimal string alignment distance (one transposition counts as one edit), capped at 2. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = value;
    }
  }
  return d[a.length]![b.length]!;
}

/** Words of 5 letters or more tolerate one typo, also against the start of a longer word. */
const TYPO_MIN_LENGTH = 5;

function fuzzyMatches(query: string, token: string): boolean {
  if (token.startsWith(query)) return true;
  if (query.length < TYPO_MIN_LENGTH) return false;
  for (const length of [query.length - 1, query.length, query.length + 1]) {
    if (length <= token.length && editDistance(query, token.slice(0, length)) <= 1) return true;
  }
  return editDistance(query, token) <= 1;
}

const allTokens = (query: string[], text: IndexedText, match: (q: string, t: string) => boolean) =>
  query.every((q) => text.tokens.some((t) => match(q, t)));

/** Spanish plurals: "melocotones" → "melocoton", "tomates" → "tomate", "nueces" → "nuez". */
function singulars(q: string): string[] {
  const forms = [q];
  if (q.length > 4 && q.endsWith('ces')) forms.push(`${q.slice(0, -3)}z`);
  if (q.length > 4 && q.endsWith('es')) forms.push(q.slice(0, -2));
  if (q.length > 3 && q.endsWith('s')) forms.push(q.slice(0, -1));
  return forms;
}

const prefix = (q: string, t: string) => singulars(q).some((form) => t.startsWith(form));

/**
 * Lifts a recently logged food within its tier: above any popularity (1–9), below the gap between two
 * tiers (50).
 */
const PREFERRED_BONUS = 10;

/** Tiers of AC4: whole name, name prefix, every word of the name, synonyms, then similarity. */
function tier(
  query: { text: string; tokens: string[] },
  names: IndexedText[],
  synonyms: IndexedText[],
) {
  if (names.some((n) => n.tokens.join(' ') === query.tokens.join(' '))) return 1000;
  if (names.some((n) => n.text.startsWith(query.text))) return 800;
  if (names.some((n) => allTokens(query.tokens, n, prefix))) return 600;
  if (synonyms.some((s) => s.tokens.join(' ') === query.tokens.join(' '))) return 500;
  if (synonyms.some((s) => s.text.startsWith(query.text))) return 450;
  if (synonyms.some((s) => allTokens(query.tokens, s, prefix))) return 400;
  if ([...names, ...synonyms].some((s) => allTokens(query.tokens, s, fuzzyMatches))) return 200;
  return 0;
}

/**
 * Ids of the best matches, best first (AC4). With the English locale, English names count too. `extra`
 * is a second index ranked together with the first: the user's own foods and the products they logged
 * (spec 006 AC11), which are never part of the shared catalog. `preferred` holds the ids the user logged
 * recently: they come first among equal matches (spec 007), never above a better one.
 */
export function searchFoods(
  index: FoodSearchIndex,
  query: string,
  locale: Locale,
  limit: number,
  extra?: FoodSearchIndex,
  preferred?: ReadonlySet<string>,
): string[] {
  const text = normalizeSearchText(query);
  if (text.length < 2) return [];
  const normalized = { text, tokens: queryTokens(text) };
  const scored: { food: SearchableFood; score: number; length: number }[] = [];
  for (const entry of extra ? [...index.foods, ...extra.foods] : index.foods) {
    const names = locale === 'en' ? [entry.nameEs, entry.nameEn] : [entry.nameEs];
    const score = tier(normalized, names, entry.synonyms);
    if (score > 0) {
      scored.push({
        food: entry.food,
        score:
          score + entry.food.popularity + (preferred?.has(entry.food.id) ? PREFERRED_BONUS : 0),
        length: entry.nameEs.text.length,
      });
    }
  }
  scored.sort(
    (a, b) =>
      b.score - a.score || a.length - b.length || a.food.nameEs.localeCompare(b.food.nameEs),
  );
  return scored.slice(0, limit).map((s) => s.food.id);
}
