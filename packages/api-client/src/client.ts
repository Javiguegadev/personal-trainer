import {
  ApiErrorSchema,
  CustomFoodsResponseSchema,
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
  RecentFoodsResponseSchema,
  TargetsPreviewResponseSchema,
  WeightListResponseSchema,
  WeightSaveResponseSchema,
  type ApiErrorCode,
  type ConsentRequest,
  type CustomFoodUpsertRequest,
  type CustomFoodsResponse,
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

    /** `GET /me/export` (AC23). The caller turns it into a file (platform-specific). */
    exportData: (): Promise<ExportResponse> => request('/me/export', ExportResponseSchema),

    /** `DELETE /me` (AC24). The caller then signs out locally. */
    deleteAccount: async (): Promise<void> => {
      await send('/me', { method: 'DELETE' });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
