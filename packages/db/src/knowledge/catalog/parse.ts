/**
 * The curated catalog (`foods.csv`, spec 005 AC1): which source records we use and the names,
 * synonyms and household servings we wrote for them. Values per 100 g always come from the source.
 */

export const CATALOG_COLUMNS = [
  'key',
  'source',
  'source_id',
  'popularity',
  'name_es',
  'synonyms_es',
  'servings_es',
  'name_en',
  'servings_en',
] as const;

export interface CatalogServing {
  labelEs: string;
  labelEn: string;
  grams: number;
}

export interface CatalogEntry {
  key: string;
  source: string;
  sourceId: string;
  popularity: number;
  nameEs: string;
  nameEn: string;
  synonymsEs: string[];
  servings: CatalogServing[];
}

/** RFC 4180 CSV: comma-separated, double quotes around fields that contain commas or quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

const SERVING = /^(.+?)\s*\((\d+(?:[.,]\d+)?)\s*g\)$/;

/** `1 huevo mediano (55 g) | 1 huevo grande (65 g)` → labels and grams. */
function parseServings(text: string): { label: string; grams: number }[] | string {
  const parts = text
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
  const servings: { label: string; grams: number }[] = [];
  for (const part of parts) {
    const match = SERVING.exec(part);
    if (!match) return `serving without grams: "${part}"`;
    const grams = Number(match[2]!.replace(',', '.'));
    if (!(grams > 0 && grams <= 2000)) return `serving grams out of range: "${part}"`;
    servings.push({ label: match[1]!.trim(), grams });
  }
  return servings;
}

export interface CatalogParseResult {
  entries: CatalogEntry[];
  /** Line number (1 = header) and reason, for rows that cannot be used. */
  errors: { line: number; reason: string }[];
}

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Parses and validates `foods.csv`; invalid rows are reported, never imported. */
export function parseCatalog(text: string): CatalogParseResult {
  const [header, ...rows] = parseCsv(text);
  const errors: { line: number; reason: string }[] = [];
  if (!header || header.map((h) => h.trim()).join(',') !== CATALOG_COLUMNS.join(',')) {
    return {
      entries: [],
      errors: [{ line: 1, reason: `header must be ${CATALOG_COLUMNS.join(',')}` }],
    };
  }
  const entries: CatalogEntry[] = [];
  const keys = new Set<string>();
  const records = new Set<string>();
  rows.forEach((cells, index) => {
    const line = index + 2;
    if (cells.length !== CATALOG_COLUMNS.length) {
      errors.push({
        line,
        reason: `expected ${CATALOG_COLUMNS.length} fields, got ${cells.length}`,
      });
      return;
    }
    const [key, source, sourceId, popularity, nameEs, synonymsEs, servingsEs, nameEn, servingsEn] =
      cells.map((cell) => cell.trim()) as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
    const fail = (reason: string) => errors.push({ line, reason: `${key || '?'}: ${reason}` });
    if (!KEY.test(key)) return fail('key must be kebab-case ASCII');
    if (keys.has(key)) return fail('duplicate key');
    if (records.has(`${source}:${sourceId}`))
      return fail(`duplicate source record ${source}:${sourceId}`);
    if (!source || !sourceId) return fail('source and source_id are required');
    const pop = Number(popularity);
    if (!Number.isInteger(pop) || pop < 1 || pop > 9) return fail('popularity must be 1–9');
    if (!nameEs || !nameEn) return fail('name_es and name_en are required');
    const es = parseServings(servingsEs);
    const en = parseServings(servingsEn);
    if (typeof es === 'string') return fail(es);
    if (typeof en === 'string') return fail(en);
    if (es.length !== en.length || es.some((s, i) => s.grams !== en[i]!.grams)) {
      return fail('servings_es and servings_en must list the same grams in the same order');
    }
    keys.add(key);
    records.add(`${source}:${sourceId}`);
    entries.push({
      key,
      source,
      sourceId,
      popularity: pop,
      nameEs,
      nameEn,
      synonymsEs: synonymsEs
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean),
      servings: es.map((s, i) => ({ labelEs: s.label, labelEn: en[i]!.label, grams: s.grams })),
    });
  });
  return { entries, errors };
}
