import { onlineManager } from '@tanstack/react-query';

/**
 * Web: the browser's online state, read at start too, so a page opened offline knows it (TanStack Query
 * alone assumes online until an `offline` event).
 */
export function setupOnlineManager(): void {
  onlineManager.setEventListener((setOnline) => {
    if (typeof window === 'undefined') return undefined;
    const update = () => setOnline(window.navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  });
}
