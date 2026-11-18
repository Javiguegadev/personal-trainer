import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildExerciseRows,
  formatExerciseReport,
  mapSourceExercise,
  parseExerciseCatalog,
  type SourceExercise,
} from './build';

const here = dirname(fileURLToPath(import.meta.url));
const HEADER = 'key,source_id,popularity,tracking,name_es,synonyms_es,name_en,synonyms_en';

describe('parseExerciseCatalog (spec 009 AC1)', () => {
  it('parses names, synonyms and tracking', () => {
    const { entries, errors } = parseExerciseCatalog(
      `${HEADER}\npress-banca,Barbell_Bench_Press_-_Medium_Grip,10,weight_reps,Press de banca,press banca | banca plana,Bench press,flat bench\n`,
    );
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      {
        key: 'press-banca',
        sourceId: 'Barbell_Bench_Press_-_Medium_Grip',
        popularity: 10,
        tracking: 'weight_reps',
        nameEs: 'Press de banca',
        nameEn: 'Bench press',
        synonymsEs: ['press banca', 'banca plana'],
        synonymsEn: ['flat bench'],
      },
    ]);
  });

  it('reports invalid rows and keeps the valid ones', () => {
    const { entries, errors } = parseExerciseCatalog(
      [
        HEADER,
        'a,A,5,reps,Uno,,One,',
        'Bad Key,B,5,reps,Dos,,Two,',
        'a,C,5,reps,Tres,,Three,',
        'd,A,5,reps,Cuatro,,Four,',
        'e,E,11,reps,Cinco,,Five,',
        'f,F,5,laps,Seis,,Six,',
        'g,G,5,reps,uno,,Seven,',
        'h,H,5,reps',
      ].join('\n'),
    );
    expect(entries.map((e) => e.key)).toEqual(['a']);
    expect(errors.map((e) => [e.line, e.reason])).toEqual([
      [3, 'Bad Key: key must be kebab-case ASCII'],
      [4, 'a: duplicate key'],
      [5, 'd: duplicate source record A'],
      [6, 'e: popularity must be 1–10'],
      [7, 'f: unknown tracking "laps"'],
      [8, 'g: duplicate name_es "uno"'],
      [9, 'expected 8 fields, got 4'],
    ]);
  });

  it('rejects a wrong header', () => {
    expect(parseExerciseCatalog('key,name\n').errors[0]?.line).toBe(1);
  });

  it('the committed catalog has no errors and about 150–200 exercises', () => {
    const text = readFileSync(resolve(here, '../catalog/exercises.csv'), 'utf8');
    const { entries, errors } = parseExerciseCatalog(text);
    expect(errors).toEqual([]);
    expect(entries.length).toBeGreaterThanOrEqual(150);
    expect(entries.length).toBeLessThanOrEqual(220);
  });
});

const record = (overrides: Partial<SourceExercise> = {}): SourceExercise => ({
  id: 'Barbell_Bench_Press_-_Medium_Grip',
  name: 'Barbell Bench Press - Medium Grip',
  category: 'strength',
  equipment: 'barbell',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['shoulders', 'triceps'],
  ...overrides,
});

describe('mapSourceExercise (spec 009 AC1)', () => {
  it('maps category, muscles and equipment to our enums', () => {
    expect(mapSourceExercise(record())).toEqual({
      category: 'strength',
      primaryMuscles: ['chest'],
      secondaryMuscles: ['shoulders', 'triceps'],
      equipment: ['barbell'],
      unmapped: [],
    });
  });

  it('merges source muscles into our groups without duplicates', () => {
    const mapped = mapSourceExercise(
      record({
        category: 'powerlifting',
        equipment: 'e-z curl bar',
        primaryMuscles: ['lats', 'middle back'],
        secondaryMuscles: ['lower back', 'biceps'],
      }),
    );
    expect(mapped.category).toBe('strength');
    expect(mapped.primaryMuscles).toEqual(['back']);
    expect(mapped.secondaryMuscles).toEqual(['biceps']);
    expect(mapped.equipment).toEqual(['barbell']);
  });

  it('maps a missing or unknown equipment to other and reports unknown values', () => {
    const mapped = mapSourceExercise(
      record({ equipment: null, category: 'yoga', primaryMuscles: ['toes'] }),
    );
    expect(mapped.equipment).toEqual(['other']);
    expect(mapped.category).toBe('other');
    expect(mapped.unmapped.sort()).toEqual(['category "yoga"', 'muscle "toes"']);
  });
});

describe('buildExerciseRows (spec 009 AC1)', () => {
  const { entries } = parseExerciseCatalog(
    `${HEADER}\npress-banca,Barbell_Bench_Press_-_Medium_Grip,10,weight_reps,Press de banca,,Bench press,\nfantasma,Ghost,3,reps,Fantasma,,Ghost,\n`,
  );
  const report = buildExerciseRows(entries, new Map([[record().id, record()]]));

  it('imports the entries with a source record and skips the others', () => {
    expect(report.rows.map((r) => r.key)).toEqual(['press-banca']);
    expect(report.rows[0]?.equipment).toEqual(['barbell']);
    expect(report.skipped).toEqual([{ key: 'fantasma', reason: 'unknown record Ghost' }]);
  });

  it('formats a report with every section', () => {
    const text = formatExerciseReport(report, [{ line: 4, reason: 'x: duplicate key' }]);
    expect(text).toContain('Imported: 1');
    expect(text).toContain('- fantasma: unknown record Ghost');
    expect(text).toContain('- line 4: x: duplicate key');
  });
});
