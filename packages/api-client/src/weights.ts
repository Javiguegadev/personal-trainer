/**
 * The weight log (spec 003): one cached list, optimistic writes, and mutation defaults registered by key
 * so a write queued offline can be sent after the app was closed and opened again (AC18–AC21).
 */
import { WEIGHT_LIMITS, type WeightEntry, type WeightSaveResponse } from '@pt/contracts';
import { addDays } from '@pt/core';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { isApiError, type ApiClient } from './client';

export const weightKeys = {
  /** The entries of the last year, oldest first. One list for every screen, so optimistic writes hit it. */
  list: ['weights'] as const,
  /** The last targets change caused by a weight write, until the user dismisses it (AC11). */
  targetsChange: ['weight-targets-change'] as const,
  /** The last write the API rejected, until the user dismisses it (AC21). */
  rejected: ['weight-rejected'] as const,
  /** Prefix of both mutations. */
  mutations: ['weights'] as const,
  save: ['weights', 'save'] as const,
  remove: ['weights', 'remove'] as const,
};

export interface SaveWeightVariables {
  localDate: string;
  weightKg: number;
  /** Device time of the write. */
  recordedAt: string;
  today: string;
}

export interface DeleteWeightVariables {
  localDate: string;
  today: string;
}

/** A write the API refused: the optimistic change was undone (AC21). */
export interface RejectedWeightWrite {
  localDate: string;
  /** `errors.<code>` in i18n. */
  code: string;
  fields: Readonly<Record<string, string>>;
}

interface WeightMutationContext {
  /** The entry of that day before the optimistic change. */
  previous: WeightEntry | null;
}

/** The list with the entry of `localDate` replaced by `entry`, or removed when it is null. */
export function withWeightDay(
  entries: readonly WeightEntry[],
  localDate: string,
  entry: WeightEntry | null,
): WeightEntry[] {
  const others = entries.filter((e) => e.localDate !== localDate);
  if (!entry) return others;
  return [...others, entry].sort((a, b) => (a.localDate < b.localDate ? -1 : 1));
}

export function weightsQueryOptions(api: ApiClient, today: string) {
  return queryOptions({
    queryKey: weightKeys.list,
    queryFn: async () => {
      const from = addDays(today, -(WEIGHT_LIMITS.listDaysMax - 1));
      return (await api.listWeights({ from, to: today })).entries;
    },
    retry: (failureCount: number, error: unknown) => !isRejected(error) && failureCount < 2,
  });
}

/** 4xx: the API refused the request, sending it again cannot work. Network errors and 5xx are retried. */
function isRejected(error: unknown): boolean {
  return isApiError(error) && error.status < 500;
}

/**
 * Registers the two weight mutations on the query client. Call it once, before any persisted mutation
 * is resumed: a mutation restored from storage finds its function through its key.
 */
export function registerWeightMutations(queryClient: QueryClient, api: ApiClient): void {
  const setDay = (localDate: string, entry: WeightEntry | null) =>
    queryClient.setQueryData<WeightEntry[]>(weightKeys.list, (entries = []) =>
      withWeightDay(entries, localDate, entry),
    );

  const onMutate = async (localDate: string, entry: WeightEntry | null) => {
    // A list request in flight would overwrite the optimistic entry with older data.
    await queryClient.cancelQueries({ queryKey: weightKeys.list });
    const previous =
      queryClient
        .getQueryData<WeightEntry[]>(weightKeys.list)
        ?.find((e) => e.localDate === localDate) ?? null;
    setDay(localDate, entry);
    queryClient.setQueryData(weightKeys.rejected, null);
    return { previous };
  };

  const shared = {
    // One write at a time, in the order they were made.
    scope: { id: 'weights' },
    retry: (_failureCount: number, error: unknown) => !isRejected(error),
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000),
    onError: (
      error: unknown,
      variables: { localDate: string },
      context: WeightMutationContext | undefined,
    ) => {
      // Only a refusal gets here (the rest is retried): undo the optimistic change and say why.
      setDay(variables.localDate, context?.previous ?? null);
      const rejected: RejectedWeightWrite = {
        localDate: variables.localDate,
        code: isApiError(error) ? error.code : 'internal_error',
        fields: isApiError(error) ? error.fields : {},
      };
      queryClient.setQueryData(weightKeys.rejected, rejected);
    },
    onSuccess: (data: WeightSaveResponse, variables: { localDate: string }) => {
      // The stored entry can differ from the one sent: a later write from another device wins (AC20).
      setDay(variables.localDate, data.entry);
      if (data.targetsChange)
        queryClient.setQueryData(weightKeys.targetsChange, data.targetsChange);
    },
    onSettled: async () => {
      // With more writes queued, a refetch now would drop their optimistic entries for a moment.
      if (queryClient.isMutating({ mutationKey: weightKeys.mutations }) > 1) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: weightKeys.list }),
        // The profile weight and the targets may have changed (AC10).
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ]);
    },
  };

  queryClient.setMutationDefaults(weightKeys.save, {
    ...shared,
    mutationFn: ({ localDate, ...body }: SaveWeightVariables) => api.saveWeight(localDate, body),
    onMutate: ({ localDate, weightKg, recordedAt }: SaveWeightVariables) =>
      onMutate(localDate, { localDate, weightKg, recordedAt }),
  });
  queryClient.setMutationDefaults(weightKeys.remove, {
    ...shared,
    mutationFn: ({ localDate, today }: DeleteWeightVariables) =>
      api.deleteWeight(localDate, { today }),
    onMutate: ({ localDate }: DeleteWeightVariables) => onMutate(localDate, null),
  });
}

/** Removes the notice of a targets change or of a rejected write once the user has seen it. */
export function dismissWeightNotice(
  queryClient: QueryClient,
  key: typeof weightKeys.targetsChange | typeof weightKeys.rejected,
): void {
  queryClient.setQueryData(key, null);
}
