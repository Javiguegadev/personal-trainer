/**
 * TanStack Query bindings. Query options are plain factories (testable without React);
 * `createApiHooks(api)` binds them to one client so every screen and platform reuses them.
 */
import type {
  CheckinSaveResponse,
  ConsentRequest,
  CustomExerciseSaveResponse,
  WorkoutSaveResponse,
  DailyFeedbackRequest,
  DailyFeedbackResponse,
  Food,
  LabelScanRequest,
  MealPhotoDraftRequest,
  MealTextDraftRequest,
  WorkoutTextDraftRequest,
  Locale,
  MealItemSaveResponse,
  MeResponse,
  ProfileInput,
  ProgramResponse,
  TargetsChange,
  WeekRequest,
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
import { feedbackKeys, writeTouchesDay } from './feedback';
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
  dismissRejectedTrainingWrite,
  exerciseCatalogQueryOptions,
  exerciseHistoryQueryOptions,
  exerciseStatsQueryOptions,
  programQueryOptions,
  trainingKeys,
  workoutsQueryOptions,
  type DeleteCustomExerciseVariables,
  type DeleteProgramVariables,
  type DeleteWorkoutVariables,
  type RejectedTrainingWrite,
  type SaveCustomExerciseVariables,
  type SaveProgramVariables,
  type SaveTrainingProfileVariables,
  type SaveWorkoutVariables,
} from './training';
import { meKey } from './keys';
import { weekLogQueryOptions, type WeekSaveResult } from './week';
import {
  dismissWeightNotice,
  weightKeys,
  weightsQueryOptions,
  type DeleteWeightVariables,
  type RejectedWeightWrite,
  type SaveWeightVariables,
} from './weights';
import {
  checkinKeys,
  checkinsQueryOptions,
  dismissCheckinRejection,
  type DeleteCheckinVariables,
  type RejectedCheckinWrite,
  type SaveCheckinVariables,
} from './checkins';

