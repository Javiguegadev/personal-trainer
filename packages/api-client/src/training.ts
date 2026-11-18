/**
 * Exercise catalog and workout log (spec 009): the catalog, the last 60 days of workouts and the exercise
 * stats are cached for the gym without coverage (AC22); writes are optimistic and their mutation defaults
 * are registered by key, so a write queued offline is sent after a restart (the spec 005 pattern). Custom
 * exercises share the queue of the workouts, so a new exercise is sent before the first session using it.
 */
import {
  WORKOUT_LIMITS,
  type CustomExerciseSaveResponse,
  type CustomExerciseUpsertRequest,
  type Exercise,
  type ExerciseCatalogResponse,
  type ExerciseStats,
  type Workout,
  type WorkoutSaveResponse,
  type WorkoutUpsertRequest,
} from '@pt/contracts';
import {
  addDays,
  customExercise,
  statsWithWorkout,
  workoutFromRequest,
  type LoggableExercise,
} from '@pt/core';
import { queryOptions, skipToken, type QueryClient } from '@tanstack/react-query';
import { isApiError, type ApiClient } from './client';
import { isRejected } from './weights';

export const trainingKeys = {
  /** The catalog and the user's own exercises (`ExerciseCatalogResponse`). */
  catalog: ['exercise-catalog'] as const,
  /** The workouts of the last `WORKOUT_LIMITS.cacheDays` days, newest first. */
  log: ['workouts'] as const,
  /** Last session, bests and last rest of every exercise done. */
  stats: ['exercise-stats'] as const,
  /** Prefix of the history of every exercise. */
  historyAll: ['exercise-history'] as const,
  history: (exerciseId: string, limit: number) => ['exercise-history', exerciseId, limit] as const,
  /** The last write the API rejected, until the user dismisses it (AC23). */
  rejected: ['training-rejected'] as const,
  /** Prefix of every training mutation. */
  mutations: ['training'] as const,
  saveWorkout: ['training', 'workout-save'] as const,
  deleteWorkout: ['training', 'workout-delete'] as const,
  saveExercise: ['training', 'exercise-save'] as const,
  deleteExercise: ['training', 'exercise-delete'] as const,
};

export interface SaveWorkoutVariables {
  /** Client-generated workout id. */
  id: string;
  request: WorkoutUpsertRequest;
  /** The workout as the log shows it until the API answers. */
  preview: Workout;
}

export interface DeleteWorkoutVariables {
  id: string;
  /** Device time of the delete (AC23). */
  recordedAt: string;
}

export interface SaveCustomExerciseVariables {
  /** Client-generated exercise id. */
  id: string;
  request: CustomExerciseUpsertRequest;
}

export interface DeleteCustomExerciseVariables {
  id: string;
  /** Device time of the delete. */
  recordedAt: string;
}

/** A write the API refused: the optimistic change was undone (AC23). */
export interface RejectedTrainingWrite {
  /** The workout id or the exercise id. */
  id: string;
  /** `errors.<code>` in i18n. */
  code: string;
  fields: Readonly<Record<string, string>>;
}

/**
 * The variables of a new or changed workout: the preview is built by `@pt/core` the same way the API
 * builds the stored workout (labels in the request's locale, only the values each tracking keeps).
 * `exercises` are the ones the device knows: the cached catalog and the user's own. When an existing
 * workout is edited, pass it as `editing`: an exercise of the user's own deleted since stays loggable
 * for them (as in the API), with the label of that workout.
 */
export function saveWorkoutVariables(
  id: string,
  request: WorkoutUpsertRequest,
  exercises: readonly LoggableExercise[],
  editing: Workout | null = null,
): SaveWorkoutVariables {
  const known = new Map<string, LoggableExercise>();
  for (const e of editing?.exercises ?? []) {
    if (e.exerciseId !== null) {
      known.set(e.exerciseId, {
        id: e.exerciseId,
        nameEs: e.label,
        nameEn: e.label,
        tracking: e.tracking,
      });
    }
  }
  for (const e of exercises) known.set(e.id, e);
  const preview = workoutFromRequest(id, request, known);
  if ('error' in preview) throw new Error(`saveWorkoutVariables: ${preview.error}`);
  return { id, request, preview };
}

