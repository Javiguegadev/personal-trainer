import { weightKeys } from '@pt/api-client';
import { useIsMutating } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/hooks/useI18n';
import { signOut } from '@/lib/session';

/**
 * Profile tab (spec 003 AC2, AC22): the profile form, privacy, and sign out. Signing out deletes the
 * queue of writes, so with writes waiting it asks first and says how many would be lost.
 */
export default function ProfileTabScreen() {
  const { t, format } = useI18n();
  const router = useRouter();
  const pending = useIsMutating({ mutationKey: weightKeys.mutations });
  const [confirming, setConfirming] = useState(false);
  const p = t.profileTab;

  return (
    <Screen testID="profile-tab-screen">
      <AppText variant="title">{p.title}</AppText>
      <OfflineBanner />
      <Button
        variant="secondary"
        label={p.details}
        onPress={() => router.push('/settings/profile')}
        testID="open-profile"
      />
      <Button
        variant="secondary"
        label={p.privacy}
        onPress={() => router.push('/settings/privacy')}
        testID="open-privacy"
      />
      {confirming && pending > 0 ? (
        <Notice
          tone="warning"
          message={
            pending === 1
              ? p.signOutPendingOne
              : format(p.signOutPendingOther, { count: String(pending) })
          }
          testID="sign-out-pending"
        >
          <Button
            variant="danger"
            label={p.signOutAnyway}
            onPress={() => void signOut()}
            testID="sign-out-anyway"
          />
          <Button variant="ghost" label={p.cancel} onPress={() => setConfirming(false)} />
        </Notice>
      ) : (
        <Button
          variant="ghost"
          label={t.common.signOut}
          onPress={() => (pending > 0 ? setConfirming(true) : void signOut())}
          testID="sign-out"
        />
      )}
    </Screen>
  );
}
