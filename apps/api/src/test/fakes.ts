import { AiUnavailableError, type AiFeature, type AiUsage, type ReadLabel } from '@pt/ai';
import type {
  ConsentKind,
  CustomFoodUpsertRequest,
  LabelReading,
  MealItem,
  ProfileInput,
  WeightEntry,
} from '@pt/contracts';
import { USER_FOOD_SOURCE } from '@pt/core';
import { randomUUID } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createApp } from '../app';
import type {
  AuthAdmin,
  BarcodeMissReason,
  CatalogFood,
  Deps,
  ProductWrite,
  ExportRecord,
  KnowledgeSourceRecord,
  MeRecord,
  Store,
} from '../deps';
import { createJwtVerifier } from '../middleware/auth';
import type { OffLookup } from '../off/client';
import { toFood } from '../services/foods';

export const NOW = new Date('2026-11-11T10:00:00Z');
export const TODAY = '2026-11-11';
export const USER_ID = '6f1c1b1e-8f3a-4d2b-9a43-1e2f3a4b5c6d';
export const OTHER_USER_ID = '0b7a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ISSUER = 'https://test.supabase.co/auth/v1';

interface UserRows {
  consents: ExportRecord['consents'];
  profile: MeRecord['profile'];
  dietaryPrefs: MeRecord['dietaryPrefs'];
  targets: ExportRecord['targets'];
  aiUsage: (AiUsage & { createdAt: string })[];
  /** Kept sorted by day. */
  weights: WeightEntry[];
  /** The food log, with deleted items kept as tombstones (spec 005 AC20). */
  mealItems: (MealItem & { deleted: boolean })[];
  favourites: { foodId: string; createdAt: string }[];
}

/** In-memory Store with the same semantics as the Drizzle one (targets history, sticky completion). */
export class FakeStore implements Store {
  readonly users = new Map<string, UserRows>();
  /** The food catalog (spec 005); tests fill it with `catalogFixture()`. */
  catalog: CatalogFood[] = [];
  sources: KnowledgeSourceRecord[] = [];
  /** Products read from Open Food Facts and the users' own foods (spec 006), most recent last. */
  extraFoods: CatalogFood[] = [];
  misses = new Map<string, { reason: BarcodeMissReason; checkedAt: Date }>();

  rows(userId: string): UserRows {
    let rows = this.users.get(userId);
    if (!rows) {
      rows = {
        consents: [],
        profile: null,
        dietaryPrefs: null,
        targets: [],
        aiUsage: [],
        weights: [],
        mealItems: [],
        favourites: [],
      };
      this.users.set(userId, rows);
    }
    return rows;
  }

  async getMe(userId: string): Promise<MeRecord> {
    const rows = this.rows(userId);
    const consent = rows.consents.findLast((c) => c.kind === 'health_data' && !c.revokedAt);
    const current = rows.targets.find((t) => t.validTo === null);
    return {
      consentVersion: consent?.version ?? null,
      profile: rows.profile,
      dietaryPrefs: rows.dietaryPrefs,
      targets: current ? (({ validTo: _, ...t }) => t)(current) : null,
    };
  }

  async hasConsent(userId: string, kind: ConsentKind, version: string) {
    const latest = this.rows(userId).consents.findLast((c) => c.kind === kind && !c.revokedAt);
    return latest?.version === version;
  }

  async grantConsent(userId: string, kind: ConsentKind, version: string, at: Date) {
    this.rows(userId).consents.push({
      kind,
      version,
      grantedAt: at.toISOString(),
      revokedAt: null,
    });
  }

  async getSafetyContext(userId: string, weightsFrom: string) {
    const rows = this.rows(userId);
    return {
      flags: rows.profile?.safetyFlags ?? [],
      weightKg: rows.profile?.weightKg ?? null,
      weights: rows.weights.filter((w) => w.localDate >= weightsFrom),
    };
  }

  async saveProfile(userId: string, data: Parameters<Store['saveProfile']>[1], at: Date) {
    const rows = this.rows(userId);
    const iso = at.toISOString();
    if (rows.profile?.weightKg !== data.profile.weightKg) {
      this.putWeight(rows, {
        localDate: data.today,
        weightKg: data.profile.weightKg,
        recordedAt: iso,
      });
    }
    rows.profile = {
      ...data.profile,
      onboardingCompletedAt: rows.profile?.onboardingCompletedAt ?? iso,
    };
    rows.dietaryPrefs = data.dietaryPrefs;
    for (const t of rows.targets) if (t.validTo === null) t.validTo = iso;
    if (data.targets) rows.targets.push({ ...data.targets, validFrom: iso, validTo: null });
  }