/** Newest first, as `GET /me/workouts` lists them: by day, then by start time. */
const newestFirst = (a: Workout, b: Workout) =>
  b.localDate.localeCompare(a.localDate) || Date.parse(b.startedAt) - Date.parse(a.startedAt);

/** The list with the workout `id` replaced by `workout`, or removed when it is null. */
export function withWorkout(
  workouts: readonly Workout[],
  id: string,
  workout: Workout | null,
): Workout[] {
  const others = workouts.filter((w) => w.id !== id);
  return workout ? [...others, workout].sort(newestFirst) : others;
}

/** The catalog with the user's exercise `id` replaced by `exercise` (first), or removed when null. */
export function withCustomExercise(
  catalog: ExerciseCatalogResponse,
  id: string,
  exercise: Exercise | null,
): ExerciseCatalogResponse {
  const others = catalog.exercises.filter((e) => e.id !== id);
  // The API lists the catalog first, then the user's own exercises, most recently changed first.
  const firstOwn = others.findIndex((e) => e.origin === 'user');
  const at = firstOwn === -1 ? others.length : firstOwn;
  return {
    ...catalog,
    exercises: exercise ? [...others.slice(0, at), exercise, ...others.slice(at)] : others,
  };
}

const retry = (failureCount: number, error: unknown) => !isRejected(error) && failureCount < 2;

/** The catalog changes only when the importer runs; the user's own exercises update it optimistically. */
export function exerciseCatalogQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: trainingKeys.catalog,
    queryFn: () => api.exerciseCatalog(),
    retry,
    staleTime: 60 * 60 * 1000,
  });
}

export function workoutsQueryOptions(api: ApiClient, today: string) {
  return queryOptions({
    queryKey: trainingKeys.log,
    queryFn: async () =>
      (
        await api.listWorkouts({
          from: addDays(today, -(WORKOUT_LIMITS.cacheDays - 1)),
          to: today,
        })
      ).workouts,
    retry,
  });
}

export function exerciseStatsQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: trainingKeys.stats,
    queryFn: async () => (await api.exerciseStats()).stats,
    retry,
  });
}

/** The bests and last sessions of one exercise (AC15). `null` while none is open (disabled). */
export function exerciseHistoryQueryOptions(
  api: ApiClient,
  exerciseId: string | null,
  limit: number = WORKOUT_LIMITS.historySessionsDefault,
) {
  return queryOptions({
    queryKey: trainingKeys.history(exerciseId ?? '', limit),
    queryFn: exerciseId ? () => api.exerciseHistory(exerciseId, limit) : skipToken,
    retry,
  });
}

function rejection(id: string, error: unknown): RejectedTrainingWrite {
  return {
    id,
    code: isApiError(error) ? error.code : 'internal_error',
    fields: isApiError(error) ? error.fields : {},
  };
}

/**
 * Registers the training mutations on the query client. Call it once, before any persisted mutation is
 * resumed: a mutation restored from storage finds its function through its key.
 */
