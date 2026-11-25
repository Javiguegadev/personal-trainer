/**
 * The weekly planner (spec 013): one cached plan from 27 days back to the end of the horizon (AC22), so
 * the week view, the day screens, Today and the Training tab all read and patch the same list, also
 * without a connection. Writes are optimistic bulk writes whose defaults are registered by key, so a
 * write queued offline is sent after a restart (the spec 005 pattern). Planned meals share the queue of
 * the food log and planned sessions the queue of the workouts: a planned row is always sent before the
 * log that points at it. "Done" is not stored here: a planned row is done while a log points at it, and
 * the log mutations already update the logs at once.
 */
import type {
  Locale,
  PlanMealChangesResponse,
  PlannedMealItem,
  PlannedWorkout,
  PlanResponse,
  PlanWorkoutChangesResponse,
} from '@pt/contracts';
import {
  planCacheRange,
  planChangeBatches,
  planMealRequest,
  planWorkoutRequest,
  type PlanBatch,
  type PlanChanges,
} from '@pt/core';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { isApiError, type ApiClient } from './client';
import { isRejected } from './weights';

export const planKeys = {
  /** The plan from 27 days back to the horizon (`PlanResponse`). One list for every screen. */
  plan: ['plan'] as const,
  /** The last plan write the API rejected, until the user dismisses it. */
  rejected: ['plan-rejected'] as const,
  /** Prefix of every plan mutation. */
  mutations: ['plan'] as const,
  saveMeals: ['plan', 'meal-items'] as const,
  saveWorkouts: ['plan', 'workouts'] as const,
};

/** One bulk write of planned items (at most 300 changes) and the locale of their snapshots. */
export interface SavePlanMealsVariables {
  locale: Locale;
  batch: PlanBatch<PlannedMealItem>;
}

/** One bulk write of planned sessions. */
export interface SavePlanWorkoutsVariables {
  locale: Locale;
  batch: PlanBatch<PlannedWorkout>;
}

/** A plan write the API refused: the optimistic change was undone. */
export interface RejectedPlanWrite {
  kind: 'meals' | 'workouts';
  /** `errors.<code>` in i18n. */
  code: string;
  fields: Readonly<Record<string, string>>;
}

const retry = (failureCount: number, error: unknown) => !isRejected(error) && failureCount < 2;

export function planQueryOptions(api: ApiClient, today: string) {
  return queryOptions({
    queryKey: planKeys.plan,
    queryFn: () => api.getPlan(planCacheRange(today)),
    retry,
  });
}

/**
 * The bulk writes of a change, in the order they are sent (deletes first, at most 300 changes each):
 * build the change with `@pt/core` (`plannedSessionFor`, `copyDay`, `fillWeekWithRoutine`…) and stamp an
 * undo with `stampChanges` at undo time.
 */
export function planWriteVariables(
  changes: PlanChanges,
  locale: Locale,
): { mealItems: SavePlanMealsVariables[]; workouts: SavePlanWorkoutsVariables[] } {
  const batches = planChangeBatches(changes);
  return {
    mealItems: batches.mealItems.map((batch) => ({ locale, batch })),
    workouts: batches.workouts.map((batch) => ({ locale, batch })),
  };
}

const MINUTES_PER_DAY = 1440;

const itemOrder = (a: PlannedMealItem, b: PlannedMealItem) =>
  a.localDate.localeCompare(b.localDate) || a.recordedAt.localeCompare(b.recordedAt);

/** As the API lists them: by day and start time, untimed last. */
const sessionOrder = (a: PlannedWorkout, b: PlannedWorkout) =>
  a.localDate.localeCompare(b.localDate) ||
  (a.startMinute ?? MINUTES_PER_DAY) - (b.startMinute ?? MINUTES_PER_DAY) ||
  a.recordedAt.localeCompare(b.recordedAt);

type Side = 'mealItems' | 'workouts';
type RowOf<S extends Side> = PlanResponse[S][number];

/** The plan with the rows of `ids` removed and `rows` put in their place, in the API's order. */
export function withPlanRows<S extends Side>(
  plan: PlanResponse,
  side: S,
  ids: ReadonlySet<string>,
  rows: readonly RowOf<S>[],
): PlanResponse {
  const kept = (plan[side] as RowOf<S>[]).filter((row) => !ids.has(row.id));
  const next = [...kept, ...rows];
  return side === 'mealItems'
    ? { ...plan, mealItems: (next as PlannedMealItem[]).sort(itemOrder) }
    : { ...plan, workouts: (next as PlannedWorkout[]).sort(sessionOrder) };
}

