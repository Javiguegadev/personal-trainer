import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every `intervalMs` while the screen is mounted. The rest timer and the
 * elapsed time are computed from timestamps (spec 009 AC9), so a late tick after the background only
 * delays the display, never the count.
 */
export function useNow(intervalMs = 1000, enabled = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}
