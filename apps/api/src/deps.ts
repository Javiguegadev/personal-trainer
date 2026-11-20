import type { AiFeature, AiUsage, ReadLabel, ReadMeal, WordFeedback } from '@pt/ai';
import type {
  ConsentKind,
  DietaryPrefs,
  ExportResponse,
  JobActivity,
  Profile,
  SafetyFlag,
  StoredTargets,
  Targets,
  TrainingFocus,
  WeightEntry,
  MealItem,
  Nutrients,
  CustomFoodUpsertRequest,
  FoodOrigin,
  QuantityUnit,
  CustomExerciseUpsertRequest,
  Exercise,
  Workout,
  PlannedActivity,
  Program,
  TrainingProfileUpdate,
  Week,
  WorkPattern,
} from '@pt/contracts';
import type { ExerciseSetRow, LoggableExercise } from '@pt/core';
import type { LookupProduct } from './off/client';

/** The signed-in user, taken from a verified Supabase access token. */
export interface AuthUser {
  userId: string;
  email: string | null;
}

/** Returns the user for a valid access token, or null (expired, bad signature, wrong audience…). */
export type VerifyToken = (token: string) => Promise<AuthUser | null>;

export interface MeRecord {
  consentVersion: string | null;
  profile: Profile | null;
  dietaryPrefs: DietaryPrefs | null;
  targets: StoredTargets | null;
}

export interface ProfileWrite {
  profile: Omit<
    Profile,
    | 'onboardingCompletedAt'
    | 'jobActivity'
    | 'trainingFocus'
    | 'week'
    | 'trainingExperience'
    | 'equipmentAccess'
  > & {
    jobActivity: JobActivity;
    trainingFocus: TrainingFocus;
  };
  dietaryPrefs: DietaryPrefs;
  /** Null when safety rules do not allow numeric targets: the current row is closed, nothing is inserted. */
  targets: Targets | null;
  /**
   * The user's day. When the profile is new or its weight changed, the weight is also stored as the
   * entry of this day (spec 003 AC13).
   */
  today: string;
}

export interface SafetyContext {
  /** Empty when there is no profile yet. */
  flags: SafetyFlag[];
  /** Null when there is no profile yet. */
  weightKg: number | null;
  weights: WeightEntry[];
}

/** A weight write: the entry to store for that day, or null to delete it. */
export interface WeightWrite {
  localDate: string;
  /** First day of `WeightState.recent`. */
  recentFrom: string;
  entry: { weightKg: number; recordedAt: string } | null;
}

/** What `writeWeight` shows its `decide` callback, read inside the transaction after the write. */
export interface WeightState {
  profile: Profile;
  targets: StoredTargets | null;
  /** The user's most recent entry by day, after the write. */
  latest: WeightEntry | null;
  /** The entries from `WeightWrite.recentFrom` on, after the write, oldest first. */
  recent: WeightEntry[];
}

/** The profile after the most recent weight changed (spec 003 AC10). */
export interface WeightDecision {
  weightKg: number;
  goal: Profile['goal'];
  safetyFlags: SafetyFlag[];
  /** Set when the targets differ: the current row is closed and this one is inserted (null = none). */
  newTargets?: Targets | null;
}

export interface WeightWriteResult {
  /** The entry stored for that day after the write. */
  entry: WeightEntry | null;
  /** The targets before the write. */
  previousTargets: StoredTargets | null;
}

export type ExportRecord = Omit<ExportResponse, 'exportedAt' | 'userId' | 'email'>;

/**
 * A food in both languages, as stored: of the curated catalog (spec 005), a product read from Open Food
 * Facts, or a food its owner created (spec 006).
 */
export interface CatalogFood {
  id: string;
  key: string;
  source: string;
  nameEs: string;
  nameEn: string;
  synonymsEs: string[];
  popularity: number;
  per100g: Nutrients;
  /** Most common first. */
  servings: { id: string; labelEs: string; labelEn: string; grams: number }[];
  origin: FoodOrigin;
  unit: QuantityUnit;
  brand: string | null;
  barcode: string | null;
  /** Set for a custom food: only this user may read it. */
  ownerId: string | null;
  allergens: string[];
  traces: string[];
  /** When Open Food Facts was read (products only). */
  fetchedAt: string | null;
}

/** A product read from Open Food Facts, to store under its barcode (spec 006 AC3, AC4). */
export interface ProductWrite {
  barcode: string;
  name: string;
  brand: string | null;
  unit: QuantityUnit;
  per100g: Nutrients;
  servings: { labelEs: string; labelEn: string; grams: number }[];
  allergens: string[];
  traces: string[];
}

export type BarcodeMissReason = 'not_found' | 'incomplete';

export interface KnowledgeSourceRecord {
  id: string;
  name: string;
  url: string;
  license: string;
  version: string;
  attributionEs: string;
  attributionEn: string;
}

