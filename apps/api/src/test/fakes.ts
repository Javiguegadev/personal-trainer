import {
  AiUnavailableError,
  type AiFeature,
  type AiUsage,
  type FeedbackPromptInput,
  type MealInput,
  type ReadLabel,
  type ReadMeal,
  type WordFeedback,
  type ReadWorkout,
  type WorkoutReadInput,
} from '@pt/ai';
import { EMPTY_WEEK } from '@pt/contracts';
import type {
  ConsentKind,
  DailyCheckin,
  CustomFoodUpsertRequest,
  FeedbackReading,
  LabelReading,
  MealReading,
  WorkoutReading,
  MealItem,
  ProfileInput,
  WeightEntry,
  CustomExerciseUpsertRequest,
  PlanDelete,
  PlannedMealItem,
  PlannedWorkout,
  Exercise,
  Workout,
  Program,
  TrainingProfileUpdate,
} from '@pt/contracts';
import { USER_FOOD_SOURCE, customExercise, type ExerciseSetRow } from '@pt/core';
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
  WeekWrite,
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
  /** The training log, with deleted workouts kept as tombstones (spec 009 AC23). */
  workouts: (Workout & { deleted: boolean })[];
  /** Routines, oldest first, with deleted ones kept as tombstones (spec 010 AC22). */
  programs: (Program & { deletedAt: string | null })[];
  /** Daily check-ins, with deleted ones kept as tombstones (spec 011 AC15). */
  checkins: (DailyCheckin & { deletedAt: string | null })[];
  /** The plan, with deleted rows kept as tombstones (spec 013 AC23). */
  plannedMealItems: (PlannedMealItem & { deletedAt: string | null })[];
  plannedWorkouts: (PlannedWorkout & { deletedAt: string | null })[];
}

