import type { DietaryPrefs, Profile } from '@pt/contracts';
import { profileFormFromProfile } from '@pt/core';
import { useState } from 'react';
import { AgeBlocked } from '@/components/AgeBlocked';
import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { ProfileForm } from '@/components/ProfileForm';
import { SafetyNotices } from '@/components/SafetyNotices';
import { Screen } from '@/components/Screen';
import { TargetsCard } from '@/components/TargetsCard';
import { useI18n } from '@/hooks/useI18n';
import { useProfileEditor } from '@/hooks/useProfileEditor';
import { useMe } from '@/lib/api';

/** AC16: edit the profile; targets are recomputed and stored as a new row (old ones keep `valid_to`). */
export default function ProfileSettingsScreen() {
  const me = useMe();
  const profile = me.data?.profile;
  if (!profile) return <BlockingState />;
  return <ProfileSettings profile={profile} prefs={me.data?.dietaryPrefs ?? null} />;
}

function ProfileSettings({ profile, prefs }: { profile: Profile; prefs: DietaryPrefs | null }) {
  const { t, locale } = useI18n();
  const [values, setValues] = useState(() => profileFormFromProfile(profile, prefs, locale));
  const [saved, setSaved] = useState(false);
  const editor = useProfileEditor(values);
  const s = t.settings.profile;

  return (
    <Screen
      testID="settings-profile-screen"
      footer={
        <>
          {saved ? <Notice tone="success" message={s.saved} testID="profile-saved" /> : null}
          {editor.saveError ? <Notice tone="danger" message={editor.saveError} /> : null}
          {editor.hasErrors ? (
            <AppText variant="caption" tone="danger" role="alert">
              {t.onboarding.form.fixErrors}
            </AppText>
          ) : null}
          <Button
            label={s.save}
            onPress={() => editor.save({ onSuccess: () => setSaved(true) })}
            loading={editor.saving}
            disabled={editor.ageBlocked}
            testID="save-profile"
          />
        </>
      }
    >
      <BackLink fallback="/" />
      <AppText variant="title">{s.title}</AppText>
      <AppText tone="muted">{s.subtitle}</AppText>
      {editor.ageBlocked ? (
        <AgeBlocked />
      ) : (
        <>
          <TargetsCard {...editor.targets} />
          <SafetyNotices notices={editor.notices} floorKcal={editor.floorKcal} />
        </>
      )}
      <ProfileForm
        values={values}
        onChange={(next) => {
          setValues(next);
          setSaved(false);
        }}
        errors={editor.errors}
      />
      <AppText variant="caption" tone="muted">
        {t.common.notMedicalAdvice}
      </AppText>
    </Screen>
  );
}
