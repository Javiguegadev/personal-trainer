/**
 * TanStack Query bindings. Query options are plain factories (testable without React);
 * `createApiHooks(api)` binds them to one client so every screen and platform reuses them.
 */
import type {
  ConsentRequest,
  Food,
  LabelScanRequest,
  MealPhotoDraftRequest,
  MealTextDraftRequest,
  Locale,
  MealItemSaveResponse,
  MeResponse,
  ProfileInput,
  TargetsChange,
  WeightSaveResponse,
} from '@pt/contracts';
import {
  keepPreviousData,
  skipToken,
  queryOptions,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { isApiError, type ApiClient } from './client';
import {
  cachedFoodByBarcode,
  customFoodsQueryOptions,
  dismissRejectedFoodWrite,
  favouriteFoodsQueryOptions,
  foodByBarcodeQueryOptions,
  foodKeys,
  foodLogQueryOptions,
  foodQueryOptions,
  foodSearchQueryOptions,
  foodSourcesQueryOptions,
  recentFoodsQueryOptions,
  type DeleteCustomFoodVariables,
  type DeleteMealItemVariables,
  type FavouriteFoodVariables,
  type RejectedFoodWrite,
  type SaveCustomFoodVariables,
  type SaveMealItemVariables,
} from './foods';
import {
  dismissWeightNotice,
  weightKeys,
  weightsQueryOptions,
  type DeleteWeightVariables,
  type RejectedWeightWrite,
  type SaveWeightVariables,
} from './weights';

export const queryKeys = {
  me: ['me'] as const,
  targetsPreview: (input: ProfileInput | null) => ['onboarding', 'targets-preview', input] as const,
};

/** Do not retry errors the user (or a new session) must fix; retry transient ones twice. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status < 500) return false;
  return failureCount < 2;
}

export function meQueryOptions(api: ApiClient) {
  return queryOptions({ queryKey: queryKeys.me, queryFn: () => api.me(), retry: shouldRetry });
}

/** Preview recomputed whenever the summary fields change; nothing is stored. `null` = incomplete (disabled). */
export function targetsPreviewQueryOptions(api: ApiClient, input: ProfileInput | null) {
  return queryOptions({
    queryKey: queryKeys.targetsPreview(input),
    queryFn: input ? () => api.targetsPreview(input) : skipToken,
    retry: shouldRetry,
    placeholderData: keepPreviousData,
    // The preview depends only on the input: never refetch it on its own. A refetch of a failed query
    // would also clear its error (e.g. 422 age_blocked) while it runs, making the UI flicker.
    staleTime: Infinity,
    retryOnMount: false,
    refetchOnWindowFocus: false,
  });
}

/** After consent the `/me` status changes: refetch it so the root guard moves on. */
export async function afterConsent(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.me });
}

/** `PUT /me/profile` returns the new `/me`: write it to the cache instead of refetching. */
export function afterProfileSaved(queryClient: QueryClient, me: MeResponse): void {
  queryClient.setQueryData(queryKeys.me, me);
}

/** After deleting the account nothing cached may survive (AC24). */
export function afterAccountDeleted(queryClient: QueryClient): void {
  queryClient.clear();
}

/** What `useMealDraft` sends: a sentence or a plate photo. */
export type MealDraftInput =
  { kind: 'text'; body: MealTextDraftRequest } | { kind: 'photo'; body: MealPhotoDraftRequest };

