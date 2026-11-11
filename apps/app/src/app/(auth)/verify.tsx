import { tokens } from '@pt/ui';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { OtpInput } from '@/components/OtpInput';
import { Screen } from '@/components/Screen';
import { useCountdown } from '@/hooks/useCountdown';
import { useI18n } from '@/hooks/useI18n';
import { AuthError, auth } from '@/lib/auth';
import { MOCK_BACKEND } from '@/lib/backend';
import { errorMessage } from '@/lib/errors';

/** AC2: resending is disabled for 60 s after each code. */
const RESEND_SECONDS = 60;
const CODE_LENGTH = 6;

export default function VerifyScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  if (!email) return <Redirect href="/sign-in" />;
  return <VerifyCode email={email} />;
}

function VerifyCode({ email }: { email: string }) {
  const { t, format } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<'verify' | 'resend' | null>(null);
  const { remaining, restart } = useCountdown(RESEND_SECONDS);

  async function verify(value: string) {
    if (value.length !== CODE_LENGTH || busy) return;
    setError(null);
    setInfo(null);
    setBusy('verify');
    try {
      // On success the root guard leaves (auth) and shows consent (first time) or Home (AC1).
      await auth.verifyEmailCode(email, value);
    } catch (e) {
      setError(errorMessage(e, t));
      if (e instanceof AuthError && e.code === 'expired_code') setCode('');
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    if (remaining > 0 || busy) return;
    setError(null);
    setBusy('resend');
    try {
      await auth.sendEmailCode(email);
      setCode('');
      setInfo(t.auth.verify.resent);
      restart();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen testID="verify-screen">
      <View style={styles.header}>
        <AppText variant="title">{t.auth.verify.title}</AppText>
        <AppText tone="muted">{format(t.auth.verify.subtitle, { email })}</AppText>
      </View>

      {MOCK_BACKEND ? <Notice tone="info" message={t.auth.verify.demoHint} /> : null}

      <OtpInput
        label={t.auth.verify.codeLabel}
        value={code}
        length={CODE_LENGTH}
        error={error}
        editable={busy !== 'verify'}
        onChange={(digits) => {
          setCode(digits);
          setError(null);
          if (digits.length === CODE_LENGTH) void verify(digits);
        }}
      />

      {info ? <Notice tone="success" message={info} /> : null}

      <Button
        label={t.auth.verify.submit}
        onPress={() => void verify(code)}
        loading={busy === 'verify'}
        disabled={code.length !== CODE_LENGTH || busy !== null}
        testID="verify-code"
      />
      <Button
        variant="secondary"
        label={
          remaining > 0
            ? format(t.auth.verify.resendIn, { seconds: remaining })
            : t.auth.verify.resend
        }
        onPress={() => void resend()}
        loading={busy === 'resend'}
        disabled={remaining > 0 || busy !== null}
        testID="resend-code"
      />
      <Button variant="ghost" label={t.auth.verify.changeEmail} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: tokens.space.sm, marginTop: tokens.space.xl, marginBottom: tokens.space.sm },
});
