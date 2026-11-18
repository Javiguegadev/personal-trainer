import type { Workout } from '@pt/contracts';
import { useSyncExternalStore } from 'react';

/** How long a deleted workout can be brought back (spec 009 AC19). */
export const WORKOUT_UNDO_MS = 5000;

// Outside React: the detail sheet deletes and closes, the Training tab shows the undo.
let current: Workout | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: Workout | null): void {
  if (timer) clearTimeout(timer);
  timer = next ? setTimeout(() => set(null), WORKOUT_UNDO_MS) : null;
  current = next;
  listeners.forEach((listener) => listener());
}

export function offerWorkoutUndo(workout: Workout): void {
  set(workout);
}

export function clearWorkoutUndo(): void {
  set(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = (): Workout | null => current;

/** The deleted workout that can still be restored, if any. */
export function useWorkoutUndo(): Workout | null {
  return useSyncExternalStore(subscribe, read, read);
}
