/**
 * The routine being edited (spec 010 AC16): the wizard's proposal or a copy of the saved routine. It
 * lives in memory so the exercise picker, a screen above the editor, can add to it. Nothing reaches the
 * API until "Guardar rutina"; leaving the editor drops it.
 */
import { programReducer, type ProgramAction, type ProgramDraft } from '@pt/core';
import { useSyncExternalStore } from 'react';

let draft: ProgramDraft | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setRoutineDraft(next: ProgramDraft | null): void {
  draft = next;
  emit();
}

export function dispatchRoutineDraft(action: ProgramAction): void {
  if (!draft) return;
  const next = programReducer(draft, action);
  if (next !== draft) setRoutineDraft(next);
}

export const readRoutineDraft = (): ProgramDraft | null => draft;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoutineDraft(): ProgramDraft | null {
  return useSyncExternalStore(
    subscribe,
    () => draft,
    () => draft,
  );
}
