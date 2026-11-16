import type { CatalogEntry } from './catalog/parse';
import { energyMismatch, type Per100g } from './values';

export interface CatalogFoodRow {
  entry: CatalogEntry;
  values: Per100g;
}

export interface BuildReport {
  rows: CatalogFoodRow[];
  /** Entries that cannot be imported: unknown record or a missing required value (AC2). */
  skipped: { key: string; reason: string }[];
  /** Imported, but listed for review: kcal far from the macros (AC2). */
  energyChecks: { key: string; kcal: number; computed: number }[];
}

/**
 * Joins the curated entries with their source values (spec 005 AC1, AC2). `lookup` returns the values
 * per 100 g of a source record, `{ missing }` when a required value is missing, or null when the record
 * does not exist.
 */
export function buildCatalogRows(
  entries: readonly CatalogEntry[],
  lookup: (source: string, sourceId: string) => Per100g | { missing: string } | null,
): BuildReport {
  const report: BuildReport = { rows: [], skipped: [], energyChecks: [] };
  for (const entry of entries) {
    const values = lookup(entry.source, entry.sourceId);
    if (values === null) {
      report.skipped.push({
        key: entry.key,
        reason: `unknown record ${entry.source}:${entry.sourceId}`,
      });
      continue;
    }
    if ('missing' in values) {
      report.skipped.push({ key: entry.key, reason: `missing ${values.missing}` });
      continue;
    }
    if (energyMismatch(values)) {
      const computed =
        4 * values.proteinG +
        4 * values.carbsG +
        9 * values.fatG +
        7 * (values.alcoholG ?? 0) +
        2 * (values.fiberG ?? 0);
      report.energyChecks.push({
        key: entry.key,
        kcal: values.kcal,
        computed: Math.round(computed),
      });
    }
    report.rows.push({ entry, values });
  }
  return report;
}

/** The import report, in Markdown, for the human and the professional reviewer. */
export function formatReport(
  report: BuildReport,
  catalogErrors: { line: number; reason: string }[],
) {
  const lines = [
    '# Food catalog import report',
    '',
    `- Imported: ${report.rows.length}`,
    `- Skipped: ${report.skipped.length}`,
    `- Invalid catalog rows: ${catalogErrors.length}`,
    `- Energy checks (kcal vs macros > 15 %): ${report.energyChecks.length}`,
    '',
  ];
  if (catalogErrors.length) {
    lines.push(
      '## Invalid catalog rows',
      '',
      ...catalogErrors.map((e) => `- line ${e.line}: ${e.reason}`),
      '',
    );
  }
  if (report.skipped.length) {
    lines.push('## Skipped', '', ...report.skipped.map((s) => `- ${s.key}: ${s.reason}`), '');
  }
  if (report.energyChecks.length) {
    lines.push(
      '## Energy checks',
      '',
      ...report.energyChecks.map(
        (c) => `- ${c.key}: ${c.kcal} kcal, macros give ${c.computed} kcal`,
      ),
      '',
    );
  }
  return lines.join('\n');
}
