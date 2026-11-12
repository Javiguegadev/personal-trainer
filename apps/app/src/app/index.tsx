import { profileNotices } from '@pt/core';
import { useRouter } from 'expo-router';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { SafetyNotices } from '@/components/SafetyNotices';
import { Screen } from '@/components/Screen';
import { TargetsCard } from '@/components/TargetsCard';
import { useI18n } from '@/hooks/useI18n';
import { useMe } from '@/lib/api';
import { signOut } from '@/lib/session';

/** Home (signed in, onboarding completed): today's targets. Food and workout logging arrive in E4/E5. */
export default function HomeScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const me = useMe();
  if (!me.data?.profile) return <BlockingState />;

  const { profile, targets } = me.data;
  const notices = profileNotices({ flags: profile.safetyFlags }, targets);
  return (
    <Screen testID="home-screen">
      <AppText variant="title">{t.home.title}</AppText>
      <AppText tone="muted">{t.home.welcome}</AppText>
      <TargetsCard status="ready" targets={targets} breakdown={null} />
      <SafetyNotices
        notices={notices}
        // A clamped target is exactly the safety minimum (rounded up to 10 kcal).
        floorKcal={targets?.clampedReason === 'calorie_floor' ? targets.kcal : undefined}
      />
      <Button
        variant="secondary"
        label={t.home.editProfile}
        onPress={() => router.push('/settings/profile')}
        testID="open-profile"
      />
      <Button
        variant="secondary"
        label={t.home.privacy}
        onPress={() => router.push('/settings/privacy')}
        testID="open-privacy"
      />
      <Button variant="ghost" label={t.common.signOut} onPress={() => void signOut()} />
    </Screen>
  );
}
