/**
 * In-memory implementation of `ApiClient` for development and E2E tests (no Supabase, no cost).
 * It applies the same rules as apps/api: auth (401), consent (403), Zod validation (400 with `fields`),
 * and @pt/core safety and targets (422 `age_blocked`).
 * Never use it in production builds: the app enables it only with `__DEV__` and an explicit flag.
 */
import {
  BarcodeParamSchema,
  CONSENT_VERSION,
  CUSTOM_FOOD_LIMITS,
  ConsentRequestSchema,
  CustomFoodUpsertRequestSchema,
  FOOD_LOG_LIMITS,
  FoodIdParamSchema,
  FoodLocaleQuerySchema,
  FoodLogQuerySchema,
  FoodSearchQuerySchema,
  LABEL_SCAN_LIMITS,
  LabelScanRequestSchema,
  MEAL_DRAFT_LIMITS,
  MealPhotoDraftRequestSchema,
  MealTextDraftRequestSchema,
  MealItemDeleteQuerySchema,
  MealItemIdParamSchema,
  MealItemUpsertRequestSchema,
  ProfileInputSchema,
  WEIGHT_LIMITS,
  WeightDateParamSchema,
  WeightDeleteQuerySchema,
  WeightListQuerySchema,
  WeightUpsertRequestSchema,
  type ApiErrorCode,
  type DietaryPrefs,
  type ExportResponse,
  type Food,
  type LabelReading,
  type Locale,
  type MealItem,
  type MeResponse,
  type Portion,
  type Profile,
  type WeightEntry,
  type WeightSaveResponse,
} from '@pt/contracts';
import {
  addDays,
  applyLatestWeight,
  buildFoodSearchIndex,
  checkCustomFood,
  checkFoodLogRange,
  checkFoodLogWrite,
  checkWeightWrite,
  customFoodAsFood,
  daysBetween,
  evaluateProfileInput,
  isInStoreBarcode,
  labelDraft,
  mealDraft,
  mealItemFromRequest,
  normalizeBarcode,
  searchFoods,
  searchableBrandedFood,
  targetsOnly,
  writeWins,
} from '@pt/core';
import type { z } from 'zod';
import { ApiError, type ApiClient } from '../client';
import { MOCK_CATALOG, MOCK_SOURCE, toMockFood } from './foods';
import { mockPhotoReading, mockTextReading } from './drafts';
import { mockProduct, mockProductById } from './products';
import { parseMockToken, type MockUser } from './identity';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MockApiClientOptions {
  getAccessToken: () => Promise<string | null>;
  onUnauthorized?: () => void;
  /** Persists the mock database between reloads (e.g. localStorage). In memory when omitted. */
  storage?: KeyValueStorage;
  now?: () => Date;
  /** Artificial delay per call, so loading states are visible. */
  latencyMs?: number;
}

interface UserRecord {
  email: string | null;
  consents: ExportResponse['consents'];
  profile: Profile | null;
  dietaryPrefs: DietaryPrefs | null;
  /** Full history; the current row has `validTo: null`. */
  targets: ExportResponse['targets'];
  aiUsage: ExportResponse['aiUsage'];
  /** The weight log, sorted by day. */
  weights: WeightEntry[];
  /** The food log, deletes included as tombstones (`deleted`, spec 005 AC20). */
  mealItems: StoredMealItem[];
  favourites: { foodId: string; createdAt: string }[];
  /** The user's own foods, most recently changed first (spec 006). One name for every locale. */
  customFoods: Food[];
}

type StoredMealItem = MealItem & { deleted: boolean };

type MockDb = Record<string, UserRecord>;

/** Storage key of the mock database. The suffix changes with the shape of the stored rows (v6: spec 006). */
export const MOCK_DB_KEY = 'pt.mock-db.v6';

/** What the mock "reads" from every label photo (spec 006 AC15): a pack of biscuits. */
const MOCK_LABEL_READING: LabelReading = {
  status: 'ok',
  basis: 'per_100g',
  servingSize: 30,
  servingUnit: 'g',
  energyKcal: 436,
  energyKj: 1836,
  fatG: 10.5,
  carbsG: 76,
  proteinG: 7.1,
  fiberG: null,
  productName: 'Galletas María',
  brand: null,
};

/** An image this small (a few pixels, in base64 characters) is "not a label" for the mock (AC17). */
const MOCK_UNREADABLE_BELOW = 2000;

