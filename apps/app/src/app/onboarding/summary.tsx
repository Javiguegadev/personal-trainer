import { AgeBlocked } from '@/components/AgeBlocked';
import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { ProfileForm } from '@/components/ProfileForm';
import { SafetyNotices } from '@/components/SafetyNotices';
import { Screen } from '@/components/Screen';
import { TargetsCard } from '@/components/TargetsCard';
import { useI18n } from '@/hooks/useI18n';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useProfileEditor } from '@/hooks/useProfileEditor';

/**
 * AC10: every field editable, targets computed live by @pt/core through the API preview, safety notices
 * (AC14, AC17–AC21) and nothing saved until "Confirm". After saving, the root guard opens Home.
 */
export default function OnboardingSummaryScreen() {
  const { t } = useI18n();
  const { form, setForm } = useOnboarding();
  const editor = useProfileEditor(form);
  const s = t.onboarding.summary;

  return (
    <Screen
      testID="onboarding-summary-screen"
      footer={
        <>
          {editor.saveError ? <Notice tone="danger" message={editor.saveError} /> : null}
          {editor.hasErrors ? (
            <AppText variant="caption" tone="danger" role="alert">
              {t.onboarding.form.fixErrors}
            </AppText>
          ) : null}
          <AppText variant="caption" tone="muted">
            {t.common.notMedicalAdvice}
          </AppText>
          <Button
            label={s.confirm}
            onPress={() => editor.save()}
            loading={editor.saving}
            disabled={editor.ageBlocked}
            testID="confirm-profile"
          />
        </>
      }
    >
      <BackLink fallback="/onboarding/chat" />
      <AppText variant="title">{s.title}</AppText>
      <AppText tone="muted">{s.subtitle}</AppText>
      {editor.ageBlocked ? (
        // AC17: no targets, nothing can be saved; the date stays editable in case of a typo.
        <AgeBlocked />
      ) : (
        <>
          <TargetsCard {...editor.targets} />
          <SafetyNotices notices={editor.notices} floorKcal={editor.floorKcal} />
        </>
      )}
      <AppText variant="subtitle" weight="bold" accessibilityRole="header">
        {s.editDetails}
      </AppText>
      <ProfileForm values={form} onChange={setForm} errors={editor.errors} />
    </Screen>
  );
}
