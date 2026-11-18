/**
 * The curated exercise catalog (`catalog/exercises.csv`, spec 009 AC1): which free-exercise-db records
 * we use, how each one is tracked, and the names and synonyms we wrote. Category, muscles and equipment
 * always come from the source record, mapped to our enums.
 */
import {
  ExerciseTrackingSchema,
  type Equipment,
  type ExerciseCategory,
  type ExerciseTracking,
  type MuscleGroup,
} from '@pt/contracts';
import { parseCsv } from '../catalog/parse';

export const EXERCISE_CATALOG_COLUMNS = [
  'key',
  'source_id',
  'popularity',
  'tracking',
  'name_es',
  'synonyms_es',
  'name_en',
  'synonyms_en',
] as const;

export interface ExerciseCatalogEntry {
  key: string;
  sourceId: string;
  popularity: number;
  tracking: ExerciseTracking;
  nameEs: string;
  nameEn: string;
  synonymsEs: string[];
  synonymsEn: string[];
}

export interface ExerciseCatalogParseResult {
  entries: ExerciseCatalogEntry[];
  /** Line number (1 = header) and reason, for rows that cannot be used. */
  errors: { line: number; reason: string }[];
}

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_MAX = 80;

const list = (text: string) =>
  text
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

/** Parses and validates `exercises.csv`; invalid rows are reported, never imported. */
export function parseExerciseCatalog(text: string): ExerciseCatalogParseResult {
  const [header, ...rows] = parseCsv(text);
  const expected = EXERCISE_CATALOG_COLUMNS.join(',');
  if (!header || header.map((h) => h.trim()).join(',') !== expected) {
    return { entries: [], errors: [{ line: 1, reason: `header must be ${expected}` }] };
  }
  const entries: ExerciseCatalogEntry[] = [];
  const errors: { line: number; reason: string }[] = [];
  const keys = new Set<string>();
  const records = new Set<string>();
  const names = new Set<string>();
  rows.forEach((cells, index) => {
    const line = index + 2;
    if (cells.length !== EXERCISE_CATALOG_COLUMNS.length) {
      errors.push({
        line,
        reason: `expected ${EXERCISE_CATALOG_COLUMNS.length} fields, got ${cells.length}`,
      });
      return;
    }
    const [key, sourceId, popularity, tracking, nameEs, synonymsEs, nameEn, synonymsEn] = cells.map(
      (cell) => cell.trim(),
    ) as [string, string, string, string, string, string, string, string];
    const fail = (reason: string) => errors.push({ line, reason: `${key || '?'}: ${reason}` });
    if (!KEY.test(key)) return fail('key must be kebab-case ASCII');
    if (keys.has(key)) return fail('duplicate key');
    if (!sourceId) return fail('source_id is required');
    if (records.has(sourceId)) return fail(`duplicate source record ${sourceId}`);
    const pop = Number(popularity);
    if (!Number.isInteger(pop) || pop < 1 || pop > 10) return fail('popularity must be 1–10');
    const parsedTracking = ExerciseTrackingSchema.safeParse(tracking);
    if (!parsedTracking.success) return fail(`unknown tracking "${tracking}"`);
    if (!nameEs || !nameEn) return fail('name_es and name_en are required');
    if (nameEs.length > NAME_MAX || nameEn.length > NAME_MAX) return fail('name too long');
    if (names.has(nameEs.toLowerCase())) return fail(`duplicate name_es "${nameEs}"`);
    keys.add(key);
    records.add(sourceId);
    names.add(nameEs.toLowerCase());
    entries.push({
      key,
      sourceId,
      popularity: pop,
      tracking: parsedTracking.data,
      nameEs,
      nameEn,
      synonymsEs: list(synonymsEs),
      synonymsEn: list(synonymsEn),
    });
  });
  return { entries, errors };
}

/** One record of free-exercise-db (`dist/exercises.json`); only the fields we read. */
export interface SourceExercise {
  id: string;
  name: string;
  category: string;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
}