const catalogById = new Map(MOCK_CATALOG.map((f) => [f.id, f]));
const searchIndex = buildFoodSearchIndex(MOCK_CATALOG);

/** The portion of a logged item, to preselect it in the portion sheet (same rule as the API). */
function lastPortion(item: MealItem, food: Food): Portion | null {
  if (item.servingId !== null && item.servings !== null) {
    if (food.servings.some((s) => s.id === item.servingId)) {
      return { kind: 'serving', servingId: item.servingId, servings: item.servings };
    }
  }
  return item.grams !== null ? { kind: 'grams', grams: item.grams } : null;
}

const withoutFlag = ({ deleted: _, ...item }: StoredMealItem): MealItem => item;

/** The items that were not deleted, by day and time. */
const live = (record: UserRecord): MealItem[] =>
  record.mealItems
    .filter((i) => !i.deleted)
    .map(withoutFlag)
    .sort(
      (a, b) => a.localDate.localeCompare(b.localDate) || a.recordedAt.localeCompare(b.recordedAt),
    );

const MESSAGES: Record<ApiErrorCode, string> = {
  unauthorized: 'A valid access token is required',
  consent_required: 'Health-data consent is required',
  validation_error: 'Invalid request',
  age_blocked: 'This app is not available under 16',
  rate_limited: 'Too many requests, try again later',
  ai_unavailable: 'The assistant is unavailable, use the form instead',
  not_found: 'Not found',
  internal_error: 'Something went wrong',
  product_not_found: 'Unknown product',
  product_incomplete: 'The product has no usable nutrition values',
  lookup_unavailable: 'The product database did not answer, try again',
  ai_cap_reached: 'Daily limit of AI reads reached, use the search or the form instead',
  image_too_large: 'The image is too large',
  food_limit_reached: 'Too many foods of your own',
};

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  consent_required: 403,
  validation_error: 400,
  age_blocked: 422,
  rate_limited: 429,
  ai_unavailable: 503,
  not_found: 404,
  internal_error: 500,
  product_not_found: 404,
  product_incomplete: 404,
  lookup_unavailable: 503,
  ai_cap_reached: 429,
  image_too_large: 413,
  food_limit_reached: 400,
};

const fail = (code: ApiErrorCode, fields?: Record<string, string>) =>
  new ApiError(STATUS[code], code, MESSAGES[code], fields);

/** Same shape as the API's `fieldErrors` (apps/api/src/http.ts). */
function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    fields[key] ??= issue.code;
  }
  return fields;
}

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw fail('validation_error', fieldErrors(result.error));
  return result.data;
}

const emptyUser = (email: string | null): UserRecord => ({
  email,
  consents: [],
  profile: null,
  dietaryPrefs: null,
  targets: [],
  aiUsage: [],
  weights: [],
  mealItems: [],
  favourites: [],
  customFoods: [],
});

