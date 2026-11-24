/**
 * What an activity sheet opened from a sentence shows besides its fields (spec 012 AC6, AC15): the
 * other activities said, each with "Registrar", and how many were left out. Kept in memory only: the
 * fields themselves travel as route params, and a lost list (an app restart) loses no data.
 */
import type { WorkoutDraftActivity } from '@pt/contracts';
import { useSyncExternalStore } from 'react';

export interface ActivityDraftExtras {
  extraActivities: WorkoutDraftActivity[];
  ignored: number;
}

const EMPTY: ActivityDraftExtras = { extraActivities: [], ignored: 0 };

let current: ActivityDraftExtras = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setActivityDraftExtras(next: ActivityDraftExtras | null): void {
  current = next ?? EMPTY;
  emit();
}

/** "Registrar" on one of them saved it: its line goes away. */
export function removeActivityDraftExtra(index: number): void {
  current = {
    ...current,
    extraActivities: current.extraActivities.filter((_, i) => i !== index),
  };
  emit();
}

/**
 * The params of the activity sheet for an activity of a sentence draft (spec 012 AC5, AC10): its type,
 * the minutes and effort said, the day and the time.
 */
export function activityDraftParams(
  activity: WorkoutDraftActivity,
  localDate: string,
  startTime: string | null,
): Record<string, string> {
  return {
    source: 'text',
    type: activity.activity,
    date: localDate,
    ...(activity.minutes !== null ? { minutes: String(activity.minutes) } : {}),
    ...(activity.sessionRpe !== null ? { rpe: String(activity.sessionRpe) } : {}),
    ...(startTime ? { time: startTime } : {}),
    ...(activity.distanceDropped ? { distance: '1' } : {}),
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActivityDraftExtras(): ActivityDraftExtras {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
