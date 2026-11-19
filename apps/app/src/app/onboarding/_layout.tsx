import { Stack } from 'expo-router';
import { OnboardingProvider } from '@/hooks/useOnboarding';
import { useMe } from '@/lib/api';

/**
 * Consent comes first (AC6); the onboarding screens exist only once it is given. The form is the entry
 * (ADR 004).
 */
export default function OnboardingLayout() {
  const me = useMe();
  const consented = me.data?.consent.healthData === true;
  const onboarded = me.data?.onboardingCompleted === true;
  // Same rule as the root guard: no redirect until the account is loaded.
  const loading = me.isPending;
  return (
    <OnboardingProvider>
      <Stack screenOptions={{ headerShown: false }}>
        {/* An onboarded account only comes here to accept a new consent version, then goes home. */}
        <Stack.Protected
          guard={loading || !consented}
          redirectTo={onboarded ? '/' : '/onboarding/form'}
        >
          <Stack.Screen name="consent" />
        </Stack.Protected>
        <Stack.Protected guard={loading || consented} redirectTo="/onboarding/consent">
          <Stack.Screen name="form" />
          <Stack.Screen name="summary" />
        </Stack.Protected>
      </Stack>
    </OnboardingProvider>
  );
}
