/**
 * In-memory implementation of `ApiClient` for development and E2E tests (no Supabase, no cost).
 * It applies the same rules as apps/api: auth (401), consent (403), Zod validation (400 with `fields`),
 * and @pt/core safety and targets (422 `age_blocked`).
 * Never use it in production builds: the app enables it only with `__DEV__` and an explicit flag.
 */
import {
  BarcodeParamSchema,
  CHECKIN_LIMITS,
  CONSENT_VERSION,
  CheckinDateParamSchema,
  CheckinDeleteQuerySchema,
  CheckinListQuerySchema,
  CheckinUpsertRequestSchema,
  CUSTOM_FOOD_LIMITS,
  ConsentRequestSchema,
  CustomFoodUpsertRequestSchema,
  EMPTY_WEEK,
  DailyFeedbackRequestSchema,
  FEEDBACK_LIMITS,
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
  WORKOUT_LIMITS,
  WORKOUT_DRAFT_LIMITS,
  WorkoutTextDraftRequestSchema,
  CustomExerciseDeleteQuerySchema,
  CustomExerciseUpsertRequestSchema,
  ExerciseHistoryQuerySchema,
  ExerciseIdParamSchema,
  WeightDateParamSchema,
  WeightDeleteQuerySchema,
  WeightListQuerySchema,
  WeightUpsertRequestSchema,
  WorkoutDeleteQuerySchema,
  WorkoutIdParamSchema,
  WorkoutLogQuerySchema,
  WorkoutUpsertRequestSchema,
  ProgramDeleteQuerySchema,
  ProgramIdParamSchema,
  ProgramUpsertRequestSchema,
  TrainingProfileUpdateSchema,
  WeekRequestSchema,
  PLAN_LIMITS,
  PlanMealChangesRequestSchema,
  PlanQuerySchema,
  PlanWorkoutChangesRequestSchema,
  type PlanDelete,
  type PlannedMealItem,
  type PlannedWorkout,
  type Program,
  type ApiErrorCode,
  type DietaryPrefs,
  type Exercise,
  type Workout,
  type FeedbackNote,
  type ExportResponse,
  type Food,
  type LabelReading,
  type Locale,
  type MealItem,
  type MeResponse,
  type Portion,
  type Profile,
  type RecentFood,
  type DailyCheckin,
  type WeightEntry,
  type WeightSaveResponse,
} from '@pt/contracts';
import {
  addDays,
  applyLatestWeight,
  dailyObservations,
  feedbackAvailable,
  feedbackCandidates,
  feedbackCitations,
  feedbackFingerprint,
  isPlausibleClientDate,
  minuteOfDay,
  referenceWeightKg,
  sportCarbsMinimum,
  templateNotes,
  trainingMinutesPerWeek,
  validateFeedback,
  buildFoodSearchIndex,
  checkCustomFood,
  checkFoodLogRange,
  checkFoodLogWrite,
  checkWeightWrite,
  checkCheckinWrite,
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
  buildExerciseStats,
  checkClientDates,
  checkWorkoutRange,
  searchExercises,
  workoutDraft,
  checkWorkoutWrite,
  customExercise,
  exerciseHistory,
  workoutFromRequest,
  evaluateStoredProfile,
  programFromRequest,
  sameTrainingLoad,
  checkPlanRange,
  checkPlanWrite,
  plannedMealItemFromUpsert,
  plannedWorkoutFromUpsert,
  type ExerciseSetRow,
  type LoggableExercise,
} from '@pt/core';
import type { z } from 'zod';
import { ApiError, type ApiClient } from '../client';
import { MOCK_EXERCISE_CATALOG_VERSION, MOCK_EXERCISES } from './exercises';
import { MOCK_CATALOG, MOCK_SOURCE, toMockFood } from './foods';
import { mockPhotoReading, mockTextReading } from './drafts';
import { mockWorkoutReading } from './workout-drafts';
import { mockFeedbackReading } from './feedback';
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
  /** The training log, deletes included as tombstones (spec 009 AC23). */
  workouts: StoredWorkout[];
  /** The user's own exercises, most recently changed first, deletes kept as tombstones (spec 009). */
  customExercises: StoredCustomExercise[];
  /** Routines, oldest first, deletes kept as tombstones (spec 010 AC22). */
  programs: StoredProgram[];
  /** Daily check-ins, deletes kept as tombstones (spec 011 AC15). */
  checkins: StoredCheckin[];
  /** The plan, deletes kept as tombstones (spec 013 AC23). */
  plannedMealItems: (PlannedMealItem & { deletedAt: string | null })[];
  plannedWorkouts: (PlannedWorkout & { deletedAt: string | null })[];
}

type PlanTable = 'plannedMealItems' | 'plannedWorkouts';

type StoredCheckin = DailyCheckin & { deletedAt: string | null };

type StoredProgram = Program & { deletedAt: string | null };

type StoredMealItem = MealItem & { deleted: boolean };
type StoredWorkout = Workout & { deleted: boolean };
interface StoredCustomExercise {
  exercise: Exercise;
  recordedAt: string;
  deletedAt: string | null;
}

