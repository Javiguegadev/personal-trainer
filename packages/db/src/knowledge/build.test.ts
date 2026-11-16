import { describe, expect, it } from 'vitest';
import { buildCatalogRows, formatReport } from './build';
import type { CatalogEntry } from './catalog/parse';

const entry = (key: string, sourceId: string): CatalogEntry => ({
  key,
  source: 'ciqual-2025',
  sourceId,
  popularity: 5,
  nameEs: key,
  nameEn: key,
  synonymsEs: [],
  servings: [],
});

describe('buildCatalogRows (spec 005 AC1, AC2)', () => {
  const values = {
    ok: { kcal: 165, proteinG: 10, carbsG: 20, fatG: 5, fiberG: null, alcoholG: null },
    off: { kcal: 300, proteinG: 10, carbsG: 20, fatG: 5, fiberG: 1, alcoholG: null },
  };
  const report = buildCatalogRows(
    [entry('a-ok', '1'), entry('a-off', '2'), entry('a-unknown', '3'), entry('a-missing', '4')],
    (_source, id) =>
      id === '1' ? values.ok : id === '2' ? values.off : id === '4' ? { missing: 'fatG' } : null,
  );

  it('imports the entries with values and skips the others with a reason', () => {
    expect(report.rows.map((r) => r.entry.key)).toEqual(['a-ok', 'a-off']);
    expect(report.skipped).toEqual([
      { key: 'a-unknown', reason: 'unknown record ciqual-2025:3' },
      { key: 'a-missing', reason: 'missing fatG' },
    ]);
  });

  it('lists the foods whose kcal are far from their macros, and still imports them', () => {
    expect(report.energyChecks).toEqual([{ key: 'a-off', kcal: 300, computed: 167 }]);
  });

  it('formats a report with every section', () => {
    const text = formatReport(report, [{ line: 7, reason: 'x: duplicate key' }]);
    expect(text).toContain('- Imported: 2');
    expect(text).toContain('- line 7: x: duplicate key');
    expect(text).toContain('- a-unknown: unknown record ciqual-2025:3');
    expect(text).toContain('- a-off: 300 kcal, macros give 167 kcal');
  });
});
