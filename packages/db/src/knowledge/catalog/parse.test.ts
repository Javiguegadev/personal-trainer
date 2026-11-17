import { describe, expect, it } from 'vitest';
import { CATALOG_COLUMNS, parseCatalog, parseCsv } from './parse';

const HEADER = CATALOG_COLUMNS.join(',');

describe('parseCsv', () => {
  it('reads quoted fields with commas, doubled quotes and CRLF lines', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });
});

describe('parseCatalog (spec 005 AC1)', () => {
  it('reads names, synonyms and servings in both languages', () => {
    const csv = `${HEADER}
d-huevo,ciqual-2025,22000,9,Huevo entero crudo,huevo | huevos,1 huevo mediano (55 g) | 1 huevo grande (65 g),"Egg, whole, raw",1 medium egg (55 g) | 1 large egg (65 g)`;
    expect(parseCatalog(csv)).toEqual({
      errors: [],
      entries: [
        {
          key: 'd-huevo',
          source: 'ciqual-2025',
          sourceId: '22000',
          popularity: 9,
          nameEs: 'Huevo entero crudo',
          nameEn: 'Egg, whole, raw',
          synonymsEs: ['huevo', 'huevos'],
          servings: [
            { labelEs: '1 huevo mediano', labelEn: '1 medium egg', grams: 55 },
            { labelEs: '1 huevo grande', labelEn: '1 large egg', grams: 65 },
          ],
        },
      ],
    });
  });

  it('reports invalid rows and keeps the valid ones', () => {
    const csv = `${HEADER}
b-ok,ciqual-2025,1,5,Manzana,,1 pieza (150 g),Apple,1 piece (150 g)
B Bad,ciqual-2025,2,5,X,,,X,
b-dup,ciqual-2025,1,5,Manzana 2,,,Apple 2,
b-pop,ciqual-2025,3,12,X,,,X,
b-grams,ciqual-2025,4,5,X,,1 vaso,X,1 glass
b-mismatch,ciqual-2025,5,5,X,,1 vaso (200 g),X,1 glass (250 g)
b-ok,ciqual-2025,6,5,X,,,X,`;
    const result = parseCatalog(csv);
    expect(result.entries.map((e) => e.key)).toEqual(['b-ok']);
    expect(result.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(result.errors[1]!.reason).toContain('duplicate source record');
    expect(result.errors[5]!.reason).toContain('duplicate key');
  });

  it('rejects a file with another header', () => {
    expect(parseCatalog('key,name\nx,y').errors[0]!.line).toBe(1);
  });
});
