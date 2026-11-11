import { Stack } from 'expo-router';
import { useMe } from '@/lib/api';

/** Consent comes first (AC6); the onboarding screens exist only once it is given. */
export default function OnboardingLayout() {
  const me = useMe();
  const consented = me.data?.consent.healthData === true;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!consented} redirectTo="/onboarding/chat">
        <Stack.Screen name="consent" />
      </Stack.Protected>
      <Stack.Protected guard={consented} redirectTo="/onboarding/consent">
        <Stack.Screen name="chat" />
      </Stack.Protected>
    </Stack>
  );
}
