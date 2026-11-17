import { useI18n } from '@/hooks/useI18n';
import { useDeleteAccount } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { signOut } from '@/lib/session';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';

/** AC17: under 16. Nothing beyond the auth user is stored; the user can delete the account. */
export function AgeBlocked() {
  const { t } = useI18n();
  const remove = useDeleteAccount();
  const copy = t.onboarding.summary.ageBlocked;
  return (
    <>
      <Notice tone="info" title={copy.title} message={copy.message} testID="age-blocked">
        <AppText variant="label" weight="regular">
          {copy.fixDate}
        </AppText>
      </Notice>
      {remove.isError ? <Notice tone="danger" message={errorMessage(remove.error, t)} /> : null}
      <Button
        variant="danger"
        label={copy.deleteAccount}
        loading={remove.isPending}
        onPress={() => remove.mutate(undefined, { onSuccess: () => void signOut() })}
      />
      <Button variant="ghost" label={t.common.signOut} onPress={() => void signOut()} />
    </>
  );
}