export function createApiHooks(api: ApiClient) {
  return {
    useMe: (options: { enabled?: boolean } = {}) =>
      useQuery({ ...meQueryOptions(api), enabled: options.enabled ?? true }),

    /** Pass `null` while the profile is incomplete. */
    useTargetsPreview: (input: ProfileInput | null) =>
      useQuery(targetsPreviewQueryOptions(api, input)),

    useGrantConsent: () => {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: (body: ConsentRequest) => api.grantConsent(body),
        onSuccess: () => afterConsent(queryClient),
      });
    },

    useUpdateProfile: () => {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: (body: ProfileInput) => api.updateProfile(body),
        onSuccess: (me) => afterProfileSaved(queryClient, me),
      });
    },

    /** The weight log of the last year, oldest first (spec 003). */
    useWeights: (today: string, options: { enabled?: boolean } = {}) =>
      useQuery({ ...weightsQueryOptions(api, today), enabled: options.enabled ?? true }),

    /**
     * Optimistic and offline-safe: the function comes from the defaults registered with
     * `registerWeightMutations`, found by key, so a queued write survives a restart (AC18).
     */
    useSaveWeight: () =>
      useMutation<WeightSaveResponse, unknown, SaveWeightVariables>({
        mutationKey: weightKeys.save,
      }),

    useDeleteWeight: () =>
      useMutation<WeightSaveResponse, unknown, DeleteWeightVariables>({
        mutationKey: weightKeys.remove,
      }),

    /** Days with a write that has not reached the server yet (AC18). */
    usePendingWeightDates: (): string[] =>
      useMutationState({
        filters: { mutationKey: weightKeys.mutations, status: 'pending' },
        select: (mutation) => (mutation.state.variables as { localDate: string }).localDate,
      }),

    /** The last targets change caused by a weight write, and how to dismiss it (AC11). */
    useWeightTargetsChange: () => {
      const queryClient = useQueryClient();
      const { data } = useQuery<TargetsChange | null>({
        queryKey: weightKeys.targetsChange,
        queryFn: () => null,
        enabled: false,
        initialData: null,
      });
      return {
        change: data,
        dismiss: () => dismissWeightNotice(queryClient, weightKeys.targetsChange),
      };
    },

    /** The last write the API rejected, and how to dismiss it (AC21). */
    useRejectedWeightWrite: () => {
      const queryClient = useQueryClient();
      const { data } = useQuery<RejectedWeightWrite | null>({
        queryKey: weightKeys.rejected,
        queryFn: () => null,
        enabled: false,
        initialData: null,
      });
      return {
        rejected: data,
        dismiss: () => dismissWeightNotice(queryClient, weightKeys.rejected),
      };
    },

    /** The food log of the last 8 days (spec 005 AC15, AC13). */
    useFoodLog: (today: string, options: { enabled?: boolean } = {}) =>
      useQuery({ ...foodLogQueryOptions(api, today), enabled: options.enabled ?? true }),

    /** Debounce `q` in the screen. Offline, the query is paused (`fetchStatus: 'paused'`, AC6). */
    useFoodSearch: (q: string, locale: Locale) => useQuery(foodSearchQueryOptions(api, q, locale)),

    /** Pass `null` while no food is selected. */
    useFood: (foodId: string | null, locale: Locale) =>
      useQuery(foodQueryOptions(api, foodId, locale)),

    useFoodSources: (locale: Locale) => useQuery(foodSourcesQueryOptions(api, locale)),

    useRecentFoods: (locale: Locale) => useQuery(recentFoodsQueryOptions(api, locale)),

    useFavouriteFoods: (locale: Locale) => useQuery(favouriteFoodsQueryOptions(api, locale)),

    /**
     * Optimistic and offline-safe, like the weight log: the functions come from the defaults registered
     * with `registerFoodMutations`, found by key (AC19). Build the variables with `saveItemVariables`.
     */
    useSaveMealItem: () =>
      useMutation<MealItemSaveResponse, unknown, SaveMealItemVariables>({
        mutationKey: foodKeys.saveItem,
      }),

    useDeleteMealItem: () =>
      useMutation<MealItemSaveResponse, unknown, DeleteMealItemVariables>({
        mutationKey: foodKeys.deleteItem,
      }),

    useSetFavouriteFood: () =>
      useMutation<void, unknown, FavouriteFoodVariables>({ mutationKey: foodKeys.favourite }),

    /** The user's own foods, most recently changed first (spec 006 AC12). */
    useCustomFoods: (locale: Locale) => useQuery(customFoodsQueryOptions(api, locale)),

    /**
     * Optimistic and offline-safe, in the queue of the food log: a food created without a connection is
     * sent before its first item (spec 006 AC11). Registered with `registerCustomFoodMutations`.
     */
    useSaveCustomFood: () =>
      useMutation<Food, unknown, SaveCustomFoodVariables>({ mutationKey: foodKeys.saveFood }),

    useDeleteCustomFood: () =>
      useMutation<void, unknown, DeleteCustomFoodVariables>({ mutationKey: foodKeys.deleteFood }),

    /**
     * The food of a barcode (spec 006): `cached` looks among the foods the device already holds, which
     * also works without a connection (AC8); `fetch` asks the API once per code (AC3) and rejects with
     * the API error (`product_not_found`, `product_incomplete`, `lookup_unavailable`, `rate_limited`).
     */
    useBarcodeLookup: () => {
      const queryClient = useQueryClient();
      return {
        cached: (barcode: string, locale: Locale) =>
          cachedFoodByBarcode(queryClient, barcode, locale),
        fetch: (barcode: string, locale: Locale) =>
          queryClient.fetchQuery(foodByBarcodeQueryOptions(api, barcode, locale)),
      };
    },

    /** Reads a label photo into an editable draft (spec 006 AC14). Not retried: every call is metered. */
    useScanLabel: () =>
      useMutation({ mutationFn: (body: LabelScanRequest) => api.scanLabel(body), retry: false }),

    /**
     * The draft of a plate photo or a sentence (spec 007). Never retried and never queued: it needs a
     * connection and costs a call to the model.
     */
    useMealDraft: () =>
      useMutation({
        mutationFn: (input: MealDraftInput) =>
          input.kind === 'photo' ? api.draftFromPhoto(input.body) : api.draftFromText(input.body),
        retry: false,
      }),

    /** Items with a write that has not reached the server yet ("waiting to sync", AC19). */
    usePendingMealItemIds: (): string[] =>
      useMutationState({
        filters: { mutationKey: foodKeys.mutations, status: 'pending' },
        select: (mutation) => {
          const variables = mutation.state.variables as { id?: string; food?: { id: string } };
          return variables.id ?? variables.food?.id ?? '';
        },
      }),

    /** The last food-log write the API rejected, and how to dismiss it (AC21). */
    useRejectedFoodWrite: () => {
      const queryClient = useQueryClient();
      const { data } = useQuery<RejectedFoodWrite | null>({
        queryKey: foodKeys.rejected,
        queryFn: () => null,
        enabled: false,
        initialData: null,
      });
      return { rejected: data, dismiss: () => dismissRejectedFoodWrite(queryClient) };
    },

    useExportData: () => useMutation({ mutationFn: () => api.exportData() }),

    useDeleteAccount: () => {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: () => api.deleteAccount(),
        onSuccess: () => afterAccountDeleted(queryClient),
      });
    },
  };
}

export type ApiHooks = ReturnType<typeof createApiHooks>;