/** A custom exercise as stored: its owner, write time and tombstone (spec 009). */
export interface StoredCustomExercise {
  exercise: Exercise;
  ownerId: string;
  recordedAt: string;
  deletedAt: string | null;
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
  /** The exercise catalog (spec 009); tests fill it with `exerciseCatalogFixture()`. */
  exerciseCatalog: Exercise[] = [];
  exerciseCatalogVersion = 'test-1';
  /** Custom exercises of every user, most recent last. */
  customExercises: StoredCustomExercise[] = [];

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
        workouts: [],
        programs: [],
        checkins: [],
        plannedMealItems: [],
        plannedWorkouts: [],
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
      week: rows.profile?.week ?? EMPTY_WEEK,
      trainingExperience: rows.profile?.trainingExperience ?? null,
      equipmentAccess: rows.profile?.equipmentAccess ?? null,
      // A profile save never changes the calibration (spec 014): only the weekly review does.
      energyCalibrationKcal: rows.profile?.energyCalibrationKcal ?? 0,
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
      for (const item of rows.plannedMealItems) {
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

  // Exercise catalog and workout log (spec 009), same semantics as `store/training-store.ts`.

  private liveWorkouts(rows: UserRows): Workout[] {
    return rows.workouts.filter((w) => !w.deleted).map(({ deleted: _, ...w }) => w);
  }

  async listExerciseCatalog() {
    return { exercises: this.exerciseCatalog, version: this.exerciseCatalogVersion };
  }

  async listCustomExercises(userId: string) {
    return this.customExercises
      .filter((e) => e.ownerId === userId && e.deletedAt === null)
      .map((e) => e.exercise)
      .reverse();
  }

  async getLoggableExercises(userId: string, ids: readonly string[]) {
    const own = this.customExercises.filter((e) => e.ownerId === userId).map((e) => e.exercise);
    return [...this.exerciseCatalog, ...own].filter((e) => ids.includes(e.id));
  }

  async upsertCustomExercise(userId: string, id: string, request: CustomExerciseUpsertRequest) {
    if (this.exerciseCatalog.some((e) => e.id === id)) return 'id_taken' as const;
    const stored = this.customExercises.find((e) => e.exercise.id === id);
    if (stored && stored.ownerId !== userId) return 'id_taken' as const;
    if (!stored || Date.parse(stored.recordedAt) <= Date.parse(request.recordedAt)) {
      const next: StoredCustomExercise = {
        exercise: customExercise(id, request),
        ownerId: userId,
        recordedAt: new Date(request.recordedAt).toISOString(),
        deletedAt: null,
      };
      this.customExercises = [...this.customExercises.filter((e) => e.exercise.id !== id), next];
    }
    const current = this.customExercises.find((e) => e.exercise.id === id)!;
    return current.deletedAt === null ? current.exercise : null;
  }

  async deleteCustomExercise(userId: string, id: string, recordedAt: string) {
    const stored = this.customExercises.find((e) => e.exercise.id === id && e.ownerId === userId);
    if (stored && Date.parse(stored.recordedAt) <= Date.parse(recordedAt)) {
      stored.deletedAt = NOW.toISOString();
      stored.recordedAt = new Date(recordedAt).toISOString();
    }
  }

  async listWorkouts(userId: string, from: string, to: string) {
    return this.liveWorkouts(this.rows(userId))
      .filter((w) => w.localDate >= from && w.localDate <= to)
      .sort(newestWorkoutFirst);
  }

  async listWorkoutIdsOfDay(userId: string, localDate: string) {
    return this.liveWorkouts(this.rows(userId))
      .filter((w) => w.localDate === localDate)
      .map((w) => w.id);
  }

  async upsertWorkout(userId: string, workout: Workout) {
    for (const [owner, rows] of this.users) {
      if (owner !== userId && rows.workouts.some((w) => w.id === workout.id)) return null;
    }
    const rows = this.rows(userId);
    const stored = rows.workouts.find((w) => w.id === workout.id);
    if (!stored || Date.parse(stored.recordedAt) <= Date.parse(workout.recordedAt)) {
      const next = {
        ...structuredClone(workout),
        startedAt: new Date(workout.startedAt).toISOString(),
        recordedAt: new Date(workout.recordedAt).toISOString(),
        deleted: false,
      };
      rows.workouts = [...rows.workouts.filter((w) => w.id !== workout.id), next];
    }
    const current = rows.workouts.find((w) => w.id === workout.id);
    return current && !current.deleted ? (({ deleted: _, ...w }) => w)(current) : null;
  }

  async listCheckins(userId: string, from: string, to: string) {
    return this.rows(userId)
      .checkins.filter((c) => !c.deletedAt && c.localDate >= from && c.localDate <= to)
      .sort((a, b) => a.localDate.localeCompare(b.localDate))
      .map(({ deletedAt: _, ...c }) => c);
  }

  private liveCheckin(userId: string, localDate: string): DailyCheckin | null {
    const stored = this.rows(userId).checkins.find((c) => c.localDate === localDate);
    return stored && !stored.deletedAt ? (({ deletedAt: _, ...c }) => c)(stored) : null;
  }

  async upsertCheckin(userId: string, checkin: DailyCheckin) {
    const rows = this.rows(userId);
    const stored = rows.checkins.find((c) => c.localDate === checkin.localDate);
    if (!stored || Date.parse(stored.recordedAt) <= Date.parse(checkin.recordedAt)) {
      const next = {
        ...checkin,
        recordedAt: new Date(checkin.recordedAt).toISOString(),
        deletedAt: null,
      };
      rows.checkins = [...rows.checkins.filter((c) => c.localDate !== checkin.localDate), next];
    }
    return this.liveCheckin(userId, checkin.localDate);
  }

  async deleteCheckin(userId: string, localDate: string, recordedAt: string) {
    const rows = this.rows(userId);
    const stored = rows.checkins.find((c) => c.localDate === localDate);
    const iso = new Date(recordedAt).toISOString();
    if (!stored) {
      rows.checkins.push({
        localDate,
        sleepMinutes: null,
        stress: null,
        workShift: null,
        shiftStartMinute: null,
        shiftEndMinute: null,
        source: 'manual',
        recordedAt: iso,
        deletedAt: NOW.toISOString(),
      });
    } else if (Date.parse(stored.recordedAt) <= Date.parse(recordedAt)) {
      stored.deletedAt = NOW.toISOString();
      stored.recordedAt = iso;
    }
    return this.liveCheckin(userId, localDate);
  }

  async deleteWorkout(userId: string, id: string, recordedAt: string) {
    const stored = this.rows(userId).workouts.find((w) => w.id === id);
    if (stored && Date.parse(stored.recordedAt) <= Date.parse(recordedAt)) {
      stored.deleted = true;
      stored.recordedAt = new Date(recordedAt).toISOString();
    }
  }

  async listExerciseSetRows(userId: string, exerciseId?: string): Promise<ExerciseSetRow[]> {
    return this.liveWorkouts(this.rows(userId))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .flatMap((w) =>
        w.exercises.flatMap((e) =>
          e.exerciseId !== null && (!exerciseId || e.exerciseId === exerciseId)
            ? e.sets.map((set) => ({
                workoutId: w.id,
                localDate: w.localDate,
                startedAt: w.startedAt,
                exerciseId: e.exerciseId!,
                tracking: e.tracking,
                set,
              }))
            : [],
        ),
      );
  }

  // Typical week and routine (spec 010), same semantics as the Drizzle store.

  /** Accounts from before spec 002 (no job): `saveWeek` refuses them, as the missing lifestyle row. */
  async saveWeek(userId: string, write: WeekWrite, at: Date) {
    const rows = this.rows(userId);
    if (!rows.profile || rows.profile.jobActivity === null) return false;
    rows.profile = {
      ...rows.profile,
      week: structuredClone(write.week),
      plannedActivities: structuredClone(write.plannedActivities),
      ...(write.evaluation
        ? { goal: write.evaluation.goal, safetyFlags: write.evaluation.safetyFlags }
        : {}),
    };
    if (write.evaluation) {
      const iso = at.toISOString();
      for (const t of rows.targets) if (t.validTo === null) t.validTo = iso;
      if (write.evaluation.targets) {
        rows.targets.push({ ...write.evaluation.targets, validFrom: iso, validTo: null });
      }
    }
    return true;
  }

  async saveTrainingProfile(userId: string, update: TrainingProfileUpdate) {
    const rows = this.rows(userId);
    if (!rows.profile) return false;
    rows.profile = {
      ...rows.profile,
      trainingExperience: update.experience,
      equipmentAccess: update.equipment,
    };
    return true;
  }

  async getProgram(userId: string) {
    const live = this.rows(userId).programs.find((p) => p.deletedAt === null);
    return live ? (({ deletedAt: _, ...p }) => structuredClone(p))(live) : null;
  }

  async upsertProgram(userId: string, program: Program) {
    const all = [...this.users].flatMap(([owner, r]) => r.programs.map((p) => ({ owner, p })));
    const existing = all.find(({ p }) => p.id === program.id);
    if (existing && existing.owner !== userId) return 'id_taken' as const;
    const rows = this.rows(userId);
    const read = () => {
      const current = rows.programs.find((p) => p.id === program.id && p.deletedAt === null);
      return current ? (({ deletedAt: _, ...p }) => structuredClone(p))(current) : null;
    };
    if (existing && Date.parse(existing.p.recordedAt) > Date.parse(program.recordedAt)) {
      return read();
    }
    const ids = new Set(program.sessions.map((s) => s.id));
    if (all.some(({ p }) => p.id !== program.id && p.sessions.some((s) => ids.has(s.id)))) {
      return 'id_taken' as const;
    }
    if (rows.programs.some((p) => p.id !== program.id && p.deletedAt === null)) {
      return 'program_exists' as const;
    }
    // Workouts of a session left out lose the link (on delete set null).
    for (const removed of existing?.p.sessions.filter((s) => !ids.has(s.id)) ?? []) {
      for (const w of rows.workouts) {
        if (w.programSessionId === removed.id) w.programSessionId = null;
      }
      for (const p of rows.plannedWorkouts) {
        if (p.programSessionId === removed.id) p.programSessionId = null;
      }
    }
    const next = {
      ...structuredClone(program),
      recordedAt: new Date(program.recordedAt).toISOString(),
      deletedAt: null,
    };
    rows.programs = existing
      ? rows.programs.map((p) => (p.id === program.id ? next : p))
      : [...rows.programs, next];
    return read();
  }

  async deleteProgram(userId: string, id: string, recordedAt: string) {
    const stored = this.rows(userId).programs.find((p) => p.id === id && p.deletedAt === null);
    if (stored && Date.parse(stored.recordedAt) <= Date.parse(recordedAt)) {
      stored.deletedAt = NOW.toISOString();
      stored.recordedAt = new Date(recordedAt).toISOString();
    }
  }

  async programSessionOwner(userId: string, sessionId: string) {
    for (const [owner, rows] of this.users) {
      if (rows.programs.some((p) => p.sessions.some((s) => s.id === sessionId))) {
        return owner === userId ? ('own' as const) : ('other' as const);
      }
    }
    return 'missing' as const;
  }

  // Weekly planner (spec 013), same semantics as the Drizzle store.

  async listPlan(userId: string, from: string, to: string) {
    const rows = this.rows(userId);
    const inRange = (r: { localDate: string; deletedAt: string | null }) =>
      r.deletedAt === null && r.localDate >= from && r.localDate <= to;
    const liveWorkout = (id: string | null) =>
      id !== null && rows.workouts.some((w) => w.id === id && !w.deleted);
    return {
      mealItems: rows.plannedMealItems
        .filter(inRange)
        .sort(byDayThenTime)
        .map(({ deletedAt: _, ...i }) => structuredClone(i)),
      // A deleted workout to repeat leaves a free gym session with its name.
      workouts: rows.plannedWorkouts
        .filter(inRange)
        .sort(byDayThenStart)
        .map(({ deletedAt: _, ...w }) => ({
          ...structuredClone(w),
          repeatWorkoutId: liveWorkout(w.repeatWorkoutId) ? w.repeatWorkoutId : null,
        })),
    };
  }

  /** The bulk write of one plan table: deletes, then the rows; the later `recordedAt` wins. */
  private writePlanRows<R extends { id: string; recordedAt: string }>(
    userId: string,
    table: 'plannedMealItems' | 'plannedWorkouts',
    rows: readonly R[],
    deletes: readonly PlanDelete[],
  ): R[] | 'id_taken' {
    const ids = new Set(rows.map((r) => r.id));
    for (const [owner, other] of this.users) {
      if (owner !== userId && other[table].some((r) => ids.has(r.id))) return 'id_taken';
    }
    const own = this.rows(userId)[table] as unknown as (R & { deletedAt: string | null })[];
    for (const d of deletes) {
      const stored = own.find((r) => r.id === d.id);
      if (stored && Date.parse(stored.recordedAt) <= Date.parse(d.recordedAt)) {
        stored.deletedAt ??= NOW.toISOString();
        stored.recordedAt = new Date(d.recordedAt).toISOString();
      }
    }
    for (const row of rows) {
      const index = own.findIndex((r) => r.id === row.id);
      const stored = own[index];
      if (stored && Date.parse(stored.recordedAt) > Date.parse(row.recordedAt)) continue;
      const next = {
        ...structuredClone(row),
        recordedAt: new Date(row.recordedAt).toISOString(),
        deletedAt: null,
      };
      if (index >= 0) own[index] = next;
      else own.push(next);
    }
    return rows.flatMap((row) => {
      const stored = own.find((r) => r.id === row.id && r.deletedAt === null);
      if (!stored) return [];
      return [(({ deletedAt: _, ...live }) => live as unknown as R)(structuredClone(stored))];
    });
  }

  async writePlannedMealItems(
    userId: string,
    rows: readonly PlannedMealItem[],
    deletes: readonly PlanDelete[],
  ) {
    return this.writePlanRows(userId, 'plannedMealItems', rows, deletes);
  }

  async writePlannedWorkouts(
    userId: string,
    rows: readonly PlannedWorkout[],
    deletes: readonly PlanDelete[],
  ) {
    return this.writePlanRows(userId, 'plannedWorkouts', rows, deletes);
  }

  private ownerOf(test: (rows: UserRows) => boolean, userId: string) {
    for (const [owner, rows] of this.users) {
      if (test(rows)) return owner === userId ? ('own' as const) : ('other' as const);
    }
    return 'missing' as const;
  }

  async plannedItemOwner(userId: string, id: string) {
    return this.ownerOf((rows) => rows.plannedMealItems.some((r) => r.id === id), userId);
  }

  async plannedWorkoutOwner(userId: string, id: string) {
    return this.ownerOf((rows) => rows.plannedWorkouts.some((r) => r.id === id), userId);
  }

  async workoutOwner(userId: string, id: string) {
    return this.ownerOf((rows) => rows.workouts.some((w) => w.id === id), userId);
  }

  async exportUser(userId: string): Promise<ExportRecord> {
    const rows = this.rows(userId);
    return {
      programs: structuredClone(rows.programs),
      checkins: [...rows.checkins]
        .sort((a, b) => a.localDate.localeCompare(b.localDate))
        .map((c) => ({ ...c })),
      profile: rows.profile,
      dietaryPrefs: rows.dietaryPrefs,
      targets: rows.targets,
      weights: rows.weights,
      mealItems: this.live(rows).sort(byDayThenTime),
      customFoods: this.extraFoods.filter((f) => f.ownerId === userId).map((f) => toFood(f, 'es')),
      workouts: this.liveWorkouts(rows).sort(newestWorkoutFirst).reverse(),
      customExercises: this.customExercises
        .filter((e) => e.ownerId === userId)
        .map((e) => ({ ...e.exercise, deletedAt: e.deletedAt })),
      favouriteFoods: rows.favourites.map((f) => ({
        foodId: f.foodId,
        key: [...this.catalog, ...this.extraFoods].find((c) => c.id === f.foodId)?.key ?? '',
        createdAt: f.createdAt,
      })),
      plan: {
        mealItems: structuredClone(rows.plannedMealItems).sort(byDayThenTime),
        workouts: structuredClone(rows.plannedWorkouts).sort(byDayThenStart),
      },
      weeklyReviews: [],
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

export function mealUsage(
  feature: 'meal_text' | 'meal_photo',
  status: AiUsage['status'] = 'ok',
): AiUsage {
  return {
    feature,
    model: 'claude-haiku-5-5',
    inputTokens: status === 'error' ? 0 : 3000,
    outputTokens: status === 'error' ? 0 : 400,
    costUsd: status === 'error' ? 0 : 0.0005,
    latencyMs: 2500,
    status,
  };
}

/** One `search_foods` result as the tool sends it to the model (spec 007). */
export interface FakeToolResult {
  results: {
    query: string;
    foods: {
      ref: string;
      name: string;
      unit: string;
      kcalPer100: number;
      servings: { ref: string; label: string; grams: number }[];
    }[];
  }[];
}

/**
 * The meal model: the searches it makes (one array of queries per round), then its answer, built from
 * what the tool returned. Records the inputs it received and the raw tool results.
 */
export interface FakeMealModel {
  searches: string[][];
  answer: ((results: FakeToolResult[]) => MealReading) | AiUnavailableError | null;
  calls: MealInput[];
  toolResults: string[];
}

/** The feedback model (spec 008): its answer, built from the input, and the inputs it received. */
export interface FakeFeedbackModel {
  answer: ((input: FeedbackPromptInput) => FeedbackReading) | AiUnavailableError | null;
  calls: FeedbackPromptInput[];
}

export function feedbackUsage(status: AiUsage['status'] = 'ok'): AiUsage {
  return {
    feature: 'daily_feedback',
    model: 'claude-haiku-5-5',
    inputTokens: status === 'error' ? 0 : 1500,
    outputTokens: status === 'error' ? 0 : 150,
    costUsd: status === 'error' ? 0 : 0.000225,
    latencyMs: 1200,
    status,
  };
}

/** The workout model (spec 012): its answer, built from the input, and the inputs it received. */
export interface FakeWorkoutModel {
  answer: ((input: WorkoutReadInput) => WorkoutReading) | AiUnavailableError | null;
  calls: WorkoutReadInput[];
}

export function workoutUsage(status: AiUsage['status'] = 'ok'): AiUsage {
  return {
    feature: 'workout_text',
    model: 'claude-haiku-5-5',
    inputTokens: status === 'error' ? 0 : 5200,
    outputTokens: status === 'error' ? 0 : 300,
    costUsd: status === 'error' ? 0 : 0.00067,
    latencyMs: 1500,
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
      store.customExercises = store.customExercises.filter((e) => e.ownerId !== userId);
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
  const meal: FakeMealModel = { searches: [], answer: null, calls: [], toolResults: [] };
  const readMeal: ReadMeal = async (input, searchFoods) => {
    meal.calls.push(input);
    const results: FakeToolResult[] = [];
    for (const queries of meal.searches) {
      const text = await searchFoods(queries);
      meal.toolResults.push(text);
      results.push(JSON.parse(text) as FakeToolResult);
    }
    if (meal.answer === null) throw new Error('no fake meal answer set');
    if (meal.answer instanceof AiUnavailableError) throw meal.answer;
    const feature = input.kind === 'photo' ? 'meal_photo' : 'meal_text';
    return { reading: meal.answer(results), usage: mealUsage(feature) };
  };
  /** The feedback model: what it answers next and the inputs it received (spec 008). */
  const feedback: FakeFeedbackModel = { answer: null, calls: [] };
  const wordFeedback: WordFeedback = async (input) => {
    feedback.calls.push(input);
    if (feedback.answer === null) throw new Error('no fake feedback answer set');
    if (feedback.answer instanceof AiUnavailableError) throw feedback.answer;
    return { reading: feedback.answer(input), usage: feedbackUsage() };
  };
  /** The workout model: what it answers next and the inputs it received (spec 012). */
  const workout: FakeWorkoutModel = { answer: null, calls: [] };
  const readWorkout: ReadWorkout = async (input) => {
    workout.calls.push(input);
    if (workout.answer === null) throw new Error('no fake workout answer set');
    if (workout.answer instanceof AiUnavailableError) throw workout.answer;
    return { reading: workout.answer(input), usage: workoutUsage() };
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
    readMeal,
    wordFeedback,
    readWorkout,
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

  return { app, store, deleted, tokens, token, call, off, label, meal, feedback, workout, clock };
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

const newestWorkoutFirst = (a: Workout, b: Workout) =>
  b.localDate.localeCompare(a.localDate) || b.startedAt.localeCompare(a.startedAt);

const byDayThenTime = (
  a: { localDate: string; recordedAt: string },
  b: { localDate: string; recordedAt: string },
) => a.localDate.localeCompare(b.localDate) || a.recordedAt.localeCompare(b.recordedAt);

/** Planned sessions by day and start time, untimed last (as Postgres sorts nulls ascending). */
const byDayThenStart = (a: PlannedWorkout, b: PlannedWorkout) =>
  a.localDate.localeCompare(b.localDate) ||
  (a.startMinute ?? 1440) - (b.startMinute ?? 1440) ||
  a.recordedAt.localeCompare(b.recordedAt);

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

/** Ids of the exercise catalog fixture (spec 009). */
export const EXERCISE = {
  bench: 'e1000000-0000-4000-8000-000000000001',
  pullUp: 'e1000000-0000-4000-8000-000000000002',
  plank: 'e1000000-0000-4000-8000-000000000003',
  rowing: 'e1000000-0000-4000-8000-000000000004',
} as const;

/** One exercise of each tracking type. */
export function exerciseCatalogFixture(): Exercise[] {
  const exercise = (
    id: string,
    key: string,
    nameEs: string,
    nameEn: string,
    tracking: Exercise['tracking'],
    category: Exercise['category'],
    primaryMuscles: Exercise['primaryMuscles'],
    equipment: Exercise['equipment'],
    popularity: number,
  ): Exercise => ({
    id,
    key,
    origin: 'catalog',
    nameEs,
    nameEn,
    synonymsEs: [],
    synonymsEn: [],
    tracking,
    category,
    primaryMuscles,
    secondaryMuscles: [],
    equipment,
    popularity,
    source: 'free-exercise-db',
  });
  return [
    exercise(
      EXERCISE.bench,
      'press-banca',
      'Press de banca',
      'Bench press',
      'weight_reps',
      'strength',
      ['chest'],
      ['barbell'],
      10,
    ),
    exercise(
      EXERCISE.pullUp,
      'dominadas',
      'Dominadas',
      'Pull-up',
      'reps',
      'strength',
      ['back'],
      ['bodyweight'],
      9,
    ),
    exercise(
      EXERCISE.plank,
      'plancha',
      'Plancha',
      'Plank',
      'duration',
      'strength',
      ['core'],
      ['bodyweight'],
      8,
    ),
    exercise(
      EXERCISE.rowing,
      'remo-ergometro',
      'Remo ergómetro',
      'Rowing machine',
      'distance_duration',
      'cardio',
      ['back'],
      ['machine'],
      6,
    ),
  ];
}
