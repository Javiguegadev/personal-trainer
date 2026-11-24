import {
  ApiErrorSchema,
  CheckinListResponseSchema,
  CheckinSaveResponseSchema,
  CustomExerciseSaveResponseSchema,
  CustomFoodsResponseSchema,
  DailyFeedbackResponseSchema,
  ExerciseCatalogResponseSchema,
  ExerciseHistoryResponseSchema,
  ExerciseStatsResponseSchema,
  ExportResponseSchema,
  FavouriteFoodsResponseSchema,
  FoodLogResponseSchema,
  FoodSchema,
  FoodSearchResponseSchema,
  HealthResponseSchema,
  KnowledgeSourcesResponseSchema,
  LabelScanResponseSchema,
  MealDraftResponseSchema,
  MealItemSaveResponseSchema,
  MeResponseSchema,
  ProgramResponseSchema,
  RecentFoodsResponseSchema,
  TargetsPreviewResponseSchema,
  WeightListResponseSchema,
  WeightSaveResponseSchema,
  WorkoutLogResponseSchema,
  WorkoutSaveResponseSchema,
  WorkoutDraftResponseSchema,
  type ApiErrorCode,
  type CheckinDeleteQuery,
  type CheckinListQuery,
  type CheckinListResponse,
  type CheckinSaveResponse,
  type CheckinUpsertRequest,
  type ConsentRequest,
  type CustomExerciseDeleteQuery,
  type CustomExerciseSaveResponse,
  type CustomExerciseUpsertRequest,
  type CustomFoodUpsertRequest,
  type CustomFoodsResponse,
  type DailyFeedbackRequest,
  type DailyFeedbackResponse,
  type ExerciseCatalogResponse,
  type ExerciseHistoryResponse,
  type ExerciseStatsResponse,
  type ExportResponse,
  type FavouriteFoodsResponse,
  type Food,
  type FoodLogQuery,
  type FoodLogResponse,
  type FoodSearchResponse,
  type HealthResponse,
  type KnowledgeSourcesResponse,
  type LabelScanRequest,
  type LabelScanResponse,
  type MealDraftResponse,
  type MealPhotoDraftRequest,
  type MealTextDraftRequest,
  type Locale,
  type MealItemDeleteQuery,
  type MealItemSaveResponse,
  type MealItemUpsertRequest,
  type MeResponse,
  type RecentFoodsResponse,
  type ProfileInput,
  type TargetsPreviewResponse,
  type WeightDeleteQuery,
  type WeightListQuery,
  type WeightListResponse,
  type WeightSaveResponse,
  type WeightUpsertRequest,
  type WorkoutDeleteQuery,
  type WorkoutLogQuery,
  type WorkoutLogResponse,
  type WorkoutSaveResponse,
  type WorkoutUpsertRequest,
  type WorkoutDraftResponse,
  type WorkoutTextDraftRequest,
  type ProgramDeleteQuery,
  type ProgramResponse,
  type ProgramUpsertRequest,
  type TrainingProfileUpdate,
  type WeekRequest,
} from '@pt/contracts';
import type { z } from 'zod';

/** Code used when the response body is not an `ApiErrorSchema` body (proxy error, network, …). */
const FALLBACK_CODES: Partial<Record<number, ApiErrorCode>> = {
  400: 'validation_error',
  401: 'unauthorized',
  404: 'not_found',
  413: 'image_too_large',
  429: 'rate_limited',
};