  private putWeight(rows: UserRows, entry: WeightEntry) {
    rows.weights = [...rows.weights.filter((w) => w.localDate !== entry.localDate), entry].sort(
      (a, b) => (a.localDate < b.localDate ? -1 : 1),
    );
  }

  async listWeights(userId: string, from: string, to: string) {
    return this.rows(userId).weights.filter((w) => w.localDate >= from && w.localDate <= to);
  }

  async writeWeight(
    userId: string,
    write: Parameters<Store['writeWeight']>[1],
    decide: Parameters<Store['writeWeight']>[2],
    at: Date,
  ) {
    const rows = this.rows(userId);
    if (!rows.profile) return null;
    const iso = at.toISOString();
    const stored = rows.weights.find((w) => w.localDate === write.localDate);
    if (!write.entry) {
      rows.weights = rows.weights.filter((w) => w.localDate !== write.localDate);
    } else if (!stored || Date.parse(stored.recordedAt) <= Date.parse(write.entry.recordedAt)) {
      this.putWeight(rows, {
        localDate: write.localDate,
        weightKg: write.entry.weightKg,
        recordedAt: new Date(write.entry.recordedAt).toISOString(),
      });
    }
    const current = rows.targets.find((t) => t.validTo === null);
    const previousTargets = current ? (({ validTo: _, ...t }) => t)(current) : null;
    const decision = decide({
      profile: rows.profile,
      targets: previousTargets,
      latest: rows.weights.at(-1) ?? null,
      recent: rows.weights.filter((w) => w.localDate >= write.recentFrom),
    });
    if (decision) {
      rows.profile = {
        ...rows.profile,
        weightKg: decision.weightKg,
        goal: decision.goal,
        safetyFlags: decision.safetyFlags,
      };
      if (decision.newTargets !== undefined) {
        for (const t of rows.targets) if (t.validTo === null) t.validTo = iso;
        if (decision.newTargets) {
          rows.targets.push({ ...decision.newTargets, validFrom: iso, validTo: null });
        }
      }
    }
    return {
      entry: rows.weights.find((w) => w.localDate === write.localDate) ?? null,
      previousTargets,
    };
  }

  // Food catalog and food log (spec 005), same semantics as `store/food-store.ts`.

  private live(rows: UserRows): MealItem[] {
    return rows.mealItems.filter((i) => !i.deleted).map(({ deleted: _, ...item }) => item);
  }

  async listCatalog() {
    return this.catalog;
  }

  async listKnowledgeSources() {
    return this.sources;
  }

  async listMealItems(userId: string, from: string, to: string) {
    return this.live(this.rows(userId))
      .filter((i) => i.localDate >= from && i.localDate <= to)
      .sort(byDayThenTime);
  }

  async countMealItems(userId: string, localDate: string) {
    return this.live(this.rows(userId)).filter((i) => i.localDate === localDate).length;
  }

  async upsertMealItem(userId: string, item: MealItem) {
    for (const [owner, rows] of this.users) {
      if (owner !== userId && rows.mealItems.some((i) => i.id === item.id)) return null;
    }
    const rows = this.rows(userId);
    const stored = rows.mealItems.find((i) => i.id === item.id);
    if (!stored || Date.parse(stored.recordedAt) <= Date.parse(item.recordedAt)) {
      const next = { ...item, recordedAt: new Date(item.recordedAt).toISOString(), deleted: false };
      rows.mealItems = [...rows.mealItems.filter((i) => i.id !== item.id), next];
    }
    const current = rows.mealItems.find((i) => i.id === item.id);
    return current && !current.deleted ? (({ deleted: _, ...i }) => i)(current) : null;
  }

  async deleteMealItem(userId: string, id: string, recordedAt: string) {
    const stored = this.rows(userId).mealItems.find((i) => i.id === id);
    if (stored && Date.parse(stored.recordedAt) <= Date.parse(recordedAt)) {
      stored.deleted = true;
      stored.recordedAt = new Date(recordedAt).toISOString();
    }
  }

