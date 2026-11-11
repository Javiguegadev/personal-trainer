import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/hooks/useI18n';
import { signOut } from '@/lib/session';

/** Home (signed in, onboarding completed). The targets card and Settings arrive in UI step 7c. */
export default function HomeScreen() {
  const { t } = useI18n();
  return (
    <Screen testID="home-screen">
      <AppText variant="title">{t.home.title}</AppText>
      <AppText tone="muted">{t.home.welcome}</AppText>
      <Button variant="ghost" label={t.common.signOut} onPress={() => void signOut()} />
    </Screen>
  );
}
