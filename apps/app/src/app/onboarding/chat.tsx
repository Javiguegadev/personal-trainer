import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/hooks/useI18n';
import { signOut } from '@/lib/session';

/** Temporary: replaced by the conversational onboarding in the next step (spec 001, UI 7b). */
export default function OnboardingChatScreen() {
  const { t } = useI18n();
  return (
    <Screen testID="onboarding-chat-screen">
      <AppText variant="title">{t.app.name}</AppText>
      <AppText tone="muted">{t.onboarding.placeholder}</AppText>
      <Button variant="ghost" label={t.common.signOut} onPress={() => void signOut()} />
    </Screen>
  );
}
