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

/** Branded products, read one by one when a user scans a barcode (spec 006). */
export const OPEN_FOOD_FACTS: KnowledgeSourceDefinition = {
  id: 'open-food-facts',
  name: 'Open Food Facts',
  url: 'https://world.openfoodfacts.org',
  license: 'Open Database License (ODbL) 1.0',
  version: 'live',
  attributionEs:
    'Productos con código de barras: contiene datos de Open Food Facts (https://openfoodfacts.org), disponibles bajo la Open Database License (https://opendatacommons.org/licenses/odbl/1-0/). Los escriben voluntarios y pueden tener errores: comprueba siempre el envase.',
  attributionEn:
    'Products with a barcode: contains data from Open Food Facts (https://openfoodfacts.org), available under the Open Database License (https://opendatacommons.org/licenses/odbl/1-0/). It is written by volunteers and may contain errors: always check the package.',
};

/** The exercise catalog (spec 009 AC1, AC2), pinned to one commit of the repository. */
export const FREE_EXERCISE_DB: KnowledgeSourceDefinition & { dataUrl: string } = {
  id: 'free-exercise-db',
  name: 'Free Exercise DB',
  url: 'https://github.com/yuhonas/free-exercise-db',
  license: 'The Unlicense (public domain)',
  version: 'f00c92c (2026-09-27)',
  attributionEs:
    'Ejercicios: categorías, músculos y material de Free Exercise DB (https://github.com/yuhonas/free-exercise-db), de dominio público (The Unlicense). Nombres en español y sinónimos: elaboración propia.',
  attributionEn:
    'Exercises: categories, muscles and equipment from Free Exercise DB (https://github.com/yuhonas/free-exercise-db), public domain (The Unlicense). Spanish names and synonyms: our own work.',
  dataUrl: 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/f00c92c/dist/exercises.json',
};

/** The source of the foods a user creates. It is not a knowledge source and is never listed. */
export const USER_SOURCE: KnowledgeSourceDefinition = {
  id: 'user',
  name: 'User foods',
  url: '',
  license: '',
  version: '',
  attributionEs: '',
  attributionEn: '',
};

export const KNOWLEDGE_SOURCES = [
  CIQUAL_2025,
  OPEN_FOOD_FACTS,
  USER_SOURCE,
  FREE_EXERCISE_DB,
] as const;
