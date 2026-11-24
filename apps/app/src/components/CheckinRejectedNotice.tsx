import { formatShortDate } from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useRejectedCheckinWrite } from '@/lib/api';
import { Button } from './Button';
import { Notice } from './Notice';

/** A queued check-in write the API refused: it was undone, and this says why (spec 011 AC14). */
export function CheckinRejectedNotice() {
  const { t, format, locale } = useI18n();
  const { rejected, dismiss } = useRejectedCheckinWrite();
  if (!rejected) return null;
  const code = Object.values(rejected.fields)[0];
  const formErrors: Record<string, string> = t.onboarding.form.errors;
  const apiErrors: Record<string, string> = t.errors;
  const reason =
    (code ? formErrors[code] : undefined) ?? apiErrors[rejected.code] ?? t.errors.unknown;
  return (
    <Notice
      tone="danger"
      message={format(t.checkin.rejected, {
        date: formatShortDate(rejected.localDate, locale),
        reason,
      })}
      testID="checkin-rejected-notice"
    >
      <View style={styles.actions}>
        <Button variant="ghost" label={t.today.dismiss} onPress={dismiss} />
      </View>
    </Notice>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
