/**
 * Knowledge sources the catalog imports from (spec 005 AC3). The attribution is shown in Profile →
 * "Fuentes de datos" and in the README.
 */
export interface KnowledgeSourceDefinition {
  id: string;
  name: string;
  url: string;
  license: string;
  version: string;
  attributionEs: string;
  attributionEn: string;
}

export const CIQUAL_2025: KnowledgeSourceDefinition & {
  /** Recherche Data Gouv file ids of the XML files (dataset doi:10.57745/RDMHWY). */
  files: { alim: string; compo: string };
} = {
  id: 'ciqual-2025',
  name: 'Ciqual 2025 (Anses)',
  url: 'https://doi.org/10.57745/RDMHWY',
  license: 'Licence Ouverte / Etalab 2.0',
  version: '2025-11-03',
  attributionEs:
    'Valores nutricionales: Anses, tabla de composición nutricional de los alimentos Ciqual 2025 (Francia), Licence Ouverte / Etalab 2.0. Nombres en español, sinónimos y raciones: elaboración propia.',
  attributionEn:
    'Nutrition values: Anses, Ciqual 2025 food composition table (France), Licence Ouverte / Etalab 2.0. Spanish names, synonyms and servings: our own work.',
  files: { alim: '666252', compo: '666249' },
};

export const KNOWLEDGE_SOURCES = [CIQUAL_2025] as const;