  async listRecentFoodItems(userId: string, since: string, limit: number) {
    const latest = new Map<string, MealItem>();
    for (const item of this.live(this.rows(userId))) {
      if (item.foodId === null || item.localDate < since) continue;
      const seen = latest.get(item.foodId);
      if (!seen || seen.recordedAt < item.recordedAt) latest.set(item.foodId, item);
    }
    return [...latest.values()]
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, limit);
  }

  async listFavouriteFoodIds(userId: string) {
    return [...this.rows(userId).favourites]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((f) => f.foodId);
  }

  async setFavouriteFood(userId: string, foodId: string, favourite: boolean, at: Date) {
    const rows = this.rows(userId);
    const has = rows.favourites.some((f) => f.foodId === foodId);
    if (favourite && !has) rows.favourites.push({ foodId, createdAt: at.toISOString() });
    if (!favourite) rows.favourites = rows.favourites.filter((f) => f.foodId !== foodId);
  }

  // Scanned products and custom foods (spec 006), same semantics as `store/food-store.ts`.

  private visible(userId: string): CatalogFood[] {
    return [...this.catalog, ...this.extraFoods].filter(
      (f) => f.ownerId === null || f.ownerId === userId,
    );
  }

  async getFoods(userId: string, ids: readonly string[]) {
    return this.visible(userId).filter((f) => ids.includes(f.id));
  }

  async findFoodsByBarcode(userId: string, barcode: string) {
    const matches = this.extraFoods.filter((f) => f.barcode === barcode);
    return {
      own: matches.find((f) => f.ownerId === userId) ?? null,
      product: matches.find((f) => f.origin === 'off') ?? null,
    };
  }

  async saveProduct(product: ProductWrite, at: Date) {
    const key = `off-${product.barcode}`;
    const existing = this.extraFoods.find((f) => f.key === key);
    const food: CatalogFood = {
      id: existing?.id ?? randomUUID(),
      key,
      source: 'open-food-facts',
      nameEs: product.name,
      nameEn: product.name,
      synonymsEs: [],
      popularity: 0,
      per100g: product.per100g,
      servings: product.servings.map((s, i) => ({
        id: existing?.servings[i]?.id ?? randomUUID(),
        ...s,
      })),
      origin: 'off',
      unit: product.unit,
      brand: product.brand,
      barcode: product.barcode,
      ownerId: null,
      allergens: product.allergens,
      traces: product.traces,
      fetchedAt: at.toISOString(),
    };
    this.extraFoods = [...this.extraFoods.filter((f) => f.key !== key), food];
    this.misses.delete(product.barcode);
    return food;
  }

  async getBarcodeMiss(barcode: string, since: Date) {
    const miss = this.misses.get(barcode);
    return miss && miss.checkedAt > since ? miss.reason : null;
  }

  async recordBarcodeMiss(barcode: string, reason: BarcodeMissReason, at: Date) {
    this.misses.set(barcode, { reason, checkedAt: at });
  }

  async listCustomFoods(userId: string) {
    return this.extraFoods.filter((f) => f.ownerId === userId).reverse();
  }

  async upsertCustomFood(userId: string, id: string, food: CustomFoodUpsertRequest, _at: Date) {
    const existing = [...this.catalog, ...this.extraFoods].find((f) => f.id === id);
    if (existing && existing.ownerId !== userId) return 'not_owner' as const;
    const taken = this.extraFoods.some(
      (f) => f.ownerId === userId && f.id !== id && food.barcode && f.barcode === food.barcode,
    );
    if (taken) return 'barcode_taken' as const;
    const saved: CatalogFood = {
      id,
      key: `user-${id}`,
      source: USER_FOOD_SOURCE,
      nameEs: food.name,
      nameEn: food.name,
      synonymsEs: [],
      popularity: 0,
      per100g: food.per100g,
      servings: food.serving
        ? [
            {
              id: food.serving.id,
              labelEs: food.serving.label,
              labelEn: food.serving.label,
              grams: food.serving.grams,
            },
          ]
        : [],
      origin: food.origin,
      unit: food.unit,
      brand: food.brand,
      barcode: food.barcode,
      ownerId: userId,
      allergens: [],
      traces: [],
      fetchedAt: null,
    };
    this.extraFoods = [...this.extraFoods.filter((f) => f.id !== id), saved];
    return saved;
  }

  async deleteCustomFood(userId: string, id: string) {
    const owned = this.extraFoods.some((f) => f.id === id && f.ownerId === userId);
    if (!owned) return;
    this.extraFoods = this.extraFoods.filter((f) => f.id !== id);
    // The database sets `food_id` to null on the logged items and drops the favourite.
    for (const rows of this.users.values()) {
      for (const item of rows.mealItems) {
        if (item.foodId === id) {
          item.foodId = null;
          item.servingId = null;
        }
      }
      rows.favourites = rows.favourites.filter((f) => f.foodId !== id);
    }
  }

  async listLoggedProducts(userId: string, limit: number) {
    const logged = new Set(this.live(this.rows(userId)).map((i) => i.foodId));
    return this.extraFoods.filter((f) => f.origin === 'off' && logged.has(f.id)).slice(0, limit);
  }

  async countAiUsage(userId: string, feature: AiFeature, since: Date) {
    return this.rows(userId).aiUsage.filter(
      (u) => u.feature === feature && Date.parse(u.createdAt) >= since.getTime(),
    ).length;
  }

  async recordAiUsage(userId: string, usage: AiUsage, at: Date) {
    this.rows(userId).aiUsage.push({ ...usage, createdAt: at.toISOString() });
  }

  async exportUser(userId: string): Promise<ExportRecord> {
    const rows = this.rows(userId);
    return {
      profile: rows.profile,
      dietaryPrefs: rows.dietaryPrefs,
      targets: rows.targets,
      weights: rows.weights,
      mealItems: this.live(rows).sort(byDayThenTime),
      customFoods: this.extraFoods.filter((f) => f.ownerId === userId).map((f) => toFood(f, 'es')),
      favouriteFoods: rows.favourites.map((f) => ({
        foodId: f.foodId,
        key: [...this.catalog, ...this.extraFoods].find((c) => c.id === f.foodId)?.key ?? '',
        createdAt: f.createdAt,
      })),
      consents: rows.consents,
      aiUsage: rows.aiUsage.map((u) => ({
        feature: u.feature,
        model: u.model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        createdAt: u.createdAt,
      })),
    };
  }
}

