import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid } from 'drizzle-orm/supabase';
import { foodInputMethodEnum, mealTypeEnum } from './enums';
import { profiles } from './profiles';

const nutrient = (name: string) => numeric(name, { precision: 6, scale: 2, mode: 'number' });
const snapshot = (name: string) => numeric(name, { precision: 7, scale: 2, mode: 'number' });

/**
 * Every imported knowledge source, with its license and attribution (spec 005 AC3). Public catalog:
 * any signed-in user may read it; only the importer (service connection) writes it.
 */
export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    /** `ciqual-2025`, `usda-fdc-2025-04`… */
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    license: text('license').notNull(),
    version: text('version').notNull(),
    attributionEs: text('attribution_es').notNull(),
    attributionEn: text('attribution_en').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('knowledge_sources_select_all', {
      for: 'select',
      to: authenticatedRole,
      using: sql`true`,
    }),
  ],
);

/** The curated food catalog (spec 005 AC1): values per 100 g from the source, names written by us. */
export const foods = pgTable(
  'foods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable curated key (`huevo-entero`). */
    key: text('key').notNull().unique(),
    source: text('source')
      .notNull()
      .references(() => knowledgeSources.id),
    sourceId: text('source_id').notNull(),
    nameEs: text('name_es').notNull(),
    nameEn: text('name_en').notNull(),
    synonymsEs: text('synonyms_es')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Tie-break in search (AC4): higher first. */
    popularity: smallint('popularity').notNull().default(0),
    kcal100g: nutrient('kcal_100g').notNull(),
    proteinG100g: nutrient('protein_g_100g').notNull(),
    carbsG100g: nutrient('carbs_g_100g').notNull(),
    fatG100g: nutrient('fat_g_100g').notNull(),
    fiberG100g: nutrient('fiber_g_100g'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('foods_source_source_id_key').on(t.source, t.sourceId),
    check(
      'foods_nutrients_non_negative',
      sql`${t.kcal100g} >= 0 and ${t.proteinG100g} >= 0 and ${t.carbsG100g} >= 0 and ${t.fatG100g} >= 0 and (${t.fiberG100g} is null or ${t.fiberG100g} >= 0)`,
    ),
    pgPolicy('foods_select_all', { for: 'select', to: authenticatedRole, using: sql`true` }),
  ],
);

/** Household servings of a food ("1 huevo mediano", 60 g), most common first (AC8). */
export const foodServings = pgTable(
  'food_servings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    foodId: uuid('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    labelEs: text('label_es').notNull(),
    labelEn: text('label_en').notNull(),
    grams: numeric('grams', { precision: 6, scale: 1, mode: 'number' }).notNull(),
    sort: smallint('sort').notNull().default(0),
  },
  (t) => [
    index('food_servings_food_id_idx').on(t.foodId, t.sort),
    check('food_servings_grams_positive', sql`${t.grams} > 0`),
    pgPolicy('food_servings_select_all', {
      for: 'select',
      to: authenticatedRole,
      using: sql`true`,
    }),
  ],
);

/**
 * The food log (spec 005): one row per logged item, with a client-generated id (offline-safe `PUT`).
 * A meal is the set of items with the same day and meal type. Kcal and macros are a snapshot (AC9).
 * A delete keeps the row as a tombstone (`deleted_at`) so an older write cannot bring it back (AC20).
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const mealItems = pgTable(
  'meal_items',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    mealType: mealTypeEnum('meal_type').notNull(),
    /** Null for a quick add, or when the food left the catalog. */
    foodId: uuid('food_id').references(() => foods.id, { onDelete: 'set null' }),
    servingId: uuid('serving_id').references(() => foodServings.id, { onDelete: 'set null' }),
    servings: numeric('servings', { precision: 4, scale: 2, mode: 'number' }),
    servingLabel: text('serving_label'),
    label: text('label').notNull(),
    grams: numeric('grams', { precision: 6, scale: 1, mode: 'number' }),
    kcal: snapshot('kcal').notNull(),
    proteinG: snapshot('protein_g').notNull(),
    carbsG: snapshot('carbs_g').notNull(),
    fatG: snapshot('fat_g').notNull(),
    fiberG: snapshot('fiber_g'),
    inputMethod: foodInputMethodEnum('input_method').notNull(),
    /** Device time of the write: the later one wins, also against a delete (AC20). */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('meal_items_user_date_idx').on(t.userId, t.localDate),
    index('meal_items_user_food_recorded_idx').on(t.userId, t.foodId, t.recordedAt.desc()),
    check('meal_items_grams_range', sql`${t.grams} is null or ${t.grams} between 1 and 2000`),
    check(
      'meal_items_nutrients_non_negative',
      sql`${t.kcal} >= 0 and ${t.proteinG} >= 0 and ${t.carbsG} >= 0 and ${t.fatG} >= 0 and (${t.fiberG} is null or ${t.fiberG} >= 0)`,
    ),
    pgPolicy('meal_items_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);

/** Starred foods (AC14). */
export const favouriteFoods = pgTable(
  'favourite_foods',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    foodId: uuid('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.foodId] }),
    pgPolicy('favourite_foods_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
  ],
);
