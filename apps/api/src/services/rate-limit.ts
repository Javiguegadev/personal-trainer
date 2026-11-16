/**
 * A small in-memory limit per key (spec 006 AC7: live lookups per user and minute). It lives in one API
 * instance, so with several instances the real limit is higher: it stops a loop in one client, it is
 * not an exact quota. A shared store is not worth it until there is one for something else.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();

  return {
    /** Counts a hit and returns true while the key stays within the limit. */
    allow(key: string, now: number): boolean {
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      // Keys that went quiet are dropped so the map does not grow with every user ever seen.
      if (hits.size > 10_000) {
        for (const [other, times] of hits) {
          if (times.every((at) => now - at >= windowMs)) hits.delete(other);
        }
      }
      return true;
    },
  };
}
