import type { PlanChanges } from '@pt/core';
import { useSyncExternalStore } from 'react';

/** How long a plan change can be undone (spec 013 AC6, AC11, AC12, AC20). */
export const PLAN_UNDO_MS = 5000;

/** The last plan change that can still be undone: what to say, and the change that undoes it. */
export interface PlanUndo {
  message: string;
  /** Stamped with the time of the undo when it is sent (`stampChanges`), so it wins. */
  undo: PlanChanges;
}

// Outside React: a sheet offers the undo while it closes, and the screen behind it shows it.
let current: PlanUndo | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: PlanUndo | null): void {
  if (timer) clearTimeout(timer);
  timer = next ? setTimeout(() => set(null), PLAN_UNDO_MS) : null;
  current = next;
  listeners.forEach((listener) => listener());
}

export function offerPlanUndo(undo: PlanUndo): void {
  set(undo);
}

export function clearPlanUndo(): void {
  set(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = (): PlanUndo | null => current;

export function usePlanUndo(): PlanUndo | null {
  return useSyncExternalStore(subscribe, read, read);
}