const CATEGORY: Record<string, ExerciseCategory> = {
  strength: 'strength',
  powerlifting: 'strength',
  'olympic weightlifting': 'strength',
  strongman: 'strength',
  cardio: 'cardio',
  plyometrics: 'plyometrics',
  stretching: 'mobility',
};

const MUSCLE: Record<string, MuscleGroup> = {
  abdominals: 'core',
  abductors: 'glutes',
  adductors: 'quads',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'back',
  'lower back': 'back',
  'middle back': 'back',
  neck: 'back',
  quadriceps: 'quads',
  shoulders: 'shoulders',
  traps: 'back',
  triceps: 'triceps',
};

const EQUIPMENT: Record<string, Equipment> = {
  barbell: 'barbell',
  'e-z curl bar': 'barbell',
  dumbbell: 'dumbbell',
  machine: 'machine',
  cable: 'cable',
  kettlebells: 'kettlebell',
  bands: 'band',
  'body only': 'bodyweight',
};

const unique = <T>(values: T[]) => [...new Set(values)];

export interface MappedSourceExercise {
  category: ExerciseCategory;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment[];
  /** Source values with no mapping (reported, mapped to `other` or dropped). */
  unmapped: string[];
}

/** Maps a source record's category, muscles and equipment to our enums. */
export function mapSourceExercise(record: SourceExercise): MappedSourceExercise {
  const unmapped: string[] = [];
  const muscles = (values: string[]) =>
    unique(
      values.flatMap((value) => {
        const muscle = MUSCLE[value];
        if (!muscle) unmapped.push(`muscle "${value}"`);
        return muscle ? [muscle] : [];
      }),
    );
  const category = CATEGORY[record.category];
  if (!category) unmapped.push(`category "${record.category}"`);
  const primaryMuscles = muscles(record.primaryMuscles);
  return {
    category: category ?? 'other',
    primaryMuscles,
    secondaryMuscles: muscles(record.secondaryMuscles).filter((m) => !primaryMuscles.includes(m)),
    equipment: [(record.equipment && EQUIPMENT[record.equipment]) || 'other'],
    unmapped,
  };
}

export interface ExerciseRow extends ExerciseCatalogEntry, MappedSourceExercise {}

export interface ExerciseImportReport {
  rows: ExerciseRow[];
  skipped: { key: string; reason: string }[];
  /** Mapped rows with source values we do not know (the enum mapping needs a look). */
  warnings: { key: string; reason: string }[];
}

/** Joins the curated entries with their source records. */
export function buildExerciseRows(
  entries: ExerciseCatalogEntry[],
  records: ReadonlyMap<string, SourceExercise>,
): ExerciseImportReport {
  const report: ExerciseImportReport = { rows: [], skipped: [], warnings: [] };
  for (const entry of entries) {
    const record = records.get(entry.sourceId);
    if (!record) {
      report.skipped.push({ key: entry.key, reason: `unknown record ${entry.sourceId}` });
      continue;
    }
    const mapped = mapSourceExercise(record);
    if (mapped.unmapped.length > 0) {
      report.warnings.push({ key: entry.key, reason: `unmapped ${mapped.unmapped.join(', ')}` });
    }
    report.rows.push({ ...entry, ...mapped });
  }
  return report;
}

export function formatExerciseReport(
  report: ExerciseImportReport,
  errors: { line: number; reason: string }[],
): string {
  const section = (title: string, lines: string[]) =>
    [`## ${title} (${lines.length})`, '', ...(lines.length ? lines : ['None.']), ''].join('\n');
  return [
    '# Exercise catalog import report',
    '',
    `Imported: ${report.rows.length}`,
    `Skipped: ${report.skipped.length}`,
    `CSV errors: ${errors.length}`,
    `Warnings: ${report.warnings.length}`,
    '',
    section(
      'CSV errors',
      errors.map((e) => `- line ${e.line}: ${e.reason}`),
    ),
    section(
      'Skipped',
      report.skipped.map((s) => `- ${s.key}: ${s.reason}`),
    ),
    section(
      'Warnings',
      report.warnings.map((w) => `- ${w.key}: ${w.reason}`),
    ),
  ].join('\n');
}