/** Persistence port. Real implementation: `store/drizzle-store.ts`; tests use an in-memory fake. */
export interface Store {
  getMe(userId: string): Promise<MeRecord>;
  /** Whether the latest active (not revoked) consent of this kind is for this version of the text. */
  hasConsent(userId: string, kind: ConsentKind, version: string): Promise<boolean>;
  grantConsent(userId: string, kind: ConsentKind, version: string, at: Date): Promise<void>;
  /**
   * What the safety rules need besides the form: the stored flags (`ed_soft_stop` is sticky), the stored
   * weight and the weight entries from `weightsFrom` on (the low-BMI recovery rule, spec 003 AC12).
   */
  getSafetyContext(userId: string, weightsFrom: string): Promise<SafetyContext>;
  /**
   * In one transaction: upserts profile, job and prefs, replaces the training list, closes the current
   * targets row and inserts the new one (spec 001 AC16, spec 002 AC5).
   */
  saveProfile(userId: string, data: ProfileWrite, at: Date): Promise<void>;
  /** Entries dated from `from` to `to` (inclusive), oldest first. */
  listWeights(userId: string, from: string, to: string): Promise<WeightEntry[]>;
  /**
   * In one transaction (spec 003 AC8–AC10, AC20): stores the entry unless the stored one was recorded
   * later, or deletes it; then asks `decide` what the profile becomes and applies it. Returns null when
   * the user has no profile (nothing is written).
   */
  writeWeight(
    userId: string,
    write: WeightWrite,
    decide: (state: WeightState) => WeightDecision | null,
    at: Date,
  ): Promise<WeightWriteResult | null>;
  recordAiUsage(userId: string, usage: AiUsage, at: Date): Promise<void>;
  exportUser(userId: string): Promise<ExportRecord>;

  // Food catalog and food log (spec 005)
  /** The whole catalog with its servings (about 800 foods): the API searches it in memory. */
  listCatalog(): Promise<CatalogFood[]>;
  listKnowledgeSources(): Promise<KnowledgeSourceRecord[]>;
  /** Live items dated from `from` to `to` (inclusive), by day and then by `recordedAt`. */
  listMealItems(userId: string, from: string, to: string): Promise<MealItem[]>;
  /** Live items of one day (the 150-items guard). */
  countMealItems(userId: string, localDate: string): Promise<number>;
  /**
   * Stores the item unless the stored row of that id (live or deleted) was recorded later (AC20). Returns
   * the live item stored after the write, or null when that id is deleted or belongs to another user.
   */
  upsertMealItem(userId: string, item: MealItem): Promise<MealItem | null>;
  /** Marks the item deleted (a tombstone) unless it was recorded after `recordedAt` (AC20). */
  deleteMealItem(userId: string, id: string, recordedAt: string): Promise<void>;
  /** The latest live item of each catalog food logged from `since` on, newest first (AC7). */
  listRecentFoodItems(userId: string, since: string, limit: number): Promise<MealItem[]>;
  /** Starred food ids, most recently starred first (AC14). */
  listFavouriteFoodIds(userId: string): Promise<string[]>;
  setFavouriteFood(userId: string, foodId: string, favourite: boolean, at: Date): Promise<void>;

  // Scanned products and custom foods (spec 006)
  /** The foods with these ids that the user may read: the catalog, products and their own foods. */
  getFoods(userId: string, ids: readonly string[]): Promise<CatalogFood[]>;
  /** The user's own food with that barcode and the cached product, each or null (AC3). */
  findFoodsByBarcode(
    userId: string,
    barcode: string,
  ): Promise<{ own: CatalogFood | null; product: CatalogFood | null }>;
  /** Stores or refreshes the product of a barcode, keeps the ids of its servings, forgets its miss. */
  saveProduct(product: ProductWrite, at: Date): Promise<CatalogFood>;
  /** Why the barcode gave no product, when that was recorded after `since` (AC6). */
  getBarcodeMiss(barcode: string, since: Date): Promise<BarcodeMissReason | null>;
  recordBarcodeMiss(barcode: string, reason: BarcodeMissReason, at: Date): Promise<void>;
  /** The user's own foods, most recently changed first (AC12). */
  listCustomFoods(userId: string): Promise<CatalogFood[]>;
  /**
   * Stores a food of the user's own under a client id (idempotent). `not_owner`: the id is another
   * user's food, or not a custom food (AC13). `barcode_taken`: another of their foods has that barcode.
   */
  upsertCustomFood(
    userId: string,
    id: string,
    food: CustomFoodUpsertRequest,
    at: Date,
  ): Promise<CatalogFood | 'not_owner' | 'barcode_taken'>;
  /** Deletes the user's own food; logged items keep their snapshot (AC12). */
  deleteCustomFood(userId: string, id: string): Promise<void>;
  /** The products the user has logged, for their own search (AC11). */
  listLoggedProducts(userId: string, limit: number): Promise<CatalogFood[]>;
  /** Calls of a feature by the user from `since` on, whatever their outcome (AC18). */
  countAiUsage(userId: string, feature: AiFeature, since: Date): Promise<number>;

