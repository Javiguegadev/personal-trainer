import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { GoogleLogo } from '@/components/GoogleLogo';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { auth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

/** AC1 (email code) and AC3 (Google). Where the user lands next is decided by the root guard. */
export default function SignInScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const trimmed = email.trim();

  async function sendCode() {
    if (!trimmed || busy) return;
    setError(null);
    setBusy('email');
    try {
      await auth.sendEmailCode(trimmed);
      router.push({ pathname: '/verify', params: { email: trimmed } });
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function continueWithGoogle() {
    if (busy) return;
    setError(null);
    setBusy('google');
    try {
      await auth.signInWithGoogle();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen testID="sign-in-screen">
      <View style={styles.header}>
        <AppText variant="caption" tone="primary" weight="bold">
          {t.app.name.toUpperCase()}
        </AppText>
        <AppText variant="title">{t.auth.signIn.title}</AppText>
        <AppText tone="muted">{t.auth.signIn.subtitle}</AppText>
      </View>

      <TextField
        label={t.auth.signIn.emailLabel}
        placeholder={t.auth.signIn.emailPlaceholder}
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setError(null);
        }}
        keyboardType="email-address"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={() => void sendCode()}
        testID="email-input"
      />

      {error ? <Notice tone="danger" message={error} testID="sign-in-error" /> : null}

      <Button
        label={t.auth.signIn.sendCode}
        onPress={() => void sendCode()}
        loading={busy === 'email'}
        disabled={!trimmed || busy !== null}
        testID="send-code"
      />

      <View
        style={styles.divider}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.line, { backgroundColor: colors.border }]} />
        <AppText variant="caption" tone="muted">
          {t.auth.signIn.continueWith}
        </AppText>
        <View style={[styles.line, { backgroundColor: colors.border }]} />
      </View>

      {/* One button per provider; Apple joins Google here in its own spec. */}
      <Button
        variant="secondary"
        label={t.auth.signIn.google}
        accessibilityLabel={t.auth.signIn.googleA11y}
        icon={<GoogleLogo />}
        onPress={() => void continueWithGoogle()}
        loading={busy === 'google'}
        disabled={busy !== null}
        testID="google-sign-in"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: tokens.space.sm, marginTop: tokens.space.xl, marginBottom: tokens.space.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.md },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
});
