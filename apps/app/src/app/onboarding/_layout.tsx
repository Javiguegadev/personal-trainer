import { Stack } from 'expo-router';
import { OnboardingProvider } from '@/hooks/useOnboarding';
import { useMe } from '@/lib/api';

/** Consent comes first (AC6); the onboarding screens exist only once it is given. */
export default function OnboardingLayout() {
  const me = useMe();
  const consented = me.data?.consent.healthData === true;
  // Same rule as the root guard: no redirect until the account is loaded.
  const loading = me.isPending;
  return (
    <OnboardingProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={loading || !consented} redirectTo="/onboarding/chat">
          <Stack.Screen name="consent" />
        </Stack.Protected>
        <Stack.Protected guard={loading || consented} redirectTo="/onboarding/consent">
          <Stack.Screen name="chat" />
          <Stack.Screen name="form" />
          <Stack.Screen name="summary" />
        </Stack.Protected>
      </Stack>
    </OnboardingProvider>
  );
}
