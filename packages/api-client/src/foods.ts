/**
 * Food search and food log (spec 005): one cached list of the last days, optimistic writes, and mutation
 * defaults registered by key so a write queued offline is sent after the app was closed and opened again
 * (AC19–AC21, the spec 003 pattern).
 */
import {
  FOOD_LOG_LIMITS,
  type Food,
  type Locale,
  type MealItem,
  type MealItemSaveResponse,
  type MealItemUpsertRequest,
} from '@pt/contracts';
import { addDays, mealItemFromRequest } from '@pt/core';
import { keepPreviousData, queryOptions, skipToken, type QueryClient } from '@tanstack/react-query';
import { isApiError, type ApiClient } from './client';
import { isRejected } from './weights';

/**
 * Days of the cached log: today and the 6 days before (the day selector, AC15), plus the day before the
 * oldest, so "Repetir lo de ayer" works on every selectable day (AC13).
 */
export const FOOD_LOG_DAYS = 8;

export const foodKeys = {
  /** The items of the last `FOOD_LOG_DAYS` days. One list for every screen, so optimistic writes hit it. */
  log: ['food-log'] as const,
  search: (q: string, locale: Locale) => ['food-search', locale, q] as const,
  food: (foodId: string, locale: Locale) => ['food', foodId, locale] as const,
  sources: (locale: Locale) => ['food-sources', locale] as const,
  /** Prefix of the recents of every locale. */
  recentsAll: ['food-recents'] as const,
  recents: (locale: Locale) => ['food-recents', locale] as const,
  /** Prefix of the favourites of every locale. */
  favouritesAll: ['food-favourites'] as const,
  favourites: (locale: Locale) => ['food-favourites', locale] as const,
  /** The last write the API rejected, until the user dismisses it (AC21). */
  rejected: ['food-log-rejected'] as const,
  /** Prefix of every food-log mutation (items and favourites). */
  mutations: ['food-log'] as const,
  saveItem: ['food-log', 'save'] as const,
  deleteItem: ['food-log', 'delete'] as const,
  favourite: ['food-log', 'favourite'] as const,
};

export interface SaveMealItemVariables {
  /** Client-generated item id. */
  id: string;
  request: MealItemUpsertRequest;
  /** The item as the log shows it until the API answers. */
  preview: MealItem;
}

export interface DeleteMealItemVariables {
  id: string;
  /** Device time of the delete (AC20). */
  recordedAt: string;
}

export interface FavouriteFoodVariables {
  food: Food;
  favourite: boolean;
  /** Locale of the favourites list the food is added to. */
  locale: Locale;
}

/** A write the API refused: the optimistic change was undone (AC21). */
export interface RejectedFoodWrite {
  /** The item id, or the food id of a favourite. */
  id: string;
  /** `errors.<code>` in i18n. */
  code: string;
  fields: Readonly<Record<string, string>>;
}

/**
 * The variables of a new or changed item: the preview is computed by `@pt/core` the same way the API
 * computes the stored snapshot (AC9). `food` is the catalog food of a `food` request.
 */
export function saveItemVariables(
  id: string,
  request: MealItemUpsertRequest,
  food: Food | null,
): SaveMealItemVariables {
  const preview = mealItemFromRequest(id, request, food);
  if ('error' in preview) throw new Error(`saveItemVariables: ${preview.error}`);
  return { id, request, preview };
}

const byDayAndTime = (a: MealItem, b: MealItem) =>
  a.localDate.localeCompare(b.localDate) || a.recordedAt.localeCompare(b.recordedAt);

/** The list with the item `id` replaced by `item`, or removed when it is null. */
export function withMealItem(
  items: readonly MealItem[],
  id: string,
  item: MealItem | null,
): MealItem[] {
  const others = items.filter((i) => i.id !== id);
  return item ? [...others, item].sort(byDayAndTime) : others;
}

/** The favourites with `food` added first, or removed. */
export function withFavourite(foods: readonly Food[], food: Food, favourite: boolean): Food[] {
  const others = foods.filter((f) => f.id !== food.id);
  return favourite ? [food, ...others] : others;
}

const retry = (failureCount: number, error: unknown) => !isRejected(error) && failureCount < 2;

export function foodLogQueryOptions(api: ApiClient, today: string) {
  return queryOptions({
    queryKey: foodKeys.log,
    queryFn: async () =>
      (await api.listFoodLog({ from: addDays(today, -(FOOD_LOG_DAYS - 1)), to: today })).items,
    retry,
  });
}

