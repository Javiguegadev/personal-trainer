/**
 * TanStack Query bindings. Query options are plain factories (testable without React);
 * `createApiHooks(api)` binds them to one client so every screen and platform reuses them.
 */
import type {
  ConsentRequest,
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
