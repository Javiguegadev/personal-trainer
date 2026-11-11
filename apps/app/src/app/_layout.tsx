import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { BlockingState } from '@/components/BlockingState';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useMe } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryClient } from '@/lib/query';
import { signOut } from '@/lib/session';

export default function RootLayout() {
  const { scheme, colors } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={theme}>
        <RootNavigator />
        <StatusBar style="auto" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * Root guard (spec 001): signed out → (auth); signed in without a completed onboarding → onboarding
 * (consent first, see onboarding/_layout); otherwise Home. Guards are client-side only: the API enforces
 * auth and consent on every request.
 */
function RootNavigator() {
  const { t } = useI18n();
  const authState = useAuth();
  const signedIn = authState.status === 'signedIn';
  const me = useMe({ enabled: signedIn });
  const onboarded = me.data?.onboardingCompleted === true;
  const consented = me.data?.consent.healthData === true;

  const loading = authState.status === 'loading' || (signedIn && me.isPending && !me.isError);
  const failed = signedIn && me.isError && !me.data;

  // Where the user belongs right now. Groups have no index route, so every guard redirects to a real
  // screen instead of the group itself.
  const destination = !signedIn
    ? '/sign-in'
    : onboarded
      ? '/'
      : consented
        ? '/onboarding/chat'
        : '/onboarding/consent';

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn} redirectTo={destination}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !onboarded} redirectTo={destination}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && onboarded} redirectTo={destination}>
          <Stack.Screen name="index" />
        </Stack.Protected>
      </Stack>
      {loading ? <BlockingState /> : null}
      {failed ? (
        <BlockingState
          error={errorMessage(me.error, t)}
          onRetry={() => void me.refetch()}
          onSignOut={() => void signOut()}
        />
      ) : null}
    </>
  );
}
