/**
 * What the weekly review keeps on the device (spec 014 AC1), one copy per user: the week whose review
 * without a proposal was closed with "Entendido". It never reaches the API (nothing is decided on such
 * a review). Without storage the card shows again after a restart.
 */
import { useSyncExternalStore } from 'react';
import { storage } from './storage';

const KEY_PREFIX = 'pt.review-prefs.v1.';

let userId: string | null = null;
let dismissedWeek: string | null = null;
const listeners = new Set<() => void>();

function read(user: string): string | null {
  try {
    const raw = JSON.parse(storage.getItem(KEY_PREFIX + user) ?? 'null') as {
      dismissedWeek?: unknown;
    } | null;
    const week = raw?.dismissedWeek;
    return typeof week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : null;
  } catch {
    return null;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

/** Loads the signed-in user's copy (or forgets it on sign-out). */
export function setReviewPrefsUser(next: string | null): void {
  if (next === userId) return;
  userId = next;
  dismissedWeek = next ? read(next) : null;
  emit();
}

/** "Entendido" on the review of the week starting on `weekStart`. */
export function dismissReview(weekStart: string): void {
  dismissedWeek = weekStart;
  if (userId) storage.setItem(KEY_PREFIX + userId, JSON.stringify({ dismissedWeek }));
  emit();
}

/** Deletes the copy of a user who signs out (spec 003 AC22). */
export function removeReviewPrefs(user: string): void {
  storage.removeItem(KEY_PREFIX + user);
  if (user === userId) {
    dismissedWeek = null;
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => dismissedWeek;

export function useDismissedReviewWeek(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