export function createMockApiClient({
  getAccessToken,
  onUnauthorized,
  storage,
  now = () => new Date(),
  latencyMs = 0,
}: MockApiClientOptions): ApiClient {
  const db: MockDb = (() => {
    try {
      const raw = storage?.getItem(MOCK_DB_KEY);
      return raw ? (JSON.parse(raw) as MockDb) : {};
    } catch {
      return {};
    }
  })();
  const persist = () => storage?.setItem(MOCK_DB_KEY, JSON.stringify(db));
  const wait = () =>
    latencyMs > 0
      ? new Promise<void>((resolve) => setTimeout(resolve, latencyMs))
      : Promise.resolve();

  async function authenticate(): Promise<{ user: MockUser; record: UserRecord }> {
    await wait();
    const user = parseMockToken(await getAccessToken());
    if (!user) {
      onUnauthorized?.();
      throw fail('unauthorized');
    }
    const record = (db[user.userId] ??= emptyUser(user.email));
    return { user, record };
  }

  const activeConsent = (record: UserRecord) =>
    record.consents.findLast((c) => c.kind === 'health_data' && c.revokedAt === null);
  // A consent given to an older version of the text does not count (spec 002 AC14).
  const hasConsent = (record: UserRecord) => activeConsent(record)?.version === CONSENT_VERSION;

  /** A food the user may read: of the catalog, a product or one of their own (spec 006 AC13). */
  const findFood = (record: UserRecord, id: string, locale: Locale): Food | null => {
    const catalogFood = catalogById.get(id);
    if (catalogFood) return toMockFood(catalogFood, locale);
    return record.customFoods.find((f) => f.id === id) ?? mockProductById(id, locale);
  };

  /** The daily cap of one AI feature (spec 006 AC18, spec 007 AC12), then its metering. */
  function useAi(record: UserRecord, feature: 'meal_text' | 'meal_photo', perDay: number) {
    const today = now().toISOString().slice(0, 10);
    const used = record.aiUsage.filter(
      (u) => u.feature === feature && u.createdAt.slice(0, 10) === today,
    ).length;
    if (used >= perDay) throw fail('ai_cap_reached');
    record.aiUsage.push({
      feature,
      model: 'claude-haiku-5-5',
      inputTokens: 3000,
      outputTokens: 400,
      createdAt: now().toISOString(),
    });
    persist();
  }

  /** The user's own foods, searched with the catalog (spec 006 AC11). */
  const customIndex = (record: UserRecord) =>
    buildFoodSearchIndex(record.customFoods.map(searchableBrandedFood));

  async function authenticateWithConsent() {
    const session = await authenticate();
    if (!hasConsent(session.record)) throw fail('consent_required');
    return session;
  }

  function toMe(userId: string, record: UserRecord): MeResponse {
    const consent = activeConsent(record);
    const current = record.targets.find((t) => t.validTo === null);
    return {
      userId,
      consent: { healthData: hasConsent(record), version: consent?.version ?? null },
      onboardingCompleted: record.profile?.onboardingCompletedAt != null,
      profile: record.profile,
      dietaryPrefs: record.dietaryPrefs,
      targets: current
        ? {
            kcal: current.kcal,
            proteinG: current.proteinG,
            carbsG: current.carbsG,
            fatG: current.fatG,
            fiberG: current.fiberG,
            formulaVersion: current.formulaVersion,
            clampedReason: current.clampedReason,
            validFrom: current.validFrom,
          }
        : null,
    };
  }

  const currentTargets = (record: UserRecord) => {
    const current = record.targets.find((t) => t.validTo === null);
    return current ? targetsOnly(current) : null;
  };

  function putWeight(record: UserRecord, entry: WeightEntry) {
    record.weights = [...record.weights.filter((w) => w.localDate !== entry.localDate), entry].sort(
      (a, b) => (a.localDate < b.localDate ? -1 : 1),
    );
  }

  /** After a weight write: the latest entry becomes the profile weight (spec 003 AC10–AC13). */
  function afterWeightWrite(
    record: UserRecord,
    localDate: string,
    today: string,
  ): WeightSaveResponse {
    const entry = record.weights.find((w) => w.localDate === localDate) ?? null;
    if (!record.profile) return { entry, targetsChange: null };
    const change = applyLatestWeight(
      record.profile,
      currentTargets(record),
      record.weights.at(-1) ?? null,
      today,
      record.weights,
    );
    if (change) {
      const at = now().toISOString();
      record.profile = {
        ...record.profile,
        weightKg: change.weightKg,
        goal: change.goal,
        safetyFlags: change.safetyFlags,
      };
      if (change.targetsChange) {
        for (const row of record.targets) if (row.validTo === null) row.validTo = at;
        const { current } = change.targetsChange;
        if (current) record.targets.push({ ...current, validFrom: at, validTo: null });
      }
    }
    persist();
    return { entry, targetsChange: change?.targetsChange ?? null };
  }

  function evaluate(body: unknown, record: UserRecord) {
    const input = parse(ProfileInputSchema, body);
    const evaluation = evaluateProfileInput(input, record.profile?.safetyFlags ?? [], now(), {
      storedWeightKg: record.profile?.weightKg ?? null,
      entries: record.weights,
    });
    if (evaluation.kind === 'invalid') throw fail('validation_error', evaluation.fields);
    if (evaluation.kind === 'blocked') throw fail('age_blocked');
    return { input, evaluation };
  }

  return {
    health: async () => {
      await wait();
      return { status: 'ok', service: 'api (mock)', version: 'mock', time: now().toISOString() };
    },

    me: async () => {
      const { user, record } = await authenticate();
      return toMe(user.userId, record);
    },

    grantConsent: async (body) => {
      const { record } = await authenticate();
      const consent = parse(ConsentRequestSchema, body);
      record.consents.push({
        kind: consent.kind,
        version: consent.version,
        grantedAt: now().toISOString(),
        revokedAt: null,
      });
      persist();
    },

    updateProfile: async (body) => {
      const { user, record } = await authenticateWithConsent();
      const { input, evaluation } = evaluate(body, record);
      const at = now().toISOString();
      // A new profile, or a weight typed in the profile form, is today's entry (spec 003 AC13).
      if (record.profile?.weightKg !== input.weightKg) {
        putWeight(record, { localDate: input.today, weightKg: input.weightKg, recordedAt: at });
      }
      record.profile = {
        sex: input.sex,
        birthDate: input.birthDate,
        heightCm: input.heightCm,
        weightKg: input.weightKg,
        targetWeightKg: input.targetWeightKg,
        jobActivity: input.jobActivity,
        plannedActivities: input.plannedActivities,
        requestedGoal: input.goal,
        goal: evaluation.safety.appliedGoal,
        trainingFocus: input.trainingFocus,
        safetyFlags: evaluation.flags,
        injuries: input.injuries?.trim() || null,
        units: input.units,
        locale: input.locale,
        onboardingCompletedAt: record.profile?.onboardingCompletedAt ?? at,
      };
      record.dietaryPrefs = input.dietaryPrefs;
      for (const row of record.targets) if (row.validTo === null) row.validTo = at;
      if (evaluation.targets)
        record.targets.push({ ...evaluation.targets, validFrom: at, validTo: null });
      persist();
      return toMe(user.userId, record);
    },

    targetsPreview: async (body) => {
      const { record } = await authenticateWithConsent();
      const { evaluation } = evaluate(body, record);
      return {
        targets: evaluation.targets,
        breakdown: evaluation.breakdown,
        safety: evaluation.safety,
      };
    },

    listWeights: async (query) => {
      const { record } = await authenticateWithConsent();
      const { from, to } = parse(WeightListQuerySchema, query);
      if (from > to) throw fail('validation_error', { from: 'after_to' });
      if (daysBetween(from, to) > WEIGHT_LIMITS.listDaysMax) {
        throw fail('validation_error', { to: 'too_big' });
      }
      return { entries: record.weights.filter((w) => w.localDate >= from && w.localDate <= to) };
    },

    saveWeight: async (day, body) => {
      const { record } = await authenticateWithConsent();
      const { localDate } = parse(WeightDateParamSchema, { localDate: day });
      const input = parse(WeightUpsertRequestSchema, body);
      const invalid = checkWeightWrite({ localDate, ...input }, now());
      if (invalid) throw fail('validation_error', invalid);
      if (!record.profile) throw fail('validation_error', { profile: 'required' });
      const stored = record.weights.find((w) => w.localDate === localDate);
      // The write recorded later on its device wins (AC20).
      if (!stored || Date.parse(stored.recordedAt) <= Date.parse(input.recordedAt)) {
        putWeight(record, {
          localDate,
          weightKg: input.weightKg,
          recordedAt: new Date(input.recordedAt).toISOString(),
        });
      }
      return afterWeightWrite(record, localDate, input.today);
    },

    deleteWeight: async (day, query) => {
      const { record } = await authenticateWithConsent();
      const { localDate } = parse(WeightDateParamSchema, { localDate: day });
      const { today } = parse(WeightDeleteQuerySchema, query);
      const invalid = checkWeightWrite({ localDate, today }, now());
      if (invalid) throw fail('validation_error', invalid);
      if (!record.profile) throw fail('validation_error', { profile: 'required' });
      record.weights = record.weights.filter((w) => w.localDate !== localDate);
      return afterWeightWrite(record, localDate, today);
    },

    searchFoods: async (q, locale) => {
      const { record } = await authenticateWithConsent();
      const query = parse(FoodSearchQuerySchema, { q, locale });
      // The user's own foods and the products they logged rank with the catalog (spec 006 AC11).
      const logged = new Set(live(record).map((i) => i.foodId));
      const products = [...logged].flatMap((id) => {
        const product = id ? mockProductById(id, query.locale) : null;
        return product ? [product] : [];
      });
      const mine = buildFoodSearchIndex(
        [...record.customFoods, ...products].map(searchableBrandedFood),
      );
      const ids = searchFoods(
        searchIndex,
        query.q,
        query.locale,
        FOOD_LOG_LIMITS.searchResultsMax,
        mine,
      );
      return {
        foods: ids.flatMap((id) => {
          const food = findFood(record, id, query.locale);
          return food ? [food] : [];
        }),
      };
    },

    getFood: async (id, locale) => {
      const { record } = await authenticateWithConsent();
      const { foodId } = parse(FoodIdParamSchema, { foodId: id });
      const food = findFood(record, foodId, parse(FoodLocaleQuerySchema, { locale }).locale);
      if (!food) throw fail('not_found', { foodId: 'not_found' });
      return food;
    },

    foodSources: async (locale) => {
      await authenticate();
      return {
        sources: [
          {
            id: MOCK_SOURCE,
            name: 'Ciqual 2025 (Anses)',
            url: 'https://doi.org/10.57745/RDMHWY',
            license: 'Licence Ouverte / Etalab 2.0',
            version: '2025-11-03',
            attribution:
              locale === 'en'
                ? 'Nutrition values: Anses, Ciqual French food composition table 2025.'
                : 'Valores nutricionales: Anses, tabla de composición nutricional Ciqual 2025.',
          },
          {
            id: 'open-food-facts',
            name: 'Open Food Facts',
            url: 'https://world.openfoodfacts.org',
            license: 'Open Database License (ODbL) 1.0',
            version: 'live',
            attribution:
              locale === 'en'
                ? 'Products with a barcode: contains data from Open Food Facts (https://openfoodfacts.org), available under the Open Database License (https://opendatacommons.org/licenses/odbl/1-0/). It is written by volunteers and may contain errors: always check the package.'
                : 'Productos con código de barras: contiene datos de Open Food Facts (https://openfoodfacts.org), disponibles bajo la Open Database License (https://opendatacommons.org/licenses/odbl/1-0/). Los escriben voluntarios y pueden tener errores: comprueba siempre el envase.',
          },
        ],
      };
    },

    listFoodLog: async (query) => {
      const { record } = await authenticateWithConsent();
      const { from, to } = parse(FoodLogQuerySchema, query);
      const invalid = checkFoodLogRange(from, to);
      if (invalid) throw fail('validation_error', invalid);
      return { items: live(record).filter((i) => i.localDate >= from && i.localDate <= to) };
    },

    saveMealItem: async (itemId, body) => {
      const { user, record } = await authenticateWithConsent();
      const { id } = parse(MealItemIdParamSchema, { id: itemId });
      const request = parse(MealItemUpsertRequestSchema, body);
      const invalid = checkFoodLogWrite(request, now());
      if (invalid) throw fail('validation_error', invalid);
      const food =
        request.kind === 'food' ? findFood(record, request.foodId, request.locale) : null;
      const item = mealItemFromRequest(id, request, food);
      if ('error' in item) {
        throw item.error === 'food_not_found'
          ? fail('not_found', { foodId: 'not_found' })
          : fail('validation_error', { 'portion.servingId': 'not_found' });
      }
      // Ids are global: an id that belongs to another user is never touched.
      for (const [owner, other] of Object.entries(db)) {
        if (owner !== user.userId && other.mealItems.some((i) => i.id === id)) {
          return { item: null };
        }
      }
      const stored = record.mealItems.find((i) => i.id === id);
      if (!stored) {
        const onDay = live(record).filter((i) => i.localDate === request.localDate).length;
        if (onDay >= FOOD_LOG_LIMITS.itemsPerDayMax) {
          throw fail('validation_error', { localDate: 'too_many_items' });
        }
      }
      // The write recorded later on its device wins, also against a delete (AC20).
      if (writeWins(stored?.recordedAt ?? null, item.recordedAt)) {
        record.mealItems = [
          ...record.mealItems.filter((i) => i.id !== id),
          { ...item, recordedAt: new Date(item.recordedAt).toISOString(), deleted: false },
        ];
        persist();
      }
      const current = record.mealItems.find((i) => i.id === id);
      return { item: current && !current.deleted ? withoutFlag(current) : null };
    },

    deleteMealItem: async (itemId, query) => {
      const { record } = await authenticateWithConsent();
      const { id } = parse(MealItemIdParamSchema, { id: itemId });
      const { recordedAt } = parse(MealItemDeleteQuerySchema, query);
      if (Date.parse(recordedAt) > now().getTime() + 24 * 60 * 60 * 1000) {
        throw fail('validation_error', { recordedAt: 'in_future' });
      }
      const stored = record.mealItems.find((i) => i.id === id);
      // A delete older than the stored write does not remove it; the tombstone keeps the delete time.
      if (stored && writeWins(stored.recordedAt, recordedAt)) {
        stored.deleted = true;
        stored.recordedAt = new Date(recordedAt).toISOString();
        persist();
      }
      return { item: null };
    },

    recentFoods: async (locale) => {
      const { record } = await authenticateWithConsent();
      const since = addDays(now().toISOString().slice(0, 10), -FOOD_LOG_LIMITS.recentsDays);
      const latest = new Map<string, MealItem>();
      for (const item of live(record)) {
        if (item.foodId === null || item.localDate < since) continue;
        const seen = latest.get(item.foodId);
        if (!seen || seen.recordedAt < item.recordedAt) latest.set(item.foodId, item);
      }
      const recents = [...latest.values()]
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
        .slice(0, FOOD_LOG_LIMITS.recentsMax)
        .flatMap((item) => {
          const food = item.foodId ? findFood(record, item.foodId, locale) : null;
          const portion = food ? lastPortion(item, food) : null;
          return food && portion ? [{ food, lastPortion: portion }] : [];
        });
      return { recents };
    },

    favouriteFoods: async (locale) => {
      const { record } = await authenticateWithConsent();
      const foods = [...record.favourites]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .flatMap((f) => {
          const food = findFood(record, f.foodId, locale);
          return food ? [food] : [];
        });
      return { foods };
    },

    setFavouriteFood: async (id, favourite) => {
      const { record } = await authenticateWithConsent();
      const { foodId } = parse(FoodIdParamSchema, { foodId: id });
      if (favourite && !findFood(record, foodId, 'es')) {
        throw fail('not_found', { foodId: 'not_found' });
      }
      const has = record.favourites.some((f) => f.foodId === foodId);
      if (favourite && !has) record.favourites.push({ foodId, createdAt: now().toISOString() });
      if (!favourite) record.favourites = record.favourites.filter((f) => f.foodId !== foodId);
      persist();
    },

    foodByBarcode: async (code, locale) => {
      const { record } = await authenticateWithConsent();
      const params = parse(BarcodeParamSchema, { code });
      const query = parse(FoodLocaleQuerySchema, { locale });
      const barcode = normalizeBarcode(params.code);
      if (barcode === null) throw fail('validation_error', { code: 'invalid' });
      // The user's own food first, then the product (AC3).
      const own = record.customFoods.find((f) => f.barcode === barcode);
      if (own) return own;
      const product = isInStoreBarcode(barcode) ? null : mockProduct(barcode, query.locale);
      if (product === 'incomplete') throw fail('product_incomplete');
      if (!product) throw fail('product_not_found');
      return product;
    },

    customFoods: async () => {
      const { record } = await authenticateWithConsent();
      return { foods: record.customFoods };
    },

    saveCustomFood: async (id, body) => {
      const { user, record } = await authenticateWithConsent();
      const { foodId } = parse(FoodIdParamSchema, { foodId: id });
      const request = parse(CustomFoodUpsertRequestSchema, body);
      const invalid = checkCustomFood(request);
      if (invalid) throw fail('validation_error', invalid);
      if (request.barcode !== null && normalizeBarcode(request.barcode) !== request.barcode) {
        throw fail('validation_error', { barcode: 'invalid' });
      }
      const mine = record.customFoods.some((f) => f.id === foodId);
      if (!mine && record.customFoods.length >= CUSTOM_FOOD_LIMITS.foodsMax) {
        throw fail('food_limit_reached');
      }
      // The id of a catalog food, a product or another user's food is never overwritten (AC13).
      const taken =
        catalogById.has(foodId) ||
        mockProductById(foodId, 'es') !== null ||
        Object.entries(db).some(
          ([owner, other]) =>
            owner !== user.userId && other.customFoods.some((f) => f.id === foodId),
        );
      if (taken) throw fail('not_found', { foodId: 'not_found' });
      if (
        request.barcode !== null &&
        record.customFoods.some((f) => f.id !== foodId && f.barcode === request.barcode)
      ) {
        throw fail('validation_error', { barcode: 'already_used' });
      }
      const food = customFoodAsFood(foodId, request);
      record.customFoods = [food, ...record.customFoods.filter((f) => f.id !== foodId)];
      persist();
      return food;
    },

    deleteCustomFood: async (id) => {
      const { record } = await authenticateWithConsent();
      const { foodId } = parse(FoodIdParamSchema, { foodId: id });
      if (!record.customFoods.some((f) => f.id === foodId)) return;
      record.customFoods = record.customFoods.filter((f) => f.id !== foodId);
      // The logged items keep their snapshot without the food (AC12); the favourite goes.
      for (const item of record.mealItems) {
        if (item.foodId === foodId) {
          item.foodId = null;
          item.servingId = null;
        }
      }
      record.favourites = record.favourites.filter((f) => f.foodId !== foodId);
      persist();
    },

    scanLabel: async (body) => {
      const { record } = await authenticateWithConsent();
      const { image } = parse(LabelScanRequestSchema, body);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
        throw fail('validation_error', { 'image.data': 'invalid' });
      }
      if ((image.data.length * 3) / 4 > LABEL_SCAN_LIMITS.imageBytesMax) {
        throw fail('image_too_large');
      }
      const today = now().toISOString().slice(0, 10);
      const used = record.aiUsage.filter(
        (u) => u.feature === 'label_scan' && u.createdAt.slice(0, 10) === today,
      ).length;
      if (used >= LABEL_SCAN_LIMITS.perDay) throw fail('ai_cap_reached');
      record.aiUsage.push({
        feature: 'label_scan',
        model: 'claude-haiku-5-5',
        inputTokens: 1200,
        outputTokens: 150,
        createdAt: now().toISOString(),
      });
      persist();
      // The image is read and dropped: nothing of it is stored (AC19).
      return labelDraft(
        image.data.length < MOCK_UNREADABLE_BELOW
          ? { ...MOCK_LABEL_READING, status: 'not_a_label' }
          : MOCK_LABEL_READING,
      );
    },

    draftFromText: async (body) => {
      const { record } = await authenticateWithConsent();
      const { text, locale } = parse(MealTextDraftRequestSchema, body);
      useAi(record, 'meal_text', MEAL_DRAFT_LIMITS.textsPerDay);
      const candidates = new Map<string, Food>();
      const reading = mockTextReading(text, (query) => {
        const [id] = searchFoods(searchIndex, query, locale, 1, customIndex(record));
        const food = id ? findFood(record, id, locale) : null;
        if (food) candidates.set(food.id, food);
        return food;
      });
      // The sentence is read and dropped: nothing of it is stored (AC16).
      return mealDraft(reading, candidates, 'text');
    },

    draftFromPhoto: async (body) => {
      const { record } = await authenticateWithConsent();
      const { image, locale } = parse(MealPhotoDraftRequestSchema, body);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
        throw fail('validation_error', { 'image.data': 'invalid' });
      }
      if ((image.data.length * 3) / 4 > LABEL_SCAN_LIMITS.imageBytesMax) {
        throw fail('image_too_large');
      }
      useAi(record, 'meal_photo', MEAL_DRAFT_LIMITS.photosPerDay);
      const candidates = new Map<string, Food>();
      const reading = mockPhotoReading(image.data.length, (key) => {
        const catalogFood = MOCK_CATALOG.find((f) => f.key === key);
        const food = catalogFood ? toMockFood(catalogFood, locale) : null;
        if (food) candidates.set(food.id, food);
        return food;
      });
      // The image is read and dropped: nothing of it is stored (AC16).
      return mealDraft(reading, candidates, 'photo');
    },

    exportData: async () => {
      const { user, record } = await authenticate();
      return {
        exportedAt: now().toISOString(),
        userId: user.userId,
        email: record.email,
        profile: record.profile,
        dietaryPrefs: record.dietaryPrefs,
        targets: record.targets,
        weights: record.weights,
        mealItems: live(record),
        customFoods: record.customFoods,
        favouriteFoods: record.favourites.map((f) => ({
          foodId: f.foodId,
          key: catalogById.get(f.foodId)?.key ?? '',
          createdAt: f.createdAt,
        })),
        consents: record.consents,
        aiUsage: record.aiUsage,
      };
    },

    deleteAccount: async () => {
      const { user } = await authenticate();
      delete db[user.userId];
      persist();
    },
  };
}
