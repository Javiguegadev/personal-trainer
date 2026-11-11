import { auth } from './auth';
import { queryClient } from './query';

/** Signs out and drops every cached query, so the next account never sees the previous one's data. */
export async function signOut(): Promise<void> {
  await auth.signOut();
  queryClient.clear();
}
