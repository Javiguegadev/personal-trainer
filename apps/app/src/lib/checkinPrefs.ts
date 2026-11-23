/**
 * What the daily check-in keeps on the device (spec 011), one copy per user: the day "Hoy no" was
 * tapped (AC2), the hours last chosen for each shift kind (AC3; they only prefill, so they never reach
 * the API) and the day the pattern notice was dismissed (AC13, decision a). Read and written in
 * try/catch through `storage`: without storage the card simply shows again.
 */
import type { PreferredShiftHours, ShiftHours, WorkingShift } from '@pt/core';
import { useSyncExternalStore } from 'react';
import { storage } from './storage';

export interface CheckinPrefs {
  skippedOn: string | null;
  shiftHours: PreferredShiftHours;
  noticeDismissedOn: string | null;
}

const KEY_PREFIX = 'pt.checkin-prefs.v1.';
const EMPTY: CheckinPrefs = { skippedOn: null, shiftHours: {}, noticeDismissedOn: null };
const KINDS: readonly WorkingShift[] = ['morning', 'afternoon', 'night'];

let userId: string | null = null;
let prefs: CheckinPrefs = EMPTY;
const listeners = new Set<() => void>();

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isMinute = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440;

/** A copy written by another version of the app, or edited by hand, is read field by field. */
function parse(text: string | null): CheckinPrefs {
  if (!text) return EMPTY;
  try {
    const raw = JSON.parse(text) as Partial<Record<keyof CheckinPrefs, unknown>>;
    const shiftHours: PreferredShiftHours = {};
    const hours = (raw.shiftHours ?? {}) as Partial<Record<WorkingShift, Partial<ShiftHours>>>;
    for (const kind of KINDS) {
      const h = hours[kind];
      if (h && isMinute(h.startMinute) && isMinute(h.endMinute) && h.startMinute !== h.endMinute) {
        shiftHours[kind] = { startMinute: h.startMinute, endMinute: h.endMinute };
      }
    }
    return {
      skippedOn: isDate(raw.skippedOn) ? raw.skippedOn : null,
      shiftHours,
      noticeDismissedOn: isDate(raw.noticeDismissedOn) ? raw.noticeDismissedOn : null,
    };
  } catch {
    return EMPTY;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

/** Loads the signed-in user's copy (or forgets it on sign-out). */
export function setCheckinPrefsUser(next: string | null): void {
  if (next === userId) return;
  userId = next;
  prefs = next ? parse(storage.getItem(KEY_PREFIX + next)) : EMPTY;
  emit();
}

export function updateCheckinPrefs(change: Partial<CheckinPrefs>): void {
  prefs = { ...prefs, ...change };
  if (userId) storage.setItem(KEY_PREFIX + userId, JSON.stringify(prefs));
  emit();
}

/** Remembers the hours of a working shift for the next check-ins (AC3). */
export function rememberShiftHours(kind: WorkingShift, hours: ShiftHours): void {
  updateCheckinPrefs({ shiftHours: { ...prefs.shiftHours, [kind]: hours } });
}

/** Deletes the copy of a user who signs out (spec 003 AC22). */
export function removeCheckinPrefs(user: string): void {
  storage.removeItem(KEY_PREFIX + user);
  if (user === userId) {
    prefs = EMPTY;
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => prefs;

export function useCheckinPrefs(): CheckinPrefs {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