  // Exercise catalog and workout log (spec 009)
  /** The curated catalog (about 200 rows) and its version, which changes with every import (AC1). */
  listExerciseCatalog(): Promise<{ exercises: Exercise[]; version: string }>;
  /** The user's live custom exercises, most recently changed first. */
  listCustomExercises(userId: string): Promise<Exercise[]>;
  /**
   * The exercises with these ids the user may log: the catalog and their own, deleted ones included (a
   * session edited after its custom exercise was deleted keeps it).
   */
  getLoggableExercises(userId: string, ids: readonly string[]): Promise<LoggableExercise[]>;
  /**
   * Stores a custom exercise under a client id unless the stored row (live or deleted) was recorded
   * later. Returns the live exercise after the write, null when a later delete won, or `id_taken` when
   * the id is a catalog exercise or another user's.
   */
  upsertCustomExercise(
    userId: string,
    id: string,
    exercise: CustomExerciseUpsertRequest,
  ): Promise<Exercise | null | 'id_taken'>;
  /** Marks the user's custom exercise deleted unless it was recorded after `recordedAt`. */
  deleteCustomExercise(userId: string, id: string, recordedAt: string): Promise<void>;
  /** Live workouts dated from `from` to `to` (inclusive), newest first. */
  listWorkouts(userId: string, from: string, to: string): Promise<Workout[]>;
  /** Ids of the live workouts of one day (the 10-workouts guard). */
  listWorkoutIdsOfDay(userId: string, localDate: string): Promise<string[]>;
  /**
   * Replaces the workout and its sets unless the stored row of that id (live or deleted) was recorded
   * later (AC23). Returns the live workout after the write, or null when that id is deleted or belongs to
   * another user.
   */
  upsertWorkout(userId: string, workout: Workout): Promise<Workout | null>;
  /** Marks the workout deleted (a tombstone) unless it was recorded after `recordedAt` (AC23). */
  deleteWorkout(userId: string, id: string, recordedAt: string): Promise<void>;
  /** Every set of the user's live workouts that points to an exercise, or only of one (AC14, AC15). */
  listExerciseSetRows(userId: string, exerciseId?: string): Promise<ExerciseSetRow[]>;

  // Typical week and routine (spec 010)
  /**
   * In one transaction (AC4): the work pattern, work blocks and day start, the activities with their
   * days, and, when the training load changed, the profile evaluated again. Returns false when the
   * user has no profile, or one from before spec 002 without a job (nothing is written).
   */
  saveWeek(userId: string, write: WeekWrite, at: Date): Promise<boolean>;
  /** The routine wizard's answers (AC14). Returns false when the user has no profile. */
  saveTrainingProfile(userId: string, update: TrainingProfileUpdate, at: Date): Promise<boolean>;
  /** The user's active routine with its sessions in rotation order, or null. */
  getProgram(userId: string): Promise<Program | null>;
  /**
   * Replaces the routine unless the stored row of that id (live or deleted) was recorded later (AC22):
   * sessions are kept by id and the missing ones deleted (their workouts lose the link), exercises are
   * replaced. Returns the live routine of that id after the write, or null when a later delete won.
   * `id_taken`: the routine or one of its session ids belongs to another user or another routine.
   * `program_exists`: another routine of the user is active (AC20: the client deletes it first).
   */
  upsertProgram(userId: string, program: Program): Promise<Program | null | ProgramWriteConflict>;
  /** Marks the routine deleted (a tombstone) unless it was recorded after `recordedAt` (AC20, AC22). */
  deleteProgram(userId: string, id: string, recordedAt: string): Promise<void>;
  /** Who owns a routine session (AC18): the user (live or deleted routine), someone else, or nobody. */
  programSessionOwner(userId: string, sessionId: string): Promise<'own' | 'other' | 'missing'>;
}

export type ProgramWriteConflict = 'id_taken' | 'program_exists';

/** A `PUT /me/week` write (AC4). */
export interface WeekWrite {
  week: Omit<Week, 'workPattern'> & { workPattern: WorkPattern };
  plannedActivities: PlannedActivity[];
  /**
   * Set when the training load changed: the profile evaluated again with the new activities (the
   * targets row is closed and `targets` inserted, null = none). Absent: goal, flags and targets stay.
   */
  evaluation?: { goal: Profile['goal']; safetyFlags: SafetyFlag[]; targets: Targets | null };
}

/** Supabase Auth admin (service key, server only). Deleting the auth user cascades to every user row. */
export interface AuthAdmin {
  deleteUser(userId: string): Promise<void>;
}

export interface Deps {
  verifyToken: VerifyToken;
  store: Store;
  authAdmin: AuthAdmin;
  /** Open Food Facts, one product per call (spec 006 AC3). */
  lookupProduct: LookupProduct;
  /** Claude reading a nutrition label (spec 006 AC15). */
  readLabel: ReadLabel;
  /** Claude turning a sentence or a plate photo into catalog foods (spec 007). */
  readMeal: ReadMeal;
  /** Claude wording the daily feedback (spec 008). */
  wordFeedback: WordFeedback;
  now: () => Date;
}
