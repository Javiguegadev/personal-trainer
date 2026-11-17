import { parseProfileForm } from '@pt/core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ProfileForm } from '@/components/ProfileForm';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/hooks/useI18n';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useToday } from '@/hooks/useToday';
import { signOut } from '@/lib/session';

/** The onboarding entry (AC11, ADR 004): taps and fields, reviewed in the summary before saving. */
export default function OnboardingFormScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const today = useToday();
  const { form, setForm } = useOnboarding();
  const [showErrors, setShowErrors] = useState(false);
  const parsed = parseProfileForm(form, today, locale);
  const errors = showErrors && !parsed.ok ? parsed.errors : {};

  return (
    <Screen
      testID="onboarding-form-screen"
      footer={
        <>
          {showErrors && !parsed.ok ? (
            <AppText variant="caption" tone="danger" role="alert">
              {t.onboarding.form.fixErrors}
            </AppText>
          ) : null}
          <Button
            label={t.onboarding.form.continue}
            onPress={() => {
              setShowErrors(true);
              if (parsed.ok) router.push('/onboarding/summary');
            }}
            testID="form-continue"
          />
        </>
      }
    >
      <AppText variant="title">{t.onboarding.form.title}</AppText>
      <AppText tone="muted">{t.onboarding.form.subtitle}</AppText>
      <ProfileForm values={form} onChange={setForm} errors={errors} />
      <Button variant="ghost" label={t.common.signOut} onPress={() => void signOut()} />
    </Screen>
  );
}
