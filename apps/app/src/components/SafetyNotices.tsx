import { formatNumber, type ProfileNotice } from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { Notice } from './Notice';

const TONE: Record<ProfileNotice, 'danger' | 'warning' | 'info'> = {
  pregnancy: 'info',
  ed_soft_stop: 'warning',
  low_bmi: 'warning',
  low_target_bmi: 'warning',
  teen_limited: 'info',
  calorie_floor: 'info',
  medical_condition: 'info',
};

/** Why targets were limited or not shown (AC14, AC18–AC21). Copy in `safety.*`. */
export function SafetyNotices({
  notices,
  floorKcal,
}: {
  notices: readonly ProfileNotice[];
  floorKcal?: number | undefined;
}) {
  const { t, format, locale } = useI18n();
  if (notices.length === 0) return null;
  return (
    <View style={styles.list} testID="safety-notices">
      {notices.map((notice) => (
        <Notice
          key={notice}
          tone={TONE[notice]}
          title={t.safety[notice].title}
          message={format(t.safety[notice].message, {
            floor: floorKcal === undefined ? '' : formatNumber(floorKcal, locale),
          })}
          testID={`notice-${notice}`}
        >
          {notice === 'ed_soft_stop' ? <SupportResources /> : null}
        </Notice>
      ))}
    </View>
  );
}

/** AC20. Helpline numbers are an open question in the spec: confirm them before launch. */
export function SupportResources() {
  const { t } = useI18n();
  const s = t.safety.support;
  return (
    <View style={styles.support} testID="support-resources">
      <AppText variant="label" weight="bold">
        {s.title}
      </AppText>
      {[s.doctor, s.emergency, s.associations].map((line) => (
        <AppText key={line} variant="label" weight="regular">
          • {line}
        </AppText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: tokens.space.sm },
  support: { gap: tokens.space.xs, marginTop: tokens.space.sm },
});