type MockDb = Record<string, UserRecord>;

/** Storage key of the mock database. The suffix changes with the shape of the stored rows (v10: spec 013). */
export const MOCK_DB_KEY = 'pt.mock-db.v10';

const exerciseById = new Map(MOCK_EXERCISES.map((e) => [e.id, e]));

/** Newest first, as the API lists workouts: by day, then by start time. */
const newestWorkoutFirst = (a: Workout, b: Workout) =>
  b.localDate.localeCompare(a.localDate) || Date.parse(b.startedAt) - Date.parse(a.startedAt);

const withoutDeleted = ({ deleted: _, ...workout }: StoredWorkout): Workout => workout;

const liveWorkouts = (record: UserRecord): Workout[] =>
  record.workouts.filter((w) => !w.deleted).map(withoutDeleted);

/** Every set of the live workouts, oldest workout first (the rows of the stats, spec 009 AC14). */
function exerciseSetRows(record: UserRecord, exerciseId?: string): ExerciseSetRow[] {
  return liveWorkouts(record)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .flatMap((w) =>
      w.exercises.flatMap((e) => {
        const id = e.exerciseId;
        if (id === null || (exerciseId && id !== exerciseId)) return [];
        return e.sets.map((set) => ({
          workoutId: w.id,
          localDate: w.localDate,
          startedAt: w.startedAt,
          exerciseId: id,
          tracking: e.tracking,
          set,
        }));
      }),
    );
}

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

/** Recently logged foods the feedback candidates come from (spec 008 AC12). */
const FEEDBACK_RECENTS_MAX = 60;

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
  feedback_unavailable: 'The daily feedback is not available for this profile',
  exercise_limit_reached: 'Too many exercises of your own',
  id_taken: 'This id is already used',
  program_exists: 'Another routine is active: delete it first',
  review_decided: 'This weekly review was already decided',
  review_stale: 'A newer weekly review replaces this one',
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
  feedback_unavailable: 422,
  exercise_limit_reached: 400,
  id_taken: 409,
  program_exists: 409,
  review_decided: 409,
  review_stale: 409,
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
  workouts: [],
  customExercises: [],
  programs: [],
  checkins: [],
  plannedMealItems: [],
  plannedWorkouts: [],
});

/** Planned items by day and time; planned sessions by day and start time, untimed last (as the API). */
const plannedItemOrder = (a: PlannedMealItem, b: PlannedMealItem) =>
  a.localDate.localeCompare(b.localDate) || a.recordedAt.localeCompare(b.recordedAt);
const plannedSessionOrder = (a: PlannedWorkout, b: PlannedWorkout) =>
  a.localDate.localeCompare(b.localDate) ||
  (a.startMinute ?? 1440) - (b.startMinute ?? 1440) ||
  a.recordedAt.localeCompare(b.recordedAt);

/**
 * The day limits after a bulk write (150 items, 4 sessions): the live rows of the days, minus the rows
 * the request changes, plus its rows. Returns the index of the first row over the limit, or -1.
 */
