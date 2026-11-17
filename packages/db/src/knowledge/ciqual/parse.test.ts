import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { energyMismatch, parseSourceValue, toStoredValue } from '../values';
import { parseCiqualComposition, parseCiqualFoods, toPer100g } from './parse';

const fixture = (name: string) =>
  readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), 'utf8');

describe('source values (spec 005 AC2)', () => {
  it.each([
    ['12,5', { kind: 'number', value: 12.5 }],
    [' 899 ', { kind: 'number', value: 899 }],
    ['0.25', { kind: 'number', value: 0.25 }],
    ['traces', { kind: 'traces' }],
    ['< 20', { kind: 'below', limit: 20 }],
    ['<0,5', { kind: 'below', limit: 0.5 }],
    ['-', { kind: 'missing' }],
    ['', { kind: 'missing' }],
    [null, { kind: 'missing' }],
  ] as const)('parses %j', (raw, parsed) => {
    expect(parseSourceValue(raw)).toEqual(parsed);
  });

  it('stores traces and "< x" as 0 and keeps missing as null', () => {
    expect(toStoredValue({ kind: 'traces' })).toBe(0);
    expect(toStoredValue({ kind: 'below', limit: 20 })).toBe(0);
    expect(toStoredValue({ kind: 'missing' })).toBeNull();
    expect(toStoredValue({ kind: 'number', value: 3.3 })).toBe(3.3);
  });

  it('flags kcal more than 15 % away from the macros', () => {
    const base = { fiberG: null, alcoholG: null };
    // 4·10 + 4·20 + 9·5 = 165
    expect(energyMismatch({ ...base, kcal: 165, proteinG: 10, carbsG: 20, fatG: 5 })).toBe(false);
    expect(energyMismatch({ ...base, kcal: 190, proteinG: 10, carbsG: 20, fatG: 5 })).toBe(false);
    expect(energyMismatch({ ...base, kcal: 200, proteinG: 10, carbsG: 20, fatG: 5 })).toBe(true);
    // fiber counts 2 kcal/g: 4·1 + 2·10 = 24
    expect(energyMismatch({ ...base, kcal: 24, proteinG: 1, carbsG: 0, fatG: 0, fiberG: 10 })).toBe(
      false,
    );
    // alcohol counts 7 kcal/g: 7·10 = 70
    expect(
      energyMismatch({ ...base, kcal: 70, proteinG: 0, carbsG: 0, fatG: 0, alcoholG: 10 }),
    ).toBe(false);
    // under 20 kcal, an absolute margin of 3 kcal
    expect(energyMismatch({ ...base, kcal: 2, proteinG: 0.2, carbsG: 0.3, fatG: 0 })).toBe(false);
    expect(energyMismatch({ ...base, kcal: 10, proteinG: 0, carbsG: 1, fatG: 0 })).toBe(true);
  });
});

describe('CIQUAL parser (spec 005 AC1, AC2)', () => {
  const foods = parseCiqualFoods(fixture('ciqual-alim.xml'));
  const compo = parseCiqualComposition(fixture('ciqual-compo.xml'));

  it('reads the foods with their names and groups, decoding entities', () => {
    expect(foods.size).toBe(4);
    expect(foods.get('17270')).toEqual({
      code: '17270',
      nameFr: "Huile d'olive vierge extra",
      nameEn: 'Olive oil, extra virgin',
      groupCode: '09',
      subgroupCode: '0902',
    });
    expect(foods.get('99999')!.nameEn).toBe('Food without fat & co');
  });

  it('spot-checks known values per 100 g', () => {
    const oil = toPer100g(compo.get('17270')!);
    expect(oil).toEqual({
      kcal: 899,
      proteinG: 0.25,
      carbsG: 0,
      fatG: 99.9,
      fiberG: 0,
      alcoholG: 0,
    });
    expect(toPer100g(compo.get('36017')!)).toMatchObject({
      kcal: 110,
      proteinG: 23.4,
      fiberG: null,
    });
    expect(toPer100g(compo.get('19024')!)).toMatchObject({ kcal: 61.8, proteinG: 3.3, fatG: 0 });
  });

  it('ignores constituents the catalog does not use', () => {
    expect(Object.keys(compo.get('17270')!).sort()).toEqual(
      ['alcoholG', 'carbsG', 'fatG', 'fiberG', 'kcal', 'proteinG'].sort(),
    );
  });

  it('reports the first missing required value', () => {
    expect(toPer100g(compo.get('99999')!)).toEqual({ missing: 'fatG' });
  });

  it('keeps only the requested foods', () => {
    expect([
      ...parseCiqualComposition(fixture('ciqual-compo.xml'), new Set(['19024'])).keys(),
    ]).toEqual(['19024']);
  });
});