/**
 * Error thrown for every non-2xx response. `code` maps to the i18n key `errors.<code>`;
 * `fields` maps a field path to an error code (AC22).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown, code?: ApiErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
  /** Called on every 401 (expired or revoked session), e.g. to sign out locally. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

async function toApiError(res: Response, fallbackMessage: string): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, fields } = parsed.data;
    return new ApiError(res.status, code, message, fields);
  }
  return new ApiError(res.status, FALLBACK_CODES[res.status] ?? 'internal_error', fallbackMessage);
}

export function createApiClient({
  baseUrl,
  getAccessToken,
  onUnauthorized,
  fetchImpl = fetch,
}: ApiClientOptions) {
  async function send(path: string, init: RequestInit & { json?: unknown } = {}) {
    const { json, ...rest } = init;
    const headers = new Headers(rest.headers);
    headers.set('accept', 'application/json');
    if (json !== undefined) headers.set('content-type', 'application/json');
    const token = await getAccessToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);

    const res = await fetchImpl(new URL(path, baseUrl), {
      ...rest,
      headers,
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });
    if (!res.ok) {
      if (res.status === 401) onUnauthorized?.();
      throw await toApiError(res, `${rest.method ?? 'GET'} ${path} failed (${res.status})`);
    }
    return res;
  }

  async function request<S extends z.ZodType>(
    path: string,
    schema: S,
    init: RequestInit & { json?: unknown } = {},
  ): Promise<z.infer<S>> {
    const res = await send(path, init);
    return schema.parse(await res.json());
  }

  return {
    health: (): Promise<HealthResponse> => request('/health', HealthResponseSchema),

    /** `GET /me`: profile, prefs, current targets, consent and onboarding status. */
    me: (): Promise<MeResponse> => request('/me', MeResponseSchema),

    /** `POST /me/consent` (AC6). */
    grantConsent: async (body: ConsentRequest): Promise<void> => {
      await send('/me/consent', { method: 'POST', json: body });
    },

    /** `PUT /me/profile`: stores profile + prefs + new targets (AC10, AC11, AC16). */
    updateProfile: (body: ProfileInput): Promise<MeResponse> =>
      request('/me/profile', MeResponseSchema, { method: 'PUT', json: body }),

    /** `POST /onboarding/targets-preview`: targets + safety, nothing stored (AC10, AC13–AC19). */
    targetsPreview: (body: ProfileInput): Promise<TargetsPreviewResponse> =>
      request('/onboarding/targets-preview', TargetsPreviewResponseSchema, {
        method: 'POST',
        json: body,
      }),

    /** `GET /me/weights`: the entries of a range of at most 366 days, oldest first (spec 003). */
    listWeights: ({ from, to }: WeightListQuery): Promise<WeightListResponse> =>
      request(`/me/weights?from=${from}&to=${to}`, WeightListResponseSchema),

    /** `PUT /me/weights/:localDate`: one entry per day; idempotent (spec 003 AC8, AC19). */
    saveWeight: (localDate: string, body: WeightUpsertRequest): Promise<WeightSaveResponse> =>
      request(`/me/weights/${localDate}`, WeightSaveResponseSchema, { method: 'PUT', json: body }),

    /** `DELETE /me/weights/:localDate`: succeeds when the entry no longer exists (spec 003 AC9). */
    deleteWeight: (localDate: string, query: WeightDeleteQuery): Promise<WeightSaveResponse> =>
      request(`/me/weights/${localDate}?today=${query.today}`, WeightSaveResponseSchema, {
        method: 'DELETE',
      }),

    /** `GET /me/checkins`: the check-ins of a range of at most 92 days, oldest first (spec 011). */
    listCheckins: ({ from, to }: CheckinListQuery): Promise<CheckinListResponse> =>
      request(`/me/checkins?from=${from}&to=${to}`, CheckinListResponseSchema),

    /** `PUT /me/checkins/:localDate`: one check-in per day; the later `recordedAt` wins (AC15). */
    saveCheckin: (localDate: string, body: CheckinUpsertRequest): Promise<CheckinSaveResponse> =>
      request(`/me/checkins/${localDate}`, CheckinSaveResponseSchema, {
        method: 'PUT',
        json: body,
      }),

    /** `DELETE /me/checkins/:localDate`: a tombstone that an older write cannot undo (AC15). */
    deleteCheckin: (
      localDate: string,
      { recordedAt, today }: CheckinDeleteQuery,
    ): Promise<CheckinSaveResponse> =>
      request(
        `/me/checkins/${localDate}?recordedAt=${encodeURIComponent(recordedAt)}&today=${today}`,
        CheckinSaveResponseSchema,
        { method: 'DELETE' },
      ),

    /** `GET /foods/search`: at most 25 foods, best first (spec 005 AC4). */
    searchFoods: (q: string, locale: Locale): Promise<FoodSearchResponse> =>
      request(
        `/foods/search?q=${encodeURIComponent(q)}&locale=${locale}`,
        FoodSearchResponseSchema,
      ),

    /** `GET /foods/:foodId`: one catalog food, to edit a logged portion (spec 005 AC11). */
    getFood: (foodId: string, locale: Locale): Promise<Food> =>
      request(`/foods/${foodId}?locale=${locale}`, FoodSchema),

    /** `GET /foods/sources`: the "Fuentes de datos" screen (spec 005 AC3). */
    foodSources: (locale: Locale): Promise<KnowledgeSourcesResponse> =>
      request(`/foods/sources?locale=${locale}`, KnowledgeSourcesResponseSchema),

    /** `GET /me/food-log`: the items of at most 31 days (spec 005). */
    listFoodLog: ({ from, to }: FoodLogQuery): Promise<FoodLogResponse> =>
      request(`/me/food-log?from=${from}&to=${to}`, FoodLogResponseSchema),

    /** `PUT /me/food-log/items/:id`: idempotent; the later `recordedAt` wins (spec 005 AC9, AC20). */
    saveMealItem: (id: string, body: MealItemUpsertRequest): Promise<MealItemSaveResponse> =>
      request(`/me/food-log/items/${id}`, MealItemSaveResponseSchema, {
        method: 'PUT',
        json: body,
      }),

    /** `DELETE /me/food-log/items/:id`: succeeds when the item does not exist (spec 005 AC11, AC20). */
    deleteMealItem: (
      id: string,
      { recordedAt }: MealItemDeleteQuery,
    ): Promise<MealItemSaveResponse> =>
      request(
        `/me/food-log/items/${id}?recordedAt=${encodeURIComponent(recordedAt)}`,
        MealItemSaveResponseSchema,
        { method: 'DELETE' },
      ),

    /** `GET /me/foods/recent`: with the portion used last (spec 005 AC7). */
    recentFoods: (locale: Locale): Promise<RecentFoodsResponse> =>
      request(`/me/foods/recent?locale=${locale}`, RecentFoodsResponseSchema),

    /** `GET /me/foods/favourites` (spec 005 AC14). */
    favouriteFoods: (locale: Locale): Promise<FavouriteFoodsResponse> =>
      request(`/me/foods/favourites?locale=${locale}`, FavouriteFoodsResponseSchema),

    /** `PUT` / `DELETE /me/foods/favourites/:foodId`: idempotent (spec 005 AC14). */
    setFavouriteFood: async (foodId: string, favourite: boolean): Promise<void> => {
      await send(`/me/foods/favourites/${foodId}`, { method: favourite ? 'PUT' : 'DELETE' });
    },

    /**
     * `GET /foods/barcode/:code`: the user's own food with that barcode, else the product of Open Food
     * Facts. 404 `product_not_found` or `product_incomplete`, 503 `lookup_unavailable` (spec 006 AC3).
     */
    foodByBarcode: (code: string, locale: Locale): Promise<Food> =>
      request(`/foods/barcode/${code}?locale=${locale}`, FoodSchema),

    /** `GET /me/foods`: the user's own foods, most recently changed first (spec 006 AC12). */
    customFoods: (locale: Locale): Promise<CustomFoodsResponse> =>
      request(`/me/foods?locale=${locale}`, CustomFoodsResponseSchema),

    /** `PUT /me/foods/:id`: a food of the user's own under a client id; idempotent (spec 006 AC11). */
    saveCustomFood: (id: string, body: CustomFoodUpsertRequest): Promise<Food> =>
      request(`/me/foods/${id}`, FoodSchema, { method: 'PUT', json: body }),

    /** `DELETE /me/foods/:id`: succeeds when the food does not exist (spec 006 AC12). */
    deleteCustomFood: async (id: string): Promise<void> => {
      await send(`/me/foods/${id}`, { method: 'DELETE' });
    },

    /**
     * `POST /me/foods/label-scan`: the editable draft of a label photo, or why it cannot be read. 429
     * `ai_cap_reached`, 503 `ai_unavailable`, 413 `image_too_large` (spec 006 AC14–AC18).
     */
    scanLabel: (body: LabelScanRequest): Promise<LabelScanResponse> =>
      request('/me/foods/label-scan', LabelScanResponseSchema, { method: 'POST', json: body }),

    /**
     * `POST /me/food-log/drafts/text`: the editable draft of a typed or dictated meal, or why it gives
     * none. Needs a connection (never queued). 429 `ai_cap_reached`, 503 `ai_unavailable` (spec 007).
     */
    draftFromText: (body: MealTextDraftRequest): Promise<MealDraftResponse> =>
      request('/me/food-log/drafts/text', MealDraftResponseSchema, { method: 'POST', json: body }),

    /**
     * `POST /me/food-log/drafts/photo`: the editable draft of a plate photo, or why it gives none.
     * Needs a connection (never queued). 413 `image_too_large`, 429, 503 (spec 007).
     */
    draftFromPhoto: (body: MealPhotoDraftRequest): Promise<MealDraftResponse> =>
      request('/me/food-log/drafts/photo', MealDraftResponseSchema, { method: 'POST', json: body }),

    /**
     * `POST /me/food-log/feedback`: a few notes on one day (spec 008). Needs a connection (never
     * queued). 422 `feedback_unavailable` with `ed_soft_stop` or without numeric targets (AC2).
     */
    dailyFeedback: (body: DailyFeedbackRequest): Promise<DailyFeedbackResponse> =>
      request('/me/food-log/feedback', DailyFeedbackResponseSchema, { method: 'POST', json: body }),

    /** `GET /exercises`: the whole catalog and the user's own exercises, cached on the device (spec 009). */
    exerciseCatalog: (): Promise<ExerciseCatalogResponse> =>
      request('/exercises', ExerciseCatalogResponseSchema),

    /** `PUT /me/exercises/:id`: an exercise of the user's own under a client id; idempotent (spec 009). */
    saveCustomExercise: (
      id: string,
      body: CustomExerciseUpsertRequest,
    ): Promise<CustomExerciseSaveResponse> =>
      request(`/me/exercises/${id}`, CustomExerciseSaveResponseSchema, {
        method: 'PUT',
        json: body,
      }),

    /** `DELETE /me/exercises/:id`: succeeds when it does not exist; past sets keep their label. */
    deleteCustomExercise: (
      id: string,
      { recordedAt }: CustomExerciseDeleteQuery,
    ): Promise<CustomExerciseSaveResponse> =>
      request(
        `/me/exercises/${id}?recordedAt=${encodeURIComponent(recordedAt)}`,
        CustomExerciseSaveResponseSchema,
        { method: 'DELETE' },
      ),

    /** `GET /me/workouts`: the workouts of at most 62 days, newest first (spec 009). */
    listWorkouts: ({ from, to }: WorkoutLogQuery): Promise<WorkoutLogResponse> =>
      request(`/me/workouts?from=${from}&to=${to}`, WorkoutLogResponseSchema),

    /** `PUT /me/workouts/:id`: replaces the whole workout; the later `recordedAt` wins (spec 009 AC23). */
    saveWorkout: (id: string, body: WorkoutUpsertRequest): Promise<WorkoutSaveResponse> =>
      request(`/me/workouts/${id}`, WorkoutSaveResponseSchema, { method: 'PUT', json: body }),

    /**
     * `POST /me/workouts/drafts/text`: the editable draft of a typed or dictated workout, or why it
     * gives none (spec 012). 429 `ai_cap_reached`, 503 `ai_unavailable`.
     */
    draftWorkoutFromText: (body: WorkoutTextDraftRequest): Promise<WorkoutDraftResponse> =>
      request('/me/workouts/drafts/text', WorkoutDraftResponseSchema, {
        method: 'POST',
        json: body,
      }),

    /** `DELETE /me/workouts/:id`: succeeds when it does not exist; leaves a tombstone (AC19, AC23). */
    deleteWorkout: (id: string, { recordedAt }: WorkoutDeleteQuery): Promise<WorkoutSaveResponse> =>
      request(
        `/me/workouts/${id}?recordedAt=${encodeURIComponent(recordedAt)}`,
        WorkoutSaveResponseSchema,
        { method: 'DELETE' },
      ),

    /** `GET /me/exercises/stats`: last session, bests and last rest of each exercise done (AC7–AC10). */
    exerciseStats: (): Promise<ExerciseStatsResponse> =>
      request('/me/exercises/stats', ExerciseStatsResponseSchema),

    /** `GET /me/exercises/:id/history`: the last sessions and the bests of one exercise (AC15). */
    exerciseHistory: (id: string, limit?: number): Promise<ExerciseHistoryResponse> =>
      request(
        `/me/exercises/${id}/history${limit === undefined ? '' : `?limit=${limit}`}`,
        ExerciseHistoryResponseSchema,
      ),

    /**
     * `PUT /me/week`: the typical week and the activities with their days in one write; new targets
     * when the training load changed (spec 010 AC4). Needs a connection (never queued, AC21).
     */
    saveWeek: (body: WeekRequest): Promise<MeResponse> =>
      request('/me/week', MeResponseSchema, { method: 'PUT', json: body }),

    /** `PUT /me/training-profile`: the routine wizard's experience and equipment (spec 010 AC14). */
    saveTrainingProfile: (body: TrainingProfileUpdate): Promise<MeResponse> =>
      request('/me/training-profile', MeResponseSchema, { method: 'PUT', json: body }),

    /** `GET /me/program`: the active routine, or null (spec 010). */
    program: (): Promise<ProgramResponse> => request('/me/program', ProgramResponseSchema),

    /**
     * `PUT /me/program/:id`: replaces the routine; the later `recordedAt` wins (spec 010 AC22). 409
     * `program_exists` while another routine is active: delete it first (AC20).
     */
    saveProgram: (id: string, body: ProgramUpsertRequest): Promise<ProgramResponse> =>
      request(`/me/program/${id}`, ProgramResponseSchema, { method: 'PUT', json: body }),

    /** `DELETE /me/program/:id`: a tombstone; past workouts keep their sets (spec 010 AC20). */
    deleteProgram: (id: string, { recordedAt }: ProgramDeleteQuery): Promise<ProgramResponse> =>
      request(
        `/me/program/${id}?recordedAt=${encodeURIComponent(recordedAt)}`,
        ProgramResponseSchema,
        { method: 'DELETE' },
      ),

    /** `GET /me/export` (AC23). The caller turns it into a file (platform-specific). */
    exportData: (): Promise<ExportResponse> => request('/me/export', ExportResponseSchema),

    /** `DELETE /me` (AC24). The caller then signs out locally. */
    deleteAccount: async (): Promise<void> => {
      await send('/me', { method: 'DELETE' });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
