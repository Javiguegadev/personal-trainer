import { formatNumber, formatShortDate } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useRejectedWeightWrite, useWeightTargetsChange } from '@/lib/api';
import { Button } from './Button';
import { Notice } from './Notice';

/**
 * A weight entry that changed the targets (spec 003 AC11): old and new calories, and how they are
 * calculated. Without numeric targets (pregnancy) nothing is said about calories.
 */
export function TargetsChangeNotice() {
  const { t, format, locale } = useI18n();
  const router = useRouter();
  const { change, dismiss } = useWeightTargetsChange();
  if (!change?.previous || !change.current) return null;
  const { previous, current } = change;
  const message =
    previous.kcal === current.kcal
      ? t.today.targetsUpdated
      : format(t.today.targetsChanged, {
          from: formatNumber(previous.kcal, locale),
          to: formatNumber(current.kcal, locale),
        });
  return (
    <Notice tone="info" message={message} testID="targets-change-notice">
      <View style={styles.actions}>
        <Button
          variant="ghost"
          label={t.today.howCalculated}
          onPress={() => router.push('/settings/profile')}
        />
        <Button
          variant="ghost"
          label={t.today.dismiss}
          onPress={dismiss}
          testID="dismiss-targets-change"
        />
      </View>
    </Notice>
  );
}

/** A queued weight write the API refused: it was undone, and this says why (spec 003 AC21). */
export function WeightRejectedNotice() {
  const { t, format, locale } = useI18n();
  const { rejected, dismiss } = useRejectedWeightWrite();
  if (!rejected) return null;
  const [field, code] = Object.entries(rejected.fields)[0] ?? [];
  const formErrors: Record<string, string> = t.onboarding.form.errors;
  const dateErrors: Record<string, string> = t.weight.dateErrors;
  const apiErrors: Record<string, string> = t.errors;
  const reason =
    (field === 'localDate' && code ? dateErrors[code] : undefined) ??
    (code ? formErrors[code] : undefined) ??
    apiErrors[rejected.code] ??
    t.errors.unknown;
  return (
    <Notice
      tone="danger"
      message={format(t.weight.rejected, {
        date: formatShortDate(rejected.localDate, locale),
        reason,
      })}
      testID="weight-rejected-notice"
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
