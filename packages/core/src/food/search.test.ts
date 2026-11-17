import { describe, expect, it } from 'vitest';
import {
  buildFoodSearchIndex,
  normalizeSearchText,
  searchFoods,
  type SearchableFood,
} from './search';

const food = (
  id: string,
  nameEs: string,
  popularity = 5,
  synonymsEs: string[] = [],
  nameEn = id,
): SearchableFood => ({ id, nameEs, nameEn, synonymsEs, popularity });

const CATALOG = [
  food('leche-semi', 'Leche semidesnatada', 9, [], 'Semi-skimmed milk'),
  food('leche-cabra', 'Leche de cabra', 3, [], 'Goat milk'),
  food('leche-entera', 'Leche entera', 7, [], 'Whole milk'),
  food(
    'pechuga',
    'Pechuga de pollo a la plancha',
    8,
    ['filete de pollo'],
    'Chicken breast, grilled',
  ),
  food('pollo-asado', 'Pollo asado', 6, [], 'Roast chicken'),
  food('platano', 'Plátano', 9, ['banana', 'banano'], 'Banana'),
  food('patata', 'Patata cocida', 7, ['papa cocida'], 'Boiled potato'),
  food('judias', 'Judías verdes cocidas', 6, ['vainas', 'ejotes'], 'Green beans, boiled'),
  food('cacao', 'Cacao soluble azucarado', 6, ['colacao', 'nesquik'], 'Sweetened cocoa powder'),
  food('huevo', 'Huevo entero', 9, [], 'Whole egg'),
  food('pan', 'Pan', 8, [], 'Bread'),
  food('pan-integral', 'Pan integral', 7, [], 'Wholemeal bread'),
  food('panceta', 'Panceta', 4, [], 'Pork belly'),
];
const index = buildFoodSearchIndex(CATALOG);
const ids = (query: string, locale: 'es' | 'en' = 'es', limit = 25) =>
  searchFoods(index, query, locale, limit);

describe('normalizeSearchText', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeSearchText('  Plátano, CANARIO!  ')).toBe('platano canario');
    expect(normalizeSearchText('Judías  verdes')).toBe('judias verdes');
    expect(normalizeSearchText('Pingüino ñu')).toBe('pinguino nu');
  });
});

describe('searchFoods (spec 005 AC4)', () => {
  it('needs at least 2 characters', () => {
    expect(ids('p')).toEqual([]);
    expect(ids('  ')).toEqual([]);
  });

  it('ranks by popularity among equal matches', () => {
    expect(ids('leche')).toEqual(['leche-semi', 'leche-entera', 'leche-cabra']);
  });

  it('puts a whole-name match first', () => {
    expect(ids('pan')[0]).toBe('pan');
    expect(ids('pan')).toEqual(['pan', 'pan-integral', 'panceta']);
  });

  it('matches every word by prefix, in any order', () => {
    expect(ids('pech poll')).toEqual(['pechuga']);
    expect(ids('pollo pechuga')).toEqual(['pechuga']);
    // a name that starts with the query comes before a match on a later word
    expect(ids('pollo')).toEqual(['pollo-asado', 'pechuga']);
  });

  it('ignores accents and case in the query', () => {
    expect(ids('PLATANO')).toEqual(['platano']);
    expect(ids('judias')).toEqual(['judias']);
  });

  it('matches synonyms after names', () => {
    expect(ids('papa')).toEqual(['patata']);
    expect(ids('vainas')).toEqual(['judias']);
    expect(ids('colacao')).toEqual(['cacao']);
    expect(ids('filete de pollo')).toEqual(['pechuga']);
  });

  it('ignores Spanish stop words in the query', () => {
    expect(ids('leche de cabra')).toEqual(['leche-cabra']);
    expect(ids('pechuga de pollo')).toEqual(['pechuga']);
  });

  it('matches Spanish plurals', () => {
    const plurals = buildFoodSearchIndex([
      food('melocoton', 'Melocotón', 7),
      food('nuez', 'Nuez', 6),
      food('yogur', 'Yogur natural', 8),
    ]);
    expect(searchFoods(plurals, 'melocotones', 'es', 25)).toEqual(['melocoton']);
    expect(searchFoods(plurals, 'nueces', 'es', 25)).toEqual(['nuez']);
    expect(searchFoods(plurals, 'yogures', 'es', 25)).toEqual(['yogur']);
  });

  it('ignores quantity words in the query', () => {
    expect(ids('un vaso de leche entera')).toEqual(['leche-entera']);
    expect(ids('cucharada de colacao')).toEqual(['cacao']);
  });

  it('tolerates one typo in words of 5 letters or more', () => {
    expect(ids('platno')).toEqual(['platano']);
    expect(ids('pltano')).toEqual(['platano']);
    expect(ids('huevos')).toEqual(['huevo']);
    expect(ids('pechga')).toEqual(['pechuga']);
  });

  it('does not tolerate typos in short words', () => {
    expect(ids('pam')).toEqual([]);
  });

  it('ranks exact matches above typo matches', () => {
    const typoCatalog = buildFoodSearchIndex([food('pera', 'Pera', 9), food('perla', 'Perla', 2)]);
    expect(searchFoods(typoCatalog, 'perla', 'es', 25)).toEqual(['perla', 'pera']);
  });

  it('searches English names only with the English locale', () => {
    expect(ids('milk')).toEqual([]);
    expect(ids('milk', 'en')).toEqual(['leche-semi', 'leche-entera', 'leche-cabra']);
    expect(ids('leche', 'en')[0]).toBe('leche-semi');
  });

  it('returns at most `limit` results', () => {
    expect(ids('leche', 'es', 2)).toEqual(['leche-semi', 'leche-entera']);
  });
});

describe('searchFoods with recently logged foods (spec 007)', () => {
  const recent = new Set(['leche-cabra']);

  it('puts a recently logged food first among equal matches', () => {
    expect(searchFoods(index, 'leche', 'es', 25, undefined, recent)).toEqual([
      'leche-cabra',
      'leche-semi',
      'leche-entera',
    ]);
  });

  it('never lifts a recent food above a better match', () => {
    // "Pan" is a whole-name match; "Panceta" only a prefix, even when it was logged recently.
    expect(searchFoods(index, 'pan', 'es', 25, undefined, new Set(['panceta']))[0]).toBe('pan');
  });
});
