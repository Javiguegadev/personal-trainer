import { formatNumber } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useCalibrationTargetsChange, useMe } from '@/lib/api';
import { Button } from './Button';
import { Notice } from './Notice';

/**
 * After "Aplicar" or "Volver al cálculo inicial" (spec 014 AC6, AC12): the old and new calories, as
 * after a weight change (ADR 005), and how they are calculated. With an eating-disorder signal the
 * calories are not shown in numbers (spec 003 AC11).
 */
export function CalibrationNotice() {
  const { t, format, locale } = useI18n();
  const router = useRouter();
  const { change, dismiss } = useCalibrationTargetsChange();
  const flags = useMe({ enabled: false }).data?.profile?.safetyFlags ?? [];
  if (!change) return null;
  const { previous, current } = change;
  const numbers =
    previous && current && previous.kcal !== current.kcal && !flags.includes('ed_soft_stop');
  return (
    <Notice
      tone="info"
      message={
        numbers
          ? format(t.review.targetsChanged, {
              from: formatNumber(previous.kcal, locale),
              to: formatNumber(current.kcal, locale),
            })
          : t.review.targetsUpdated
      }
      testID="calibration-change-notice"
    >
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
          testID="dismiss-calibration-change"
        />
      </View>
    </Notice>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
