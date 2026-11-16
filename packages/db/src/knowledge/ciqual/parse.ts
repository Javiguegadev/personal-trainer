import { parseSourceValue, toStoredValue, type ParsedValue, type Per100g } from '../values';

/**
 * CIQUAL 2025 XML (ANSES, Licence Ouverte / Etalab 2.0). The files are regular and flat, so a small
 * tag reader is enough: no XML dependency.
 */

/** Constituent codes used by the catalog (const.xml). */
export const CIQUAL_CONSTITUENTS = {
  /** Energy, Regulation (EU) 1169/2011, kcal/100 g. */
  kcal: '328',
  proteinG: '25000',
  carbsG: '31000',
  fatG: '40000',
  fiberG: '34100',
  alcoholG: '60000',
} as const;

export interface CiqualFood {
  code: string;
  nameFr: string;
  nameEn: string;
  groupCode: string;
  subgroupCode: string;
}

const decode = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

/** The text of `<tag> … </tag>` inside a record; null for `<tag missing=" " />` or no tag. */
function field(record: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(record);
  return match ? decode(match[1]!) : null;
}

function* records(xml: string, tag: string): Generator<string> {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  for (const match of xml.matchAll(pattern)) yield match[1]!;
}

/** alim.xml → foods by code. */
export function parseCiqualFoods(xml: string): Map<string, CiqualFood> {
  const foods = new Map<string, CiqualFood>();
  for (const record of records(xml, 'ALIM')) {
    const code = field(record, 'alim_code');
    if (!code) continue;
    foods.set(code, {
      code,
      nameFr: field(record, 'alim_nom_fr') ?? '',
      nameEn: field(record, 'alim_nom_eng') ?? '',
      groupCode: field(record, 'alim_grp_code') ?? '',
      subgroupCode: field(record, 'alim_ssgrp_code') ?? '',
    });
  }
  return foods;
}

/**
 * compo.xml → raw values of the catalog's constituents, by food code. `only` limits the foods kept
 * (the file has every constituent of every food: about 70 MB).
 */
export function parseCiqualComposition(
  xml: string,
  only?: ReadonlySet<string>,
): Map<string, Partial<Record<keyof typeof CIQUAL_CONSTITUENTS, ParsedValue>>> {
  const byCode = new Map<string, string>(
    Object.entries(CIQUAL_CONSTITUENTS).map(([name, code]) => [code, name]),
  );
  const result = new Map<string, Partial<Record<keyof typeof CIQUAL_CONSTITUENTS, ParsedValue>>>();
  for (const record of records(xml, 'COMPO')) {
    const constituent = byCode.get(field(record, 'const_code') ?? '') as
      keyof typeof CIQUAL_CONSTITUENTS | undefined;
    if (!constituent) continue;
    const code = field(record, 'alim_code');
    if (!code || (only && !only.has(code))) continue;
    const values = result.get(code) ?? {};
    values[constituent] = parseSourceValue(field(record, 'teneur'));
    result.set(code, values);
  }
  return result;
}

export type CiqualValues =
  ReturnType<typeof parseCiqualComposition> extends Map<string, infer V> ? V : never;

/**
 * Stored values per 100 g, or the name of the first required value that is missing (AC2: the food is
 * skipped and reported).
 */
export function toPer100g(values: CiqualValues): Per100g | { missing: string } {
  const required = ['kcal', 'proteinG', 'carbsG', 'fatG'] as const;
  const stored: Partial<Record<(typeof required)[number], number>> = {};
  for (const name of required) {
    const value = toStoredValue(values[name] ?? { kind: 'missing' });
    if (value === null) return { missing: name };
    stored[name] = value;
  }
  return {
    kcal: stored.kcal!,
    proteinG: stored.proteinG!,
    carbsG: stored.carbsG!,
    fatG: stored.fatG!,
    fiberG: toStoredValue(values.fiberG ?? { kind: 'missing' }),
    alcoholG: toStoredValue(values.alcoholG ?? { kind: 'missing' }),
  };
}
