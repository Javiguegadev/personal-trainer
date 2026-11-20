import { useSyncExternalStore } from 'react';
import { storage } from './storage';

/** "Día" or "Semana" on Today (spec 010 AC7), remembered on the device. */
export type TodayView = 'day' | 'week';

const TODAY_VIEW_KEY = 'pt.todayView.v1';

let current: TodayView = storage.getItem(TODAY_VIEW_KEY) === 'week' ? 'week' : 'day';
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => current;

export function setTodayView(view: TodayView): void {
  if (view === current) return;
  current = view;
  storage.setItem(TODAY_VIEW_KEY, view);
  listeners.forEach((listener) => listener());
}

export function useTodayView(): TodayView {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