export async function createTestTokens() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' };
  const verifyToken = createJwtVerifier({
    jwks: createLocalJWKSet({ keys: [jwk] }),
    issuer: ISSUER,
  });

  async function sign(
    claims: { sub?: string; email?: string; aud?: string; iss?: string } = {},
    expiresAt: Date = new Date(Date.now() + 3600_000),
  ) {
    return new SignJWT({ email: claims.email ?? 'ana@example.com', role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setSubject(claims.sub ?? USER_ID)
      .setIssuer(claims.iss ?? ISSUER)
      .setAudience(claims.aud ?? 'authenticated')
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(privateKey);
  }

  return { verifyToken, sign };
}

/** What the fake model answers to a label photo: a reading, or the failure of the call. */
export type FakeLabelAnswer = LabelReading | AiUnavailableError;

export function labelUsage(status: AiUsage['status'] = 'ok'): AiUsage {
  return {
    feature: 'label_scan',
    model: 'claude-haiku-5-5',
    inputTokens: status === 'error' ? 0 : 1200,
    outputTokens: status === 'error' ? 0 : 150,
    costUsd: status === 'error' ? 0 : 0.000195,
    latencyMs: 900,
    status,
  };
}

export async function createTestApp() {
  const store = new FakeStore();
  const deleted: string[] = [];
  const authAdmin: AuthAdmin = {
    async deleteUser(userId) {
      // Mirrors the DB: cascade on everything except ai_usage, which only loses its user id.
      deleted.push(userId);
      store.users.delete(userId);
      store.extraFoods = store.extraFoods.filter((f) => f.ownerId !== userId);
    },
  };
  const tokens = await createTestTokens();
  /** Open Food Facts: answers by barcode (anything else is unknown) and the codes it was asked for. */
  const off = { answers: new Map<string, OffLookup>(), calls: [] as string[] };
  /** The label model: what it answers next and the images it received. */
  const label = { answer: null as FakeLabelAnswer | null, calls: [] as string[] };
  const readLabel: ReadLabel = async (image) => {
    label.calls.push(image.data);
    if (label.answer === null) throw new Error('no fake label answer set');
    if (label.answer instanceof AiUnavailableError) throw label.answer;
    return { reading: label.answer, usage: labelUsage() };
  };
  const clock = { now: NOW };
  const deps: Deps = {
    verifyToken: tokens.verifyToken,
    store,
    authAdmin,
    lookupProduct: async (barcode) => {
      off.calls.push(barcode);
      return off.answers.get(barcode) ?? { status: 'not_found' };
    },
    readLabel,
    now: () => clock.now,
  };
  const app = createApp({ webOrigins: ['http://localhost:8081'], version: 'test', deps });
  const token = await tokens.sign();

  async function call(method: string, path: string, body?: unknown, bearer: string | null = token) {
    const headers: Record<string, string> = {};
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  return { app, store, deleted, tokens, token, call, off, label, clock };
}

/** A valid adult profile (35-year-old woman, 165 cm, 70 kg, seated, no training, lose). */
export function profileInput(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    sex: 'female',
    birthDate: '1991-05-20',
    heightCm: 165,
    weightKg: 70,
    targetWeightKg: 62,
    jobActivity: 'sedentary',
    plannedActivities: [],
    goal: 'lose',
    trainingFocus: 'general_fitness',
    injuries: null,
    healthFlags: [],
    units: 'metric',
    locale: 'es',
    dietaryPrefs: { dietType: 'omnivore', allergies: [], dislikes: [], restrictions: [] },
    today: TODAY,
    ...overrides,
  };
}

const byDayThenTime = (a: MealItem, b: MealItem) =>
  a.localDate.localeCompare(b.localDate) || a.recordedAt.localeCompare(b.recordedAt);

/** Ids of the catalog fixture, so tests can refer to its foods and servings. */
export const FOOD = {
  egg: 'f1000000-0000-4000-8000-000000000001',
  eggMedium: 'f1000000-0000-4000-8000-0000000000a1',
  eggLarge: 'f1000000-0000-4000-8000-0000000000a2',
  milk: 'f1000000-0000-4000-8000-000000000002',
  milkGlass: 'f1000000-0000-4000-8000-0000000000b1',
  goatMilk: 'f1000000-0000-4000-8000-000000000003',
  bread: 'f1000000-0000-4000-8000-000000000004',
} as const;

/** A small catalog: egg, two milks and bread, with real-looking values per 100 g. */
export function catalogFixture(): CatalogFood[] {
  const food = (
    id: string,
    key: string,
    nameEs: string,
    nameEn: string,
    popularity: number,
    per100g: CatalogFood['per100g'],
    servings: CatalogFood['servings'] = [],
    synonymsEs: string[] = [],
  ): CatalogFood => ({
    id,
    key,
    source: 'ciqual-2025',
    nameEs,
    nameEn,
    synonymsEs,
    popularity,
    per100g,
    servings,
    origin: 'catalog',
    unit: 'g',
    brand: null,
    barcode: null,
    ownerId: null,
    allergens: [],
    traces: [],
    fetchedAt: null,
  });
  return [
    food(
      FOOD.egg,
      'd-huevo',
      'Huevo',
      'Egg',
      9,
      { kcal: 140, proteinG: 12.7, carbsG: 0.3, fatG: 9.83, fiberG: 0 },
      [
        { id: FOOD.eggMedium, labelEs: '1 huevo mediano', labelEn: '1 medium egg', grams: 55 },
        { id: FOOD.eggLarge, labelEs: '1 huevo grande', labelEn: '1 large egg', grams: 65 },
      ],
      ['huevos'],
    ),
    food(
      FOOD.milk,
      'c-leche-semidesnatada',
      'Leche semidesnatada',
      'Semi-skimmed milk',
      9,
      { kcal: 46, proteinG: 3.3, carbsG: 4.8, fatG: 1.6, fiberG: null },
      [{ id: FOOD.milkGlass, labelEs: '1 vaso', labelEn: '1 glass', grams: 200 }],
    ),
    food(FOOD.goatMilk, 'c-leche-cabra', 'Leche de cabra', 'Goat milk', 3, {
      kcal: 66,
      proteinG: 3.2,
      carbsG: 4.4,
      fatG: 3.9,
      fiberG: null,
    }),
    food(FOOD.bread, 'c-pan-blanco', 'Pan blanco (barra)', 'White bread (baguette)', 9, {
      kcal: 266,
      proteinG: 8.9,
      carbsG: 53.5,
      fatG: 1.4,
      fiberG: 3.2,
    }),
  ];
}
