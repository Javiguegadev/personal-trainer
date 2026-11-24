/**
 * The daily check-in (spec 011): one cached list for every screen (Today, the check-in sheet, the
 * live session, the week view and the day screen), optimistic writes, and mutation defaults
 * registered by key so a write queued offline is sent after a restart (AC14).
 */
import type { CheckinSaveResponse, CheckinUpsertRequest, DailyCheckin } from '@pt/contracts';
import { WEEK_VIEW, addDays, weekStartOf } from '@pt/core';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { isApiError, type ApiClient } from './client';
import { isRejected } from './weights';

export const checkinKeys = {
  /** The check-ins the week view can show (12 weeks back to today), oldest first. */
  list: ['checkins'] as const,
  /** The last write the API rejected, until the user dismisses it. */
  rejected: ['checkin-rejected'] as const,
  /** Prefix of both mutations. */
  mutations: ['checkins'] as const,
  save: ['checkins', 'save'] as const,
  remove: ['checkins', 'remove'] as const,
};

/**
 * The days the list holds: from the Monday 12 weeks back (the oldest week the week view shows) to
 * today. At most 90 days, under the API's 92. It covers the 28 days the usual sleep and the pattern
 * notice read.
 */
export function checkinRange(today: string): { from: string; to: string } {
  return { from: addDays(weekStartOf(today), -WEEK_VIEW.weeksBack * 7), to: today };
}

export type SaveCheckinVariables = CheckinUpsertRequest & { localDate: string };

export interface DeleteCheckinVariables {
  localDate: string;
  /** Device time of the delete: an older write cannot bring the check-in back (AC15). */
  recordedAt: string;
  today: string;
}

/** A write the API refused: the optimistic change was undone. */
export interface RejectedCheckinWrite {
  localDate: string;
  /** `errors.<code>` in i18n. */
  code: string;
  fields: Readonly<Record<string, string>>;
}

interface CheckinMutationContext {
  /** The check-in of that day before the optimistic change. */
  previous: DailyCheckin | null;
}

/** The list with the check-in of `localDate` replaced by `checkin`, or removed when it is null. */
export function withCheckinDay(
  checkins: readonly DailyCheckin[],
  localDate: string,
  checkin: DailyCheckin | null,
): DailyCheckin[] {
  const others = checkins.filter((c) => c.localDate !== localDate);
  if (!checkin) return others;
  return [...others, checkin].sort((a, b) => a.localDate.localeCompare(b.localDate));
}

/** The check-in a save stores, shown at once (the API answers with the same, or a newer one). */
export function optimisticCheckin(variables: SaveCheckinVariables): DailyCheckin {
  return {
    localDate: variables.localDate,
    sleepMinutes: variables.sleepMinutes,
    stress: variables.stress,
    workShift: variables.workShift,
    shiftStartMinute: variables.shiftStartMinute,
    shiftEndMinute: variables.shiftEndMinute,
    source: 'manual',
    recordedAt: variables.recordedAt,
  };
}

export function checkinsQueryOptions(api: ApiClient, today: string) {
  return queryOptions({
    queryKey: checkinKeys.list,
    queryFn: async () => (await api.listCheckins(checkinRange(today))).checkins,
    retry: (failureCount: number, error: unknown) => !isRejected(error) && failureCount < 2,
  });
}

/**
 * Registers the two check-in mutations on the query client. Call it once, before any persisted
 * mutation is resumed: a mutation restored from storage finds its function through its key.
 */
export function registerCheckinMutations(queryClient: QueryClient, api: ApiClient): void {
  const setDay = (localDate: string, checkin: DailyCheckin | null) =>
    queryClient.setQueryData<DailyCheckin[]>(checkinKeys.list, (checkins = []) =>
      withCheckinDay(checkins, localDate, checkin),
    );

  const onMutate = async (
    localDate: string,
    checkin: DailyCheckin | null,
  ): Promise<CheckinMutationContext> => {
    // A list request in flight would overwrite the optimistic check-in with older data.
    await queryClient.cancelQueries({ queryKey: checkinKeys.list });
    const previous =
      queryClient
        .getQueryData<DailyCheckin[]>(checkinKeys.list)
        ?.find((c) => c.localDate === localDate) ?? null;
    setDay(localDate, checkin);
    queryClient.setQueryData(checkinKeys.rejected, null);
    return { previous };
  };

  const shared = {
    // One write at a time, in the order they were made (spec 005 queue, its own scope).
    scope: { id: 'checkin' },
    retry: (_failureCount: number, error: unknown) => !isRejected(error),
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000),
    onError: (
      error: unknown,
      variables: { localDate: string },
      context: CheckinMutationContext | undefined,
    ) => {
      // Only a refusal gets here (the rest is retried): undo the optimistic change and say why.
      setDay(variables.localDate, context?.previous ?? null);
      const rejected: RejectedCheckinWrite = {
        localDate: variables.localDate,
        code: isApiError(error) ? error.code : 'internal_error',
        fields: isApiError(error) ? error.fields : {},
      };
      queryClient.setQueryData(checkinKeys.rejected, rejected);
    },
    onSuccess: (data: CheckinSaveResponse, variables: { localDate: string }) => {
      // The stored check-in can differ from the one sent: a later write from another device wins.
      setDay(variables.localDate, data.checkin);
    },
    onSettled: async () => {
      // With more writes queued, a refetch now would drop their optimistic check-ins for a moment.
      if (queryClient.isMutating({ mutationKey: checkinKeys.mutations }) > 1) return;
      await queryClient.invalidateQueries({ queryKey: checkinKeys.list });
    },
  };

  queryClient.setMutationDefaults(checkinKeys.save, {
    ...shared,
    mutationFn: ({ localDate, ...body }: SaveCheckinVariables) => api.saveCheckin(localDate, body),
    onMutate: (variables: SaveCheckinVariables) =>
      onMutate(variables.localDate, optimisticCheckin(variables)),
  });
  queryClient.setMutationDefaults(checkinKeys.remove, {
    ...shared,
    mutationFn: ({ localDate, recordedAt, today }: DeleteCheckinVariables) =>
      api.deleteCheckin(localDate, { recordedAt, today }),
    onMutate: ({ localDate }: DeleteCheckinVariables) => onMutate(localDate, null),
  });
}

/** Removes the notice of a rejected write once the user has seen it. */
export function dismissCheckinRejection(queryClient: QueryClient): void {
  queryClient.setQueryData(checkinKeys.rejected, null);
}