/** Disabled below 2 characters. Results stay on screen while the next query loads. */
export function foodSearchQueryOptions(api: ApiClient, q: string, locale: Locale) {
  const query = q.trim();
  return queryOptions({
    queryKey: foodKeys.search(query, locale),
    queryFn:
      query.length >= FOOD_LOG_LIMITS.searchMinLength
        ? async () => (await api.searchFoods(query, locale)).foods
        : skipToken,
    retry,
    // The catalog changes only when the importer runs.
    staleTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/** One catalog food, to edit a logged portion (AC11). `null` while there is none (disabled). */
export function foodQueryOptions(api: ApiClient, foodId: string | null, locale: Locale) {
  return queryOptions({
    queryKey: foodKeys.food(foodId ?? '', locale),
    queryFn: foodId ? () => api.getFood(foodId, locale) : skipToken,
    retry,
    staleTime: 60 * 60 * 1000,
  });
}

export function foodSourcesQueryOptions(api: ApiClient, locale: Locale) {
  return queryOptions({
    queryKey: foodKeys.sources(locale),
    queryFn: async () => (await api.foodSources(locale)).sources,
    retry,
    staleTime: 60 * 60 * 1000,
  });
}

export function recentFoodsQueryOptions(api: ApiClient, locale: Locale) {
  return queryOptions({
    queryKey: foodKeys.recents(locale),
    queryFn: async () => (await api.recentFoods(locale)).recents,
    retry,
  });
}

export function favouriteFoodsQueryOptions(api: ApiClient, locale: Locale) {
  return queryOptions({
    queryKey: foodKeys.favourites(locale),
    queryFn: async () => (await api.favouriteFoods(locale)).foods,
    retry,
  });
}

function rejection(id: string, error: unknown): RejectedFoodWrite {
  return {
    id,
    code: isApiError(error) ? error.code : 'internal_error',
    fields: isApiError(error) ? error.fields : {},
  };
}

/**
 * Registers the food-log mutations on the query client. Call it once, before any persisted mutation is
 * resumed: a mutation restored from storage finds its function through its key.
 */
export function registerFoodMutations(queryClient: QueryClient, api: ApiClient): void {
  const setItem = (id: string, item: MealItem | null) =>
    queryClient.setQueryData<MealItem[]>(foodKeys.log, (items = []) =>
      withMealItem(items, id, item),
    );

  const queue = {
    // One write at a time, in the order they were made (a delete after its add, an undo after its delete).
    scope: { id: 'food-log' },
    retry: (_failureCount: number, error: unknown) => !isRejected(error),
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000),
  };

  /** With more writes queued, a refetch now would drop their optimistic changes for a moment. */
  const lastInQueue = () => queryClient.isMutating({ mutationKey: foodKeys.mutations }) <= 1;

  const onItemMutate = async (id: string, item: MealItem | null) => {
    // A list request in flight would overwrite the optimistic item with older data.
    await queryClient.cancelQueries({ queryKey: foodKeys.log });
    const previous =
      queryClient.getQueryData<MealItem[]>(foodKeys.log)?.find((i) => i.id === id) ?? null;
    setItem(id, item);
    queryClient.setQueryData(foodKeys.rejected, null);
    return { previous };
  };

  const itemShared = {
    ...queue,
    onError: (
      error: unknown,
      variables: { id: string },
      context: { previous: MealItem | null } | undefined,
    ) => {
      // Only a refusal gets here (the rest is retried): undo the optimistic change and say why.
      setItem(variables.id, context?.previous ?? null);
      queryClient.setQueryData(foodKeys.rejected, rejection(variables.id, error));
    },
    onSuccess: (data: MealItemSaveResponse, variables: { id: string }) => {
      // The stored item can differ from the one sent: a later write from another device wins (AC20).
      setItem(variables.id, data.item);
    },
    onSettled: async () => {
      if (!lastInQueue()) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: foodKeys.log }),
        queryClient.invalidateQueries({ queryKey: foodKeys.recentsAll }),
      ]);
    },
  };

  queryClient.setMutationDefaults(foodKeys.saveItem, {
    ...itemShared,
    mutationFn: ({ id, request }: SaveMealItemVariables) => api.saveMealItem(id, request),
    onMutate: ({ id, preview }: SaveMealItemVariables) => onItemMutate(id, preview),
  });

  queryClient.setMutationDefaults(foodKeys.deleteItem, {
    ...itemShared,
    mutationFn: ({ id, recordedAt }: DeleteMealItemVariables) =>
      api.deleteMealItem(id, { recordedAt }),
    onMutate: ({ id }: DeleteMealItemVariables) => onItemMutate(id, null),
  });

  queryClient.setMutationDefaults(foodKeys.favourite, {
    ...queue,
    mutationFn: ({ food, favourite }: FavouriteFoodVariables) =>
      api.setFavouriteFood(food.id, favourite),
    onMutate: async ({ food, favourite, locale }: FavouriteFoodVariables) => {
      await queryClient.cancelQueries({ queryKey: foodKeys.favouritesAll });
      const previous = queryClient.getQueriesData<Food[]>({ queryKey: foodKeys.favouritesAll });
      // The food is added to the list of its locale; the other locales are refetched afterwards.
      queryClient.setQueryData<Food[]>(foodKeys.favourites(locale), (foods = []) =>
        withFavourite(foods, food, favourite),
      );
      if (!favourite) {
        queryClient.setQueriesData<Food[]>({ queryKey: foodKeys.favouritesAll }, (foods) =>
          foods?.filter((f) => f.id !== food.id),
        );
      }
      queryClient.setQueryData(foodKeys.rejected, null);
      return { previous };
    },
    onError: (
      error: unknown,
      { food }: FavouriteFoodVariables,
      context: { previous: [readonly unknown[], Food[] | undefined][] } | undefined,
    ) => {
      for (const [key, foods] of context?.previous ?? []) queryClient.setQueryData(key, foods);
      queryClient.setQueryData(foodKeys.rejected, rejection(food.id, error));
    },
    onSettled: async () => {
      if (!lastInQueue()) return;
      await queryClient.invalidateQueries({ queryKey: foodKeys.favouritesAll });
    },
  });
}

/** Removes the notice of a rejected write once the user has seen it. */
export function dismissRejectedFoodWrite(queryClient: QueryClient): void {
  queryClient.setQueryData(foodKeys.rejected, null);
}
