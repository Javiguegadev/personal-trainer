/**
 * Normalization of source values (spec 005 AC2). Pure: shared by every food importer.
 */

/** A source value: a number, "traces", "< x", or missing ("-", empty). */
export type ParsedValue =
  | { kind: 'number'; value: number }
  | { kind: 'traces' }
  | { kind: 'below'; limit: number }
  | { kind: 'missing' };

/** Parses a value as written by CIQUAL ("12,5", "traces", "< 20", "-") or USDA ("12.5"). */
export function parseSourceValue(raw: string | null | undefined): ParsedValue {
  const text = (raw ?? '').trim().toLowerCase();
  if (text === '' || text === '-') return { kind: 'missing' };
  if (text === 'traces' || text === 'trace') return { kind: 'traces' };
  const below = /^<\s*([\d.,]+)$/.exec(text);
  if (below) return { kind: 'below', limit: Number(below[1]!.replace(',', '.')) };
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'missing' };
}

/** "traces" and "< x" are stored as 0; missing stays null (AC2, provisional rule). */
export function toStoredValue(parsed: ParsedValue): number | null {
  switch (parsed.kind) {
    case 'number':
      return parsed.value;
    case 'traces':
    case 'below':
      return 0;
    case 'missing':
      return null;
  }
}

export interface Per100g {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
  alcoholG: number | null;
}

/**
 * The importer lists a food for review when its kcal differs by more than 15 % from
 * 4·P + 4·C + 9·F + 7·alcohol + 2·fiber (AC2; fiber counts 2 kcal/g in Regulation (EU) 1169/2011,
 * which is the energy CIQUAL gives). Foods under 20 kcal are compared with an absolute margin of 3 kcal,
 * since a percentage on tiny values (water, herbs) is noise.
 */
export function energyMismatch(v: Per100g): boolean {
  const computed =
    4 * v.proteinG + 4 * v.carbsG + 9 * v.fatG + 7 * (v.alcoholG ?? 0) + 2 * (v.fiberG ?? 0);
  const diff = Math.abs(v.kcal - computed);
  if (v.kcal < 20) return diff > 3;
  return diff / v.kcal > 0.15;
}
