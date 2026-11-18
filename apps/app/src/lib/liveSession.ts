/**
 * The session being logged (spec 009 AC6–AC13), kept in device storage so it survives a closed app or a
 * restart (AC11), not in the query cache. Two slots per user: `live` is the session in the gym (one at a
 * time, AC6); `draft` is a past session (AC17) or a saved one being edited (AC19), so editing never
 * touches the session in progress. Nothing reaches the API until the user saves.
 */
import { sessionReducer, type LiveSession, type SessionAction } from '@pt/core';
import { useSyncExternalStore } from 'react';
import { storage } from './storage';

export type SessionSlot = 'live' | 'draft';

const KEY_PREFIX = 'pt.training-session.';
const SLOTS: readonly SessionSlot[] = ['live', 'draft'];

let userId: string | null = null;
const sessions: Record<SessionSlot, LiveSession | null> = { live: null, draft: null };
const listeners = new Set<() => void>();

const keyOf = (user: string, slot: SessionSlot) => `${KEY_PREFIX}${slot}.${user}`;

function read(user: string, slot: SessionSlot): LiveSession | null {
  const text = storage.getItem(keyOf(user, slot));
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as LiveSession;
    // A copy saved by another version of the app is dropped rather than misread.
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

/** Loads the sessions of the signed-in user (or clears them on sign-out). */
export function setSessionUser(next: string | null): void {
  if (next === userId) return;
  userId = next;
  for (const slot of SLOTS) sessions[slot] = next ? read(next, slot) : null;
  emit();
}

/** Replaces a slot (a new session, or null once it is saved or discarded). */
export function setSession(slot: SessionSlot, session: LiveSession | null): void {
  sessions[slot] = session;
  if (userId) {
    if (session) storage.setItem(keyOf(userId, slot), JSON.stringify(session));
    else storage.removeItem(keyOf(userId, slot));
  }
  emit();
}

/** Applies one action of the reducer of `@pt/core` and saves the result at once. */
export function dispatchSession(slot: SessionSlot, action: SessionAction): void {
  const current = sessions[slot];
  if (!current) return;
  const next = sessionReducer(current, action);
  if (next !== current) setSession(slot, next);
}

export const readSession = (slot: SessionSlot): LiveSession | null => sessions[slot];

/** Deletes the saved sessions of a user who signs out (spec 003 AC22: the next account sees nothing). */
export function removeSessions(user: string): void {
  for (const slot of SLOTS) storage.removeItem(keyOf(user, slot));
  if (user === userId) {
    sessions.live = null;
    sessions.draft = null;
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession(slot: SessionSlot): LiveSession | null {
  return useSyncExternalStore(
    subscribe,
    () => sessions[slot],
    () => sessions[slot],
  );
}

// "No, sigo entrenando" of AC13: asked once per session and app run.
const staleDismissed = new Set<string>();

export function dismissStale(sessionId: string): void {
  staleDismissed.add(sessionId);
  emit();
}

/** Whether the user already said the stale session is still going on (AC13). */
export function useStaleDismissed(sessionId: string | null): boolean {
  const read = () => sessionId !== null && staleDismissed.has(sessionId);
  return useSyncExternalStore(subscribe, read, read);
}
