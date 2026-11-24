import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid } from 'drizzle-orm/supabase';
import { foodInputMethodEnum, foodOriginEnum, mealTypeEnum, quantityUnitEnum } from './enums';
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

/**
 * Every food a user can log. The curated catalog (spec 005 AC1: values per 100 g from the source, names
 * written by us), the products read from Open Food Facts when someone scans their barcode, and the
 * foods a user creates, which only their owner can read (spec 006). The three stay apart by `origin`
 * and `source`: Open Food Facts rows keep the values of their source unchanged (ODbL).
 */
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
    origin: foodOriginEnum('origin').notNull().default('catalog'),
    /** Unit of the "per 100" values and of the portions: the one the label uses. */
    quantityUnit: quantityUnitEnum('quantity_unit').notNull().default('g'),
    brand: text('brand'),
    /** Canonical form (`normalizeBarcode`): 8 or 13 digits. */
    barcode: text('barcode'),
    /** Set for a food its user created; such a row is private (RLS). */
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'cascade' }),
    /** Open Food Facts tags (`en:milk`); empty means "no data", never "free of". */
    allergens: text('allergens')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    traces: text('traces')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** When Open Food Facts was read: the product is read again after 90 days (spec 006 AC3). */
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
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
    index('foods_barcode_idx').on(t.barcode),
    index('foods_owner_id_idx').on(t.ownerId),
    // A user keeps one food per barcode, so a scan finds it (spec 006 AC3).
    uniqueIndex('foods_owner_barcode_key')
      .on(t.ownerId, t.barcode)
      .where(sql`${t.ownerId} is not null and ${t.barcode} is not null`),
    check(
      'foods_owner_matches_origin',
      sql`(${t.ownerId} is null) = (${t.origin} in ('catalog', 'off'))`,
    ),
    // The name dates from spec 005, when every row was public; a custom food is read by its owner only.
    pgPolicy('foods_select_all', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.ownerId} is null or ${t.ownerId} = ${authUid}`,
    }),
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
      using: sql`exists (select 1 from ${foods} f where f.id = ${t.foodId} and (f.owner_id is null or f.owner_id = ${authUid}))`,
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
    /** Snapshot of the food's unit: `grams` holds millilitres for a food labelled per 100 ml. */
    quantityUnit: quantityUnitEnum('quantity_unit').notNull().default('g'),
    kcal: snapshot('kcal').notNull(),
    proteinG: snapshot('protein_g').notNull(),
    carbsG: snapshot('carbs_g').notNull(),
    fatG: snapshot('fat_g').notNull(),
    fiberG: snapshot('fiber_g'),
    inputMethod: foodInputMethodEnum('input_method').notNull(),
    /** The planned item it logs (spec 013 AC8): the plan shows it as done while this row lives. */
    plannedItemId: uuid('planned_item_id').references((): AnyPgColumn => plannedMealItems.id, {
      onDelete: 'set null',
    }),
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
    index('meal_items_user_planned_item_idx').on(t.userId, t.plannedItemId),
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

/**
 * The meals planned by hand (spec 013, the Plans block of BLUEPRINT §5): the shape of `meal_items`
 * without how the item was logged, stored apart so a plan never counts as eaten (ADR 006). A planned
 * meal is the planned items of one day and meal type; the AI plans of E7 add a container and an origin.
 * A delete keeps the row as a tombstone so an older write cannot bring it back (AC23).
 * RLS: users may only read their own rows; every write goes through apps/api.
 */
export const plannedMealItems = pgTable(
  'planned_meal_items',
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
    quantityUnit: quantityUnitEnum('quantity_unit').notNull().default('g'),
    kcal: snapshot('kcal').notNull(),
    proteinG: snapshot('protein_g').notNull(),
    carbsG: snapshot('carbs_g').notNull(),
    fatG: snapshot('fat_g').notNull(),
    fiberG: snapshot('fiber_g'),
    /** Device time of the write: the later one wins, also against a delete (AC23). */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('planned_meal_items_user_date_idx').on(t.userId, t.localDate),
    check(
      'planned_meal_items_grams_range',
      sql`${t.grams} is null or ${t.grams} between 1 and 2000`,
    ),
    check(
      'planned_meal_items_nutrients_non_negative',
      sql`${t.kcal} >= 0 and ${t.proteinG} >= 0 and ${t.carbsG} >= 0 and ${t.fatG} >= 0 and (${t.fiberG} is null or ${t.fiberG} >= 0)`,
    ),
    pgPolicy('planned_meal_items_select_own', {
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

/**
 * Barcodes Open Food Facts did not know, or whose product had no usable values (spec 006 AC6): the same
 * code is not asked again for 24 hours. No user data. RLS without policies: only the API reads it.
 */
export const barcodeMisses = pgTable('barcode_misses', {
  barcode: text('barcode').primaryKey(),
  /** `not_found` or `incomplete`. */
  reason: text('reason').notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
}).enableRLS();
