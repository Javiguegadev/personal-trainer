import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/** The online state TanStack Query uses to pause and resume requests and writes. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
    () => true,
  );
}
