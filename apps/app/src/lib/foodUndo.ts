import type { MealItem } from '@pt/contracts';
import { useSyncExternalStore } from 'react';

/** How long a delete or a "repeat yesterday" can be undone (spec 005 AC11, AC13). */
export const FOOD_UNDO_MS = 5000;

/**
 * The last change that can still be undone: a deleted item, the copies made by "repeat yesterday", or
 * the items of a saved draft (spec 007 AC8).
 */
export type FoodUndo =
  { kind: 'deleted'; item: MealItem } | { kind: 'repeated' | 'added'; items: readonly MealItem[] };

// Outside React: the item sheet offers the undo while it closes, and the Food tab shows it.
let current: FoodUndo | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: FoodUndo | null): void {
  if (timer) clearTimeout(timer);
  timer = next ? setTimeout(() => set(null), FOOD_UNDO_MS) : null;
  current = next;
  listeners.forEach((listener) => listener());
}

export function offerFoodUndo(undo: FoodUndo): void {
  set(undo);
}

export function clearFoodUndo(): void {
  set(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The offer still open, if any. */
export const readFoodUndo = (): FoodUndo | null => current;

export function useFoodUndo(): FoodUndo | null {
  return useSyncExternalStore(subscribe, readFoodUndo, readFoodUndo);
}