function overDayLimit(
  existing: readonly { id: string; localDate: string }[],
  rows: readonly { id: string; localDate: string }[],
  deletes: readonly PlanDelete[],
  max: number,
): number {
  const touched = new Set([...rows, ...deletes].map((c) => c.id));
  const perDay = new Map<string, number>();
  for (const row of existing) {
    if (!touched.has(row.id)) perDay.set(row.localDate, (perDay.get(row.localDate) ?? 0) + 1);
  }
  return rows.findIndex((row) => {
    const count = (perDay.get(row.localDate) ?? 0) + 1;
    perDay.set(row.localDate, count);
    return count > max;
  });
}

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
  function useAi(
    record: UserRecord,
    feature: 'meal_text' | 'meal_photo' | 'workout_text',
    perDay: number,
  ) {
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

  /** The latest item of each food logged in the last 60 days, with its portion (spec 005 AC7). */
  function recentsOf(record: UserRecord, locale: Locale, max: number): RecentFood[] {
    const since = addDays(now().toISOString().slice(0, 10), -FOOD_LOG_LIMITS.recentsDays);
    const latest = new Map<string, MealItem>();
    for (const item of live(record)) {
      if (item.foodId === null || item.localDate < since) continue;
      const seen = latest.get(item.foodId);
      if (!seen || seen.recordedAt < item.recordedAt) latest.set(item.foodId, item);
    }
    return [...latest.values()]
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, max)
      .flatMap((item) => {
        const food = item.foodId ? findFood(record, item.foodId, locale) : null;
        const portion = food ? lastPortion(item, food) : null;
        return food && portion ? [{ food, lastPortion: portion }] : [];
      });
  }

  /** Starred foods, most recently starred first (spec 005 AC14). */
  function favouritesOf(record: UserRecord, locale: Locale): Food[] {
    return [...record.favourites]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((f) => {
        const food = findFood(record, f.foodId, locale);
        return food ? [food] : [];
      });
  }

  /** The user's own exercises that were not deleted, most recently changed first. */
  const ownExercises = (record: UserRecord): Exercise[] =>
    record.customExercises.filter((e) => e.deletedAt === null).map((e) => e.exercise);

  /**
   * The exercises a workout may use: the catalog and the user's own, deleted ones included (an old
   * session that used one can still be edited, as in the API).
   */
  const loggable = (record: UserRecord): Map<string, LoggableExercise> =>
    new Map<string, LoggableExercise>([
      ...exerciseById,
      ...record.customExercises.map((e) => [e.exercise.id, e.exercise] as const),
    ]);

  /** An id of the catalog or of another user's exercise is never written (409 `id_taken`). */
  const exerciseIdTaken = (userId: string, id: string) =>
    exerciseById.has(id) ||
    Object.entries(db).some(
      ([owner, other]) =>
        owner !== userId && other.customExercises.some((e) => e.exercise.id === id),
    );

  /** The live check-in of a day, or null (deleted or never written). */
  const liveCheckin = (record: UserRecord, localDate: string): DailyCheckin | null => {
    const stored = record.checkins.find((c) => c.localDate === localDate);
    return stored && !stored.deletedAt ? (({ deletedAt: _, ...c }) => c)(stored) : null;
  };

  /** A device clock more than a day ahead of the server is rejected. */
  const inFuture = (recordedAt: string) =>
    Date.parse(recordedAt) > now().getTime() + 24 * 60 * 60 * 1000;

  /** Who owns a routine session: the user (live or deleted routine), someone else, or nobody. */
  const programSessionOwner = (userId: string, sessionId: string) => {
    for (const [owner, other] of Object.entries(db)) {
      if (other.programs.some((p) => p.sessions.some((s) => s.id === sessionId))) {
        return owner === userId ? 'own' : 'other';
      }
    }
    return 'missing';
  };

  /** Whose row an id of a plan table or of the workouts is (a log's link, a repeat link). */
  const ownerOf = (
    table: PlanTable | 'workouts',
    userId: string,
    id: string,
  ): 'own' | 'other' | 'missing' => {
    for (const [owner, other] of Object.entries(db)) {
      if ((other[table] as { id: string }[]).some((row) => row.id === id)) {
        return owner === userId ? 'own' : 'other';
      }
    }
    return 'missing';
  };

  /** The date and clock checks of a bulk plan write (spec 013 AC23); deletes have no date. */
  function checkPlanDates(
    upserts: readonly { localDate: string; recordedAt: string }[],
    deletes: readonly PlanDelete[],
  ) {
    for (const [i, upsert] of upserts.entries()) {
      const invalid = checkPlanWrite(upsert, now());
      if (invalid) {
        const [field, reason] = Object.entries(invalid)[0]!;
        throw fail('validation_error', { [`upserts.${i}.${field}`]: reason });
      }
    }
    for (const [i, del] of deletes.entries()) {
      if (inFuture(del.recordedAt)) {
        throw fail('validation_error', { [`deletes.${i}.recordedAt`]: 'in_future' });
      }
    }
  }

  /** A bulk plan write, as the API's transaction: deletes, then rows; the later `recordedAt` wins. */
  function writePlan<R extends { id: string; recordedAt: string }>(
    userId: string,
    record: UserRecord,
    table: PlanTable,
    rows: readonly R[],
    deletes: readonly PlanDelete[],
  ): R[] {
    const ids = new Set(rows.map((r) => r.id));
    for (const [owner, other] of Object.entries(db)) {
      if (owner !== userId && other[table].some((r) => ids.has(r.id))) {
        throw fail('id_taken', { id: 'taken' });
      }
    }
    const own = record[table] as unknown as (R & { deletedAt: string | null })[];
    for (const del of deletes) {
      const stored = own.find((r) => r.id === del.id);
      if (stored && writeWins(stored.recordedAt, del.recordedAt)) {
        stored.deletedAt ??= now().toISOString();
        stored.recordedAt = new Date(del.recordedAt).toISOString();
      }
    }
    for (const row of rows) {
      const index = own.findIndex((r) => r.id === row.id);
      const stored = own[index];
      if (stored && !writeWins(stored.recordedAt, row.recordedAt)) continue;
      const next = { ...row, recordedAt: new Date(row.recordedAt).toISOString(), deletedAt: null };
      if (index >= 0) own[index] = next;
      else own.push(next);
    }
    persist();
    return rows.flatMap((row) => {
      const stored = own.find((r) => r.id === row.id && r.deletedAt === null);
      return stored ? [(({ deletedAt: _, ...live }) => live as unknown as R)(stored)] : [];
    });
  }

  const activeProgram = (record: UserRecord): Program | null => {
    const live = record.programs.find((p) => p.deletedAt === null);
    return live ? (({ deletedAt: _, ...program }) => program)(live) : null;
  };

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
        week: record.profile?.week ?? EMPTY_WEEK,
        trainingExperience: record.profile?.trainingExperience ?? null,
        equipmentAccess: record.profile?.equipmentAccess ?? null,
        energyCalibrationKcal: record.profile?.energyCalibrationKcal ?? 0,
      };
      record.dietaryPrefs = input.dietaryPrefs;
      for (const row of record.targets) if (row.validTo === null) row.validTo = at;
      if (evaluation.targets)
        record.targets.push({ ...evaluation.targets, validFrom: at, validTo: null });
      persist();
      return toMe(user.userId, record);
    },

    saveWeek: async (body) => {
      const { user, record } = await authenticateWithConsent();
      const request = parse(WeekRequestSchema, body);
      if (!isPlausibleClientDate(request.today, now().toISOString())) {
        throw fail('validation_error', { today: 'implausible' });
      }
      const profile = record.profile;
      if (!profile || profile.jobActivity === null) {
        throw fail('validation_error', { profile: 'required' });
      }
      const next: Profile = {
        ...profile,
        plannedActivities: request.plannedActivities,
        week: {
          workPattern: request.workPattern,
          workBlocks: request.workBlocks,
          dayStartMinute: request.dayStartMinute,
        },
      };
      // The targets change only with the training load (spec 010 AC4), as in the API.
      if (!sameTrainingLoad(profile.plannedActivities, request.plannedActivities)) {
        const evaluation = evaluateStoredProfile(
          { ...next, jobActivity: profile.jobActivity },
          profile.weightKg,
          request.today,
          record.weights,
        );
        if (evaluation.kind === 'blocked') throw fail('age_blocked');
        next.goal = evaluation.safety.appliedGoal;
        next.safetyFlags = evaluation.flags;
        const at = now().toISOString();
        for (const row of record.targets) if (row.validTo === null) row.validTo = at;
        if (evaluation.targets) {
          record.targets.push({ ...evaluation.targets, validFrom: at, validTo: null });
        }
      }
      record.profile = next;
      persist();
      return toMe(user.userId, record);
    },

    saveTrainingProfile: async (body) => {
      const { user, record } = await authenticateWithConsent();
      const update = parse(TrainingProfileUpdateSchema, body);
      if (!record.profile) throw fail('validation_error', { profile: 'required' });
      record.profile = {
        ...record.profile,
        trainingExperience: update.experience,
        equipmentAccess: update.equipment,
      };
      persist();
      return toMe(user.userId, record);
    },

    program: async () => {
      const { record } = await authenticateWithConsent();
      return { program: activeProgram(record) };
    },

    saveProgram: async (programId, body) => {
      const { user, record } = await authenticateWithConsent();
      const { id } = parse(ProgramIdParamSchema, { id: programId });
      const request = parse(ProgramUpsertRequestSchema, body);
      if (inFuture(request.recordedAt)) throw fail('validation_error', { recordedAt: 'in_future' });
      const program = programFromRequest(id, request, loggable(record));
      if ('error' in program) {
        if (program.error === 'exercise_not_found') {
          throw fail('not_found', { exerciseId: 'not_found' });
        }
        throw fail('validation_error', {
          [`sessions.${program.sessionIndex}.exercises.${program.exerciseIndex}`]:
            'target_mismatch',
        });
      }
      const all = Object.entries(db).flatMap(([owner, r]) => r.programs.map((p) => ({ owner, p })));
      const existing = all.find(({ p }) => p.id === id);
      if (existing && existing.owner !== user.userId) throw fail('id_taken', { id: 'taken' });
      const read = () => {
        const current = record.programs.find((p) => p.id === id && p.deletedAt === null);
        return { program: current ? (({ deletedAt: _, ...p }) => p)(current) : null };
      };
      // AC22: a later write or delete already won.
      if (existing && !writeWins(existing.p.recordedAt, request.recordedAt)) return read();
      const ids = new Set(program.sessions.map((s) => s.id));
      if (all.some(({ p }) => p.id !== id && p.sessions.some((s) => ids.has(s.id)))) {
        throw fail('id_taken', { id: 'taken' });
      }
      if (record.programs.some((p) => p.id !== id && p.deletedAt === null)) {
        throw fail('program_exists');
      }
      // Workouts and planned sessions of a session left out lose the link (AC22, spec 013).
      for (const removed of existing?.p.sessions.filter((s) => !ids.has(s.id)) ?? []) {
        for (const w of [...record.workouts, ...record.plannedWorkouts]) {
          if (w.programSessionId === removed.id) w.programSessionId = null;
        }
      }
      const next: StoredProgram = {
        ...program,
        recordedAt: new Date(program.recordedAt).toISOString(),
        deletedAt: null,
      };
      record.programs = existing
        ? record.programs.map((p) => (p.id === id ? next : p))
        : [...record.programs, next];
      persist();
      return read();
    },

    deleteProgram: async (programId, query) => {
      const { record } = await authenticateWithConsent();
      const { id } = parse(ProgramIdParamSchema, { id: programId });
      const { recordedAt } = parse(ProgramDeleteQuerySchema, query);
      if (inFuture(recordedAt)) throw fail('validation_error', { recordedAt: 'in_future' });
      const stored = record.programs.find((p) => p.id === id && p.deletedAt === null);
      // A tombstone: its sessions stay, so past workouts keep the link (AC20).
      if (stored && writeWins(stored.recordedAt, recordedAt)) {
        stored.deletedAt = now().toISOString();
        stored.recordedAt = new Date(recordedAt).toISOString();
        persist();
      }
      return { program: null };
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

    listCheckins: async (query) => {
      const { record } = await authenticateWithConsent();
      const { from, to } = parse(CheckinListQuerySchema, query);
      if (from > to) throw fail('validation_error', { from: 'after_to' });
      if (daysBetween(from, to) > CHECKIN_LIMITS.listDaysMax) {
        throw fail('validation_error', { to: 'too_big' });
      }
      return {
        checkins: record.checkins
          .filter((c) => !c.deletedAt && c.localDate >= from && c.localDate <= to)
          .sort((a, b) => a.localDate.localeCompare(b.localDate))
          .map(({ deletedAt: _, ...c }) => c),
      };
    },

    saveCheckin: async (day, body) => {
      const { record } = await authenticateWithConsent();
      const { localDate } = parse(CheckinDateParamSchema, { localDate: day });
      const { today, ...answers } = parse(CheckinUpsertRequestSchema, body);
      const invalid = checkCheckinWrite(
        { localDate, today, recordedAt: answers.recordedAt },
        now(),
      );
      if (invalid) throw fail('validation_error', invalid);
      const stored = record.checkins.find((c) => c.localDate === localDate);
      // The later device time wins, also against a delete (AC15).
      if (writeWins(stored?.recordedAt ?? null, answers.recordedAt)) {
        record.checkins = [
          ...record.checkins.filter((c) => c.localDate !== localDate),
          {
            localDate,
            ...answers,
            source: 'manual',
            recordedAt: new Date(answers.recordedAt).toISOString(),
            deletedAt: null,
          },
        ];
        persist();
      }
      return { checkin: liveCheckin(record, localDate) };
    },

    deleteCheckin: async (day, query) => {
      const { record } = await authenticateWithConsent();
      const { localDate } = parse(CheckinDateParamSchema, { localDate: day });
      const { recordedAt, today } = parse(CheckinDeleteQuerySchema, query);
      const invalid = checkCheckinWrite({ localDate, today, recordedAt }, now());
      if (invalid) throw fail('validation_error', invalid);
      const stored = record.checkins.find((c) => c.localDate === localDate);
      const iso = new Date(recordedAt).toISOString();
      // With no row yet, a tombstone: an older write arriving later must not create it.
      if (!stored) {
        record.checkins.push({
          localDate,
          sleepMinutes: null,
          stress: null,
          workShift: null,
          shiftStartMinute: null,
          shiftEndMinute: null,
          source: 'manual',
          recordedAt: iso,
          deletedAt: now().toISOString(),
        });
        persist();
      } else if (writeWins(stored.recordedAt, recordedAt)) {
        stored.deletedAt ??= now().toISOString();
        stored.recordedAt = iso;
        persist();
      }
      return { checkin: liveCheckin(record, localDate) };
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
          {
            id: 'free-exercise-db',
            name: 'Free Exercise DB',
            url: 'https://github.com/yuhonas/free-exercise-db',
            license: 'The Unlicense (public domain)',
            version: 'f00c92c (2026-09-27)',
            attribution:
              locale === 'en'
                ? 'Exercises: categories, muscles and equipment from Free Exercise DB (https://github.com/yuhonas/free-exercise-db), public domain (The Unlicense). Spanish names and synonyms: our own work.'
                : 'Ejercicios: categorías, músculos y material de Free Exercise DB (https://github.com/yuhonas/free-exercise-db), de dominio público (The Unlicense). Nombres en español y sinónimos: elaboración propia.',
          },
        ],
      };
    },

    exerciseCatalog: async () => {
      const { record } = await authenticateWithConsent();
      return {
        version: MOCK_EXERCISE_CATALOG_VERSION,
        exercises: [...MOCK_EXERCISES, ...ownExercises(record)],
      };
    },

    draftWorkoutFromText: async (body) => {
      const { record } = await authenticateWithConsent();
      const request = parse(WorkoutTextDraftRequestSchema, body);
      const invalid = checkClientDates({ today: request.today }, now());
      if (invalid) throw fail('validation_error', invalid);
      if (
        request.localDate > request.today ||
        request.localDate < addDays(request.today, -WORKOUT_LIMITS.pastDaysUi)
      ) {
        throw fail('validation_error', { localDate: 'out_of_range' });
      }
      useAi(record, 'workout_text', WORKOUT_DRAFT_LIMITS.textsPerDay);
      const exercises = [...MOCK_EXERCISES, ...ownExercises(record)];
      const refs = new Map(exercises.map((e) => [e.id, e]));
      const reading = mockWorkoutReading(request.text, (query) => {
        const [id] = searchExercises(exercises, query, request.locale, 1);
        return id ?? null;
      });
      // The sentence is read and dropped: nothing of it is stored (AC20).
      return workoutDraft(reading, refs, request.today, request.localDate);
    },

    saveCustomExercise: async (exerciseId, body) => {
      const { user, record } = await authenticateWithConsent();
      const { id } = parse(ExerciseIdParamSchema, { id: exerciseId });
      const request = parse(CustomExerciseUpsertRequestSchema, body);
      if (inFuture(request.recordedAt)) throw fail('validation_error', { recordedAt: 'in_future' });
      const own = ownExercises(record);
      if (own.length >= WORKOUT_LIMITS.customExercisesMax && !own.some((e) => e.id === id)) {
        throw fail('exercise_limit_reached');
      }
      if (exerciseIdTaken(user.userId, id)) throw fail('id_taken', { id: 'taken' });
      const stored = record.customExercises.find((e) => e.exercise.id === id);
      // The write recorded later on its device wins, also against a delete.
      if (writeWins(stored?.recordedAt ?? null, request.recordedAt)) {
        record.customExercises = [
          {
            exercise: customExercise(id, request),
            recordedAt: new Date(request.recordedAt).toISOString(),
            deletedAt: null,
          },
          ...record.customExercises.filter((e) => e.exercise.id !== id),
        ];
        persist();
      }
      const current = record.customExercises.find((e) => e.exercise.id === id);
      return { exercise: current && current.deletedAt === null ? current.exercise : null };
    },

    deleteCustomExercise: async (exerciseId, query) => {
      const { record } = await authenticateWithConsent();
      const { id } = parse(ExerciseIdParamSchema, { id: exerciseId });
      const { recordedAt } = parse(CustomExerciseDeleteQuerySchema, query);
      if (inFuture(recordedAt)) throw fail('validation_error', { recordedAt: 'in_future' });
      const stored = record.customExercises.find((e) => e.exercise.id === id);
      // Past sets keep their label; the row stays as a tombstone.
      if (stored && writeWins(stored.recordedAt, recordedAt)) {
        stored.deletedAt = now().toISOString();
        stored.recordedAt = new Date(recordedAt).toISOString();
        persist();
      }
      return { exercise: null };
    },

    listWorkouts: async (query) => {
      const { record } = await authenticateWithConsent();
      const { from, to } = parse(WorkoutLogQuerySchema, query);
      const invalid = checkWorkoutRange(from, to);
      if (invalid) throw fail('validation_error', invalid);
      return {
        workouts: liveWorkouts(record)
          .filter((w) => w.localDate >= from && w.localDate <= to)
          .sort(newestWorkoutFirst),
      };
    },

    saveWorkout: async (workoutId, body) => {
      const { user, record } = await authenticateWithConsent();
      const { id } = parse(WorkoutIdParamSchema, { id: workoutId });
      const request = parse(WorkoutUpsertRequestSchema, body);
      const invalid = checkWorkoutWrite(request, now());
      if (invalid) throw fail('validation_error', invalid);
      const ids = request.kind === 'gym' ? request.exercises.map((e) => e.exerciseId) : [];
      const workout = workoutFromRequest(id, request, loggable(record));
      if ('error' in workout) {
        if (workout.error === 'exercise_not_found') {
          throw fail('not_found', { exerciseId: 'not_found' });
        }
        const index = ids.indexOf(workout.exerciseId);
        throw fail('validation_error', {
          [`exercises.${index}.sets.${workout.setNumber - 1}`]: 'set_mismatch',
        });
      }
      const ofDay = liveWorkouts(record).filter((w) => w.localDate === request.localDate);
      if (ofDay.length >= WORKOUT_LIMITS.workoutsPerDayMax && !ofDay.some((w) => w.id === id)) {
        throw fail('validation_error', { localDate: 'too_many_workouts' });
      }
      if (workout.programSessionId !== null) {
        const owner = programSessionOwner(user.userId, workout.programSessionId);
        if (owner === 'other') throw fail('not_found', { programSessionId: 'not_found' });
        // A session removed before a queued workout arrived: the workout loses the link (AC22).
        if (owner === 'missing') workout.programSessionId = null;
      }
      if (workout.plannedWorkoutId !== null) {
        const owner = ownerOf('plannedWorkouts', user.userId, workout.plannedWorkoutId);
        if (owner === 'other') throw fail('not_found', { plannedWorkoutId: 'not_found' });
        // A planned session that never reached the API: stored without the link (spec 013 AC23).
        if (owner === 'missing') workout.plannedWorkoutId = null;
      }
      // Ids are global: an id that belongs to another user is never touched.
      for (const [owner, other] of Object.entries(db)) {
        if (owner !== user.userId && other.workouts.some((w) => w.id === id)) {
          return { workout: null };
        }
      }
      const stored = record.workouts.find((w) => w.id === id);
      // The write recorded later on its device wins, also against a delete (AC23).
      if (writeWins(stored?.recordedAt ?? null, workout.recordedAt)) {
        record.workouts = [
          ...record.workouts.filter((w) => w.id !== id),
          {
            ...workout,
            startedAt: new Date(workout.startedAt).toISOString(),
            recordedAt: new Date(workout.recordedAt).toISOString(),
            deleted: false,
          },
        ];
        persist();
      }
      const current = record.workouts.find((w) => w.id === id);
      return { workout: current && !current.deleted ? withoutDeleted(current) : null };
    },

    deleteWorkout: async (workoutId, query) => {
      const { record } = await authenticateWithConsent();
      const { id } = parse(WorkoutIdParamSchema, { id: workoutId });
      const { recordedAt } = parse(WorkoutDeleteQuerySchema, query);
      if (inFuture(recordedAt)) throw fail('validation_error', { recordedAt: 'in_future' });
      const stored = record.workouts.find((w) => w.id === id);
      // A delete older than the stored write does not remove it; the tombstone keeps the delete time.
      if (stored && writeWins(stored.recordedAt, recordedAt)) {
        stored.deleted = true;
        stored.recordedAt = new Date(recordedAt).toISOString();
        persist();
      }
      return { workout: null };
    },

    exerciseStats: async () => {
      const { record } = await authenticateWithConsent();
      return { stats: buildExerciseStats(exerciseSetRows(record)) };
    },

    exerciseHistory: async (exerciseId, limit) => {
      const { record } = await authenticateWithConsent();
      const { id } = parse(ExerciseIdParamSchema, { id: exerciseId });
      const query = parse(ExerciseHistoryQuerySchema, limit === undefined ? {} : { limit });
      if (!loggable(record).has(id)) throw fail('not_found', { id: 'not_found' });
      return exerciseHistory(id, exerciseSetRows(record, id), query.limit);
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
      if (item.plannedItemId !== null) {
        const owner = ownerOf('plannedMealItems', user.userId, item.plannedItemId);
        if (owner === 'other') throw fail('not_found', { plannedItemId: 'not_found' });
        // A planned item that never reached the API: stored without the link (spec 013 AC23).
        if (owner === 'missing') item.plannedItemId = null;
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
      return { recents: recentsOf(record, locale, FOOD_LOG_LIMITS.recentsMax) };
    },

    favouriteFoods: async (locale) => {
      const { record } = await authenticateWithConsent();
      return { foods: favouritesOf(record, locale) };
    },

    dailyFeedback: async (body) => {
      const { record } = await authenticateWithConsent();
      const request = parse(DailyFeedbackRequestSchema, body);
      if (!isPlausibleClientDate(request.today, now().toISOString())) {
        throw fail('validation_error', { today: 'implausible' });
      }
      const back = daysBetween(request.localDate, request.today);
      if (back < 0) throw fail('validation_error', { localDate: 'in_future' });
      if (back > FEEDBACK_LIMITS.daysBack) throw fail('validation_error', { localDate: 'too_old' });
      const { profile } = record;
      const targets = record.targets.find((t) => t.validTo === null);
      if (!profile || !targets || !feedbackAvailable(profile.safetyFlags, true)) {
        throw fail('feedback_unavailable');
      }
      const items = live(record).filter((i) => i.localDate === request.localDate);
      const focus = profile.trainingFocus ?? 'general_fitness';
      const reference = referenceWeightKg(profile.heightCm, profile.weightKg);
      const carbsMin = sportCarbsMinimum(
        focus,
        trainingMinutesPerWeek(profile.plannedActivities),
        reference,
      );
      const { state, observations } = dailyObservations(
        { localDate: request.localDate, items, trainingDay: request.trainingDay },
        targets,
        {
          referenceWeightKg: reference,
          trainingFocus: focus,
          carbsMinGPerKg: carbsMin?.gPerKg ?? null,
        },
        { safetyFlags: profile.safetyFlags },
        { today: request.today, minuteOfDay: minuteOfDay(request.localTime) },
      );
      const candidates = feedbackCandidates(
        observations,
        {
          recents: recentsOf(record, request.locale, FEEDBACK_RECENTS_MAX),
          favourites: favouritesOf(record, request.locale),
        },
        targets.kcal,
      );
      // The daily cap of the AI wording (AC15): past it, every note in fixed wording.
      const today = now().toISOString().slice(0, 10);
      const used = record.aiUsage.filter(
        (u) => u.feature === 'daily_feedback' && u.createdAt.slice(0, 10) === today,
      ).length;
      let notes: FeedbackNote[];
      if (used < FEEDBACK_LIMITS.aiPerDay) {
        record.aiUsage.push({
          feature: 'daily_feedback',
          model: 'claude-haiku-5-5',
          inputTokens: 1500,
          outputTokens: 150,
          createdAt: now().toISOString(),
        });
        persist();
        const reading = mockFeedbackReading(observations, candidates, request.locale);
        notes = validateFeedback(reading, observations, candidates);
      } else {
        notes = templateNotes(observations, candidates);
      }
      return {
        localDate: request.localDate,
        state,
        notes,
        citations: feedbackCitations(notes),
        fingerprint: feedbackFingerprint(items),
      };
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
      // The logged and planned items keep their snapshot without the food (AC12); the favourite goes.
      for (const item of [...record.mealItems, ...record.plannedMealItems]) {
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

    getPlan: async (query) => {
      const { record } = await authenticateWithConsent();
      const { from, to } = parse(PlanQuerySchema, query);
      const invalid = checkPlanRange(from, to);
      if (invalid) throw fail('validation_error', invalid);
      const inRange = (r: { localDate: string; deletedAt: string | null }) =>
        r.deletedAt === null && r.localDate >= from && r.localDate <= to;
      const liveWorkout = (id: string | null) =>
        id !== null && record.workouts.some((w) => w.id === id && !w.deleted);
      return {
        mealItems: record.plannedMealItems
          .filter(inRange)
          .map(({ deletedAt: _, ...item }) => item)
          .sort(plannedItemOrder),
        // A deleted workout to repeat leaves a free gym session with its name (spec 013 Stale links).
        workouts: record.plannedWorkouts
          .filter(inRange)
          .map(({ deletedAt: _, ...session }) => ({
            ...session,
            repeatWorkoutId: liveWorkout(session.repeatWorkoutId) ? session.repeatWorkoutId : null,
          }))
          .sort(plannedSessionOrder),
      };
    },

    savePlanMealChanges: async (body) => {
      const { user, record } = await authenticateWithConsent();
      const { locale, upserts, deletes } = parse(PlanMealChangesRequestSchema, body);
      checkPlanDates(upserts, deletes);
      const rows: PlannedMealItem[] = [];
      for (const [i, upsert] of upserts.entries()) {
        const food = upsert.kind === 'food' ? findFood(record, upsert.foodId, locale) : null;
        const row = plannedMealItemFromUpsert(upsert, food);
        if ('error' in row) {
          throw row.error === 'food_not_found'
            ? fail('not_found', { [`upserts.${i}.foodId`]: 'not_found' })
            : fail('validation_error', { [`upserts.${i}.portion.servingId`]: 'not_found' });
        }
        rows.push(row);
      }
      const live = record.plannedMealItems.filter((r) => r.deletedAt === null);
      const over = overDayLimit(live, rows, deletes, PLAN_LIMITS.itemsPerDayMax);
      if (over >= 0) {
        throw fail('validation_error', { [`upserts.${over}.localDate`]: 'too_many_items' });
      }
      return { mealItems: writePlan(user.userId, record, 'plannedMealItems', rows, deletes) };
    },

    savePlanWorkoutChanges: async (body) => {
      const { user, record } = await authenticateWithConsent();
      const { upserts, deletes } = parse(PlanWorkoutChangesRequestSchema, body);
      checkPlanDates(upserts, deletes);
      const rows: PlannedWorkout[] = [];
      for (const [i, upsert] of upserts.entries()) {
        let row = plannedWorkoutFromUpsert(upsert);
        if (row.programSessionId !== null) {
          const owner = programSessionOwner(user.userId, row.programSessionId);
          if (owner === 'other') {
            throw fail('not_found', { [`upserts.${i}.programSessionId`]: 'not_found' });
          }
          // A session removed before a queued plan arrived: a free gym session with its name.
          if (owner === 'missing') row = { ...row, programSessionId: null };
        }
        if (row.repeatWorkoutId !== null) {
          const owner = ownerOf('workouts', user.userId, row.repeatWorkoutId);
          if (owner === 'other') {
            throw fail('not_found', { [`upserts.${i}.repeatWorkoutId`]: 'not_found' });
          }
          if (owner === 'missing') row = { ...row, repeatWorkoutId: null };
        }
        rows.push(row);
      }
      const live = record.plannedWorkouts.filter((r) => r.deletedAt === null);
      const over = overDayLimit(live, rows, deletes, PLAN_LIMITS.sessionsPerDayMax);
      if (over >= 0) {
        throw fail('validation_error', { [`upserts.${over}.localDate`]: 'too_many_sessions' });
      }
      return { workouts: writePlan(user.userId, record, 'plannedWorkouts', rows, deletes) };
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
        workouts: liveWorkouts(record).sort(newestWorkoutFirst).reverse(),
        // Deleted ones too, with `deletedAt`: the tombstone is still data we hold (spec 009 AC25).
        customExercises: record.customExercises.map((e) => ({
          ...e.exercise,
          deletedAt: e.deletedAt,
        })),
        // Deleted ones too, with `deletedAt` (spec 010 AC24).
        programs: record.programs,
        // Deleted ones too, with `deletedAt` (spec 011 AC16).
        checkins: [...record.checkins].sort((a, b) => a.localDate.localeCompare(b.localDate)),
        favouriteFoods: record.favourites.map((f) => ({
          foodId: f.foodId,
          key: catalogById.get(f.foodId)?.key ?? '',
          createdAt: f.createdAt,
        })),
        // Deleted ones too, with `deletedAt` (spec 013 AC25).
        plan: {
          mealItems: [...record.plannedMealItems].sort(plannedItemOrder),
          workouts: [...record.plannedWorkouts].sort(plannedSessionOrder),
        },
        weeklyReviews: [],
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
