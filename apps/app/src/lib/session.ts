import { auth } from './auth';
import { removeCheckinPrefs } from './checkinPrefs';
import { removeSessions } from './liveSession';
import { stopOfflineCache } from './offline';
import { queryClient } from './query';

/**
 * Signs out and removes everything cached on the device, the queue of writes included, so the next
 * account never sees the previous one's data (spec 003 AC22). The caller asks first when writes are
 * still waiting to sync.
 */
export async function signOut(): Promise<void> {
  const user = auth.getState().session?.userId ?? null;
  const removeSavedCache = stopOfflineCache();
  await auth.signOut();
  // Clears the queries and the mutations (the queue).
  queryClient.clear();
  await removeSavedCache();
  // The workout in progress and a draft are this user's too (spec 009 AC11), and so are "Hoy no" and
  // the preferred shift hours of the check-in (spec 011).
  if (user) {
    removeSessions(user);
    removeCheckinPrefs(user);
  }
}
