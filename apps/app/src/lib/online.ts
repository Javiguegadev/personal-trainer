import { onlineManager } from '@tanstack/react-query';
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';

/**
 * Phones: the online state comes from expo-network (TanStack Query listens to browser events only).
 * Unknown counts as online; only an explicit "not connected" pauses requests and writes.
 */
export function setupOnlineManager(): void {
  onlineManager.setEventListener((setOnline) => {
    const apply = (state: NetworkState) => setOnline(state.isConnected !== false);
    void getNetworkStateAsync()
      .then(apply)
      .catch(() => undefined);
    const subscription = addNetworkStateListener(apply);
    return () => subscription.remove();
  });
}