export function registerTrainingMutations(queryClient: QueryClient, api: ApiClient): void {
  const queue = {
    // One write at a time, in the order they were made: a new exercise before the session that uses it,
    // a delete after its save, an undo after its delete.
    scope: { id: 'training' },
    retry: (_failureCount: number, error: unknown) => !isRejected(error),
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000),
  };

  /** With more writes queued, a refetch now would drop their optimistic changes for a moment. */
  const lastInQueue = () => queryClient.isMutating({ mutationKey: trainingKeys.mutations }) <= 1;

  const setWorkout = (id: string, workout: Workout | null) =>
    queryClient.setQueryData<Workout[]>(trainingKeys.log, (workouts = []) =>
      withWorkout(workouts, id, workout),
    );

  const onWorkoutMutate = async (id: string, workout: Workout | null) => {
    // A list request in flight would overwrite the optimistic workout with older data.
    await Promise.all([
      queryClient.cancelQueries({ queryKey: trainingKeys.log }),
      queryClient.cancelQueries({ queryKey: trainingKeys.stats }),
    ]);
    const previous =
      queryClient.getQueryData<Workout[]>(trainingKeys.log)?.find((w) => w.id === id) ?? null;
    setWorkout(id, workout);
    // A new record must show in the next session also without a connection (AC10, AC22).
    if (workout) {
      queryClient.setQueryData<ExerciseStats[]>(trainingKeys.stats, (stats) =>
        stats ? statsWithWorkout(stats, workout) : stats,
      );
    }
    queryClient.setQueryData(trainingKeys.rejected, null);
    return { previous };
  };

  const workoutShared = {
    ...queue,
    onError: (
      error: unknown,
      variables: { id: string },
      context: { previous: Workout | null } | undefined,
    ) => {
      // Only a refusal gets here (the rest is retried): undo the optimistic change and say why.
      setWorkout(variables.id, context?.previous ?? null);
      queryClient.setQueryData(trainingKeys.rejected, rejection(variables.id, error));
      // The optimistic bests may include the refused sets: the server's stats are the truth.
      void queryClient.invalidateQueries({ queryKey: trainingKeys.stats });
    },
    onSuccess: (data: WorkoutSaveResponse, variables: { id: string }) => {
      // The stored workout can differ from the one sent: a later write from another device wins.
      setWorkout(variables.id, data.workout);
    },
    onSettled: async () => {
      if (!lastInQueue()) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trainingKeys.log }),
        queryClient.invalidateQueries({ queryKey: trainingKeys.stats }),
        queryClient.invalidateQueries({ queryKey: trainingKeys.historyAll }),
      ]);
    },
  };

  queryClient.setMutationDefaults(trainingKeys.saveWorkout, {
    ...workoutShared,
    mutationFn: ({ id, request }: SaveWorkoutVariables) => api.saveWorkout(id, request),
    onMutate: ({ id, preview }: SaveWorkoutVariables) => onWorkoutMutate(id, preview),
  });

  queryClient.setMutationDefaults(trainingKeys.deleteWorkout, {
    ...workoutShared,
    mutationFn: ({ id, recordedAt }: DeleteWorkoutVariables) =>
      api.deleteWorkout(id, { recordedAt }),
    onMutate: ({ id }: DeleteWorkoutVariables) => onWorkoutMutate(id, null),
  });

  const setExercise = (id: string, exercise: Exercise | null) =>
    queryClient.setQueryData<ExerciseCatalogResponse>(trainingKeys.catalog, (catalog) =>
      catalog ? withCustomExercise(catalog, id, exercise) : catalog,
    );

  const onExerciseMutate = async (id: string, exercise: Exercise | null) => {
    await queryClient.cancelQueries({ queryKey: trainingKeys.catalog });
    const previous =
      queryClient
        .getQueryData<ExerciseCatalogResponse>(trainingKeys.catalog)
        ?.exercises.find((e) => e.id === id) ?? null;
    setExercise(id, exercise);
    queryClient.setQueryData(trainingKeys.rejected, null);
    return { previous };
  };

  const exerciseShared = {
    ...queue,
    onError: (
      error: unknown,
      variables: { id: string },
      context: { previous: Exercise | null } | undefined,
    ) => {
      setExercise(variables.id, context?.previous ?? null);
      queryClient.setQueryData(trainingKeys.rejected, rejection(variables.id, error));
    },
    onSuccess: (data: CustomExerciseSaveResponse, variables: { id: string }) => {
      setExercise(variables.id, data.exercise);
    },
    onSettled: async () => {
      if (!lastInQueue()) return;
      await queryClient.invalidateQueries({ queryKey: trainingKeys.catalog });
    },
  };

  queryClient.setMutationDefaults(trainingKeys.saveExercise, {
    ...exerciseShared,
    mutationFn: ({ id, request }: SaveCustomExerciseVariables) =>
      api.saveCustomExercise(id, request),
    // The API and the device build the same row (`customExercise` in core).
    onMutate: ({ id, request }: SaveCustomExerciseVariables) =>
      onExerciseMutate(id, customExercise(id, request)),
  });

  queryClient.setMutationDefaults(trainingKeys.deleteExercise, {
    ...exerciseShared,
    mutationFn: ({ id, recordedAt }: DeleteCustomExerciseVariables) =>
      api.deleteCustomExercise(id, { recordedAt }),
    // Past sessions keep their sets and labels; only the library and the picker lose it.
    onMutate: ({ id }: DeleteCustomExerciseVariables) => onExerciseMutate(id, null),
  });
}

/** Removes the notice of a rejected write once the user has seen it. */
export function dismissRejectedTrainingWrite(queryClient: QueryClient): void {
  queryClient.setQueryData(trainingKeys.rejected, null);
}
