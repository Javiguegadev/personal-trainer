import { useSyncExternalStore } from 'react';
import { auth, type AuthState } from '@/lib/auth';

export function useAuth(): AuthState {
  return useSyncExternalStore(auth.subscribe, auth.getState, auth.getState);
}