export const queryKeys = {
  me: meKey,
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

    /** The check-ins from 12 weeks back to today, oldest first (spec 011). Cached offline. */
    useCheckins: (today: string, options: { enabled?: boolean } = {}) =>
      useQuery({ ...checkinsQueryOptions(api, today), enabled: options.enabled ?? true }),

    /**
     * Optimistic and offline-safe (AC14): the functions come from the defaults registered with
     * `registerCheckinMutations`, found by key, so a queued write survives a restart.
     */
    useSaveCheckin: () =>
      useMutation<CheckinSaveResponse, unknown, SaveCheckinVariables>({
        mutationKey: checkinKeys.save,
      }),

    useDeleteCheckin: () =>
      useMutation<CheckinSaveResponse, unknown, DeleteCheckinVariables>({
        mutationKey: checkinKeys.remove,
      }),

    /** Days with a check-in write that has not reached the server yet (AC14). */
    usePendingCheckinDates: (): string[] =>
      useMutationState({
        filters: { mutationKey: checkinKeys.mutations, status: 'pending' },
        select: (mutation) => (mutation.state.variables as { localDate: string }).localDate,
      }),

    /** The last check-in write the API rejected, and how to dismiss it. */
    useRejectedCheckinWrite: () => {
      const queryClient = useQueryClient();
      const { data } = useQuery<RejectedCheckinWrite | null>({
        queryKey: checkinKeys.rejected,
        queryFn: () => null,
        enabled: false,
        initialData: null,
      });
      return { rejected: data, dismiss: () => dismissCheckinRejection(queryClient) };
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

    /**
     * The draft of a workout sentence (spec 012). Never retried and never queued: it needs a connection
     * and costs a call to the model. Saving the draft is an ordinary `useSaveWorkout`.
     */
    useWorkoutDraft: () =>
      useMutation({
        mutationFn: (body: WorkoutTextDraftRequest) => api.draftWorkoutFromText(body),
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

    /**
     * The daily feedback of `localDate` (spec 008): the last one asked for, kept in the query cache,
     * and how to ask for it (again). Needs a connection: it is never queued.
     */
    useDailyFeedback: (localDate: string) => {
      const queryClient = useQueryClient();
      const { data } = useQuery<DailyFeedbackResponse | null>({
        queryKey: feedbackKeys.day(localDate),
        queryFn: () => null,
        enabled: false,
        initialData: null,
        gcTime: 24 * 60 * 60 * 1000,
      });
      const ask = useMutation({
        mutationFn: (body: DailyFeedbackRequest) => api.dailyFeedback(body),
        // Never paused and replayed later: offline the button is disabled.
        networkMode: 'always',
        retry: false,
        onSuccess: (feedback) =>
          queryClient.setQueryData(feedbackKeys.day(feedback.localDate), feedback),
      });
      return { feedback: data, ask };
    },

    /** A food-log write of `localDate` has not reached the server yet (spec 008 AC3). */
    useFoodLogSyncing: (localDate: string): boolean =>
      useMutationState({
        filters: {
          mutationKey: foodKeys.mutations,
          status: 'pending',
          predicate: (mutation) => writeTouchesDay(mutation, localDate),
        },
      }).length > 0,

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

    /** The exercise catalog and the user's own exercises, kept offline (spec 009 AC3, AC22). */
    useExerciseCatalog: (options: { enabled?: boolean } = {}) =>
      useQuery({ ...exerciseCatalogQueryOptions(api), enabled: options.enabled ?? true }),

    /** The workouts of the last 60 days, newest first (spec 009 AC20, AC22). */
    useWorkouts: (today: string, options: { enabled?: boolean } = {}) =>
      useQuery({ ...workoutsQueryOptions(api, today), enabled: options.enabled ?? true }),

    /** Last session, bests and last rest of every exercise done, kept offline (AC7, AC9, AC10). */
    useExerciseStats: (options: { enabled?: boolean } = {}) =>
      useQuery({ ...exerciseStatsQueryOptions(api), enabled: options.enabled ?? true }),

    /** Pass `null` while no exercise is open (AC15). */
    useExerciseHistory: (exerciseId: string | null, limit?: number) =>
      useQuery(exerciseHistoryQueryOptions(api, exerciseId, limit)),

    /**
     * Optimistic and offline-safe: the functions come from the defaults registered with
     * `registerTrainingMutations`, found by key (AC22). Build the variables with `saveWorkoutVariables`.
     */
    useSaveWorkout: () =>
      useMutation<WorkoutSaveResponse, unknown, SaveWorkoutVariables>({
        mutationKey: trainingKeys.saveWorkout,
      }),

    useDeleteWorkout: () =>
      useMutation<WorkoutSaveResponse, unknown, DeleteWorkoutVariables>({
        mutationKey: trainingKeys.deleteWorkout,
      }),

    useSaveCustomExercise: () =>
      useMutation<CustomExerciseSaveResponse, unknown, SaveCustomExerciseVariables>({
        mutationKey: trainingKeys.saveExercise,
      }),

    useDeleteCustomExercise: () =>
      useMutation<CustomExerciseSaveResponse, unknown, DeleteCustomExerciseVariables>({
        mutationKey: trainingKeys.deleteExercise,
      }),

    /** Workouts and exercises with a write that has not reached the server yet (AC22). */
    usePendingTrainingIds: (): string[] =>
      useMutationState({
        filters: { mutationKey: trainingKeys.mutations, status: 'pending' },
        select: (mutation) => (mutation.state.variables as { id: string }).id,
      }),

    /** The last training write the API rejected, and how to dismiss it (AC23). */
    useRejectedTrainingWrite: () => {
      const queryClient = useQueryClient();
      const { data } = useQuery<RejectedTrainingWrite | null>({
        queryKey: trainingKeys.rejected,
        queryFn: () => null,
        enabled: false,
        initialData: null,
      });
      return { rejected: data, dismiss: () => dismissRejectedTrainingWrite(queryClient) };
    },

    /** The active routine, or null; kept offline (spec 010 AC21). */
    useProgram: (options: { enabled?: boolean } = {}) =>
      useQuery({ ...programQueryOptions(api), enabled: options.enabled ?? true }),

    /**
     * Optimistic and offline-safe, in the queue of the workouts (spec 010 AC21). Build the variables
     * with `saveProgramVariables`. "Cambiar de rutina" deletes the old one first (AC20).
     */
    useSaveProgram: () =>
      useMutation<ProgramResponse, unknown, SaveProgramVariables>({
        mutationKey: trainingKeys.saveProgram,
      }),

    useDeleteProgram: () =>
      useMutation<ProgramResponse, unknown, DeleteProgramVariables>({
        mutationKey: trainingKeys.deleteProgram,
      }),

    /** The wizard's experience and equipment (spec 010 AC14); queued, so the wizard works offline. */
    useSaveTrainingProfile: () =>
      useMutation<MeResponse, unknown, SaveTrainingProfileVariables>({
        mutationKey: trainingKeys.saveTrainingProfile,
      }),

    /**
     * The meals and workouts of the week starting on `monday` (spec 010 AC8, AC10). A week visited
     * before stays cached; offline, an unvisited one is paused with no data.
     */
    useWeekLog: (monday: string, options: { enabled?: boolean } = {}) =>
      useQuery({ ...weekLogQueryOptions(api, monday), enabled: options.enabled ?? true }),

    /**
     * "Guardar" on "Mi semana" (spec 010 AC4). Needs a connection (AC21): never paused and replayed,
     * never retried; the screen keeps the edits on an error. `weekTargetsChange(result)` gives the old
     * and new targets for the notice when the training load changed them.
     */
    useSaveWeek: () => {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: async (body: WeekRequest): Promise<WeekSaveResult> => {
          const previousTargets =
            queryClient.getQueryData<MeResponse>(queryKeys.me)?.targets ?? null;
          return { me: await api.saveWeek(body), previousTargets };
        },
        networkMode: 'always',
        retry: false,
        onSuccess: ({ me }) => afterProfileSaved(queryClient, me),
      });
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