const EMPTY_PLAN: PlanResponse = { mealItems: [], workouts: [] };

const touchedIds = (batch: PlanBatch<{ id: string }>) =>
  new Set([...batch.upserts.map((r) => r.id), ...batch.deletes.map((d) => d.id)]);

function rejection(kind: RejectedPlanWrite['kind'], error: unknown): RejectedPlanWrite {
  return {
    kind,
    code: isApiError(error) ? error.code : 'internal_error',
    fields: isApiError(error) ? error.fields : {},
  };
}

/**
 * Registers the plan mutations on the query client. Call it once, before any persisted mutation is
 * resumed: a mutation restored from storage finds its function through its key.
 */
export function registerPlanMutations(queryClient: QueryClient, api: ApiClient): void {
  const shared = {
    retry: (_failureCount: number, error: unknown) => !isRejected(error),
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000),
  };

  /** With more writes queued, a refetch now would drop their optimistic rows for a moment. */
  const lastInQueue = () => queryClient.isMutating({ mutationKey: planKeys.mutations }) <= 1;

  const setRows = <S extends Side>(side: S, ids: ReadonlySet<string>, rows: RowOf<S>[]) =>
    queryClient.setQueryData<PlanResponse>(planKeys.plan, (plan = EMPTY_PLAN) =>
      withPlanRows(plan, side, ids, rows),
    );

  function defaults<S extends Side, R>(
    side: S,
    kind: RejectedPlanWrite['kind'],
    scope: string,
    send: (variables: { locale: Locale; batch: PlanBatch<RowOf<S>> }) => Promise<R>,
    stored: (response: R) => RowOf<S>[],
  ) {
    type Variables = { locale: Locale; batch: PlanBatch<RowOf<S>> };
    type Context = { previous: RowOf<S>[] };
    return {
      ...shared,
      // One write at a time with the logs of the same kind, in the order they were made.
      scope: { id: scope },
      mutationFn: send,
      onMutate: async ({ batch }: Variables): Promise<Context> => {
        // A plan request in flight would overwrite the optimistic rows with older data.
        await queryClient.cancelQueries({ queryKey: planKeys.plan });
        const ids = touchedIds(batch);
        const plan = queryClient.getQueryData<PlanResponse>(planKeys.plan);
        const previous = ((plan?.[side] ?? []) as RowOf<S>[]).filter((row) => ids.has(row.id));
        setRows(side, ids, batch.upserts);
        queryClient.setQueryData(planKeys.rejected, null);
        return { previous };
      },
      onError: (error: unknown, { batch }: Variables, context: Context | undefined) => {
        // Only a refusal gets here (the rest is retried): undo the whole write and say why.
        setRows(side, touchedIds(batch), context?.previous ?? []);
        queryClient.setQueryData(planKeys.rejected, rejection(kind, error));
      },
      onSuccess: (response: R, { batch }: Variables) => {
        // The stored rows can differ from the ones sent: a later write or delete from another device
        // wins (AC23), and then the row is missing from the answer.
        setRows(side, new Set(batch.upserts.map((r) => r.id)), stored(response));
      },
      onSettled: async () => {
        if (!lastInQueue()) return;
        await queryClient.invalidateQueries({ queryKey: planKeys.plan });
      },
    };
  }

  queryClient.setMutationDefaults(
    planKeys.saveMeals,
    defaults(
      'mealItems',
      'meals',
      'food-log',
      ({ locale, batch }) => api.savePlanMealChanges(planMealRequest(batch, locale)),
      (response: PlanMealChangesResponse) => response.mealItems,
    ),
  );

  queryClient.setMutationDefaults(
    planKeys.saveWorkouts,
    defaults(
      'workouts',
      'workouts',
      'training',
      ({ locale, batch }) => api.savePlanWorkoutChanges(planWorkoutRequest(batch, locale)),
      (response: PlanWorkoutChangesResponse) => response.workouts,
    ),
  );
}

/** Removes the notice of a rejected plan write once the user has seen it. */
export function dismissRejectedPlanWrite(queryClient: QueryClient): void {
  queryClient.setQueryData(planKeys.rejected, null);
}
