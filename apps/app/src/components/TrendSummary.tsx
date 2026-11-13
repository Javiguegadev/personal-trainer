import type { Profile, WeightTrend } from '@pt/contracts';
import {
  formatShortDate,
  isWeightTrendHidden,
  targetWeightProgress,
  weightNotices,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useWeightFormat } from '@/hooks/useWeightFormat';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';

/**
 * The trend under the chart (spec 003 AC15, AC16, AC24): 7-day average and change per week, distance to
 * the target weight, and the "losing fast" notice. Protected profiles see none of it.
 */
export function TrendSummary({ trend, profile }: { trend: WeightTrend; profile: Profile }) {
  const { t, format, locale } = useI18n();
  const router = useRouter();
  const fmt = useWeightFormat(profile.units);
  const p = t.progress;
  const flags = profile.safetyFlags;
  if (isWeightTrendHidden(flags) || !trend.last) return null;

  const target = targetWeightProgress(trend, profile.targetWeightKg, profile.requestedGoal, flags);
  return (
    <View style={styles.list} testID="trend-summary">
      {weightNotices(trend, flags).map((notice) => (
        <Notice
          key={notice}
          tone="warning"
          title={t.safety[notice].title}
          message={t.safety[notice].message}
          testID={`notice-${notice}`}
        />
      ))}
      {trend.averageKg === null ? (
        <>
          <AppText testID="trend-last">
            {format(p.last, {
              value: fmt.weight(trend.last.weightKg),
              date: formatShortDate(trend.last.localDate, locale),
            })}
          </AppText>
          <AppText variant="caption" tone="muted">
            {p.needsEntries}
          </AppText>
        </>
      ) : (
        <>
          <AppText weight="semibold" testID="trend-average">
            {format(p.average, { value: fmt.weight(trend.averageKg) })}
          </AppText>
          {trend.changePerWeekKg === null ? (
            <AppText variant="caption" tone="muted">
              {p.needsTwoWeeks}
            </AppText>
          ) : (
            <AppText testID="trend-change">
              {format(p.change, { value: fmt.change(trend.changePerWeekKg) })}
            </AppText>
          )}
        </>
      )}
      {target.kind === 'distance' && profile.targetWeightKg !== null ? (
        <AppText testID="trend-target">
          {format(p.targetDistance, {
            value: fmt.distance(target.kg),
            target: fmt.weight(profile.targetWeightKg),
          })}
        </AppText>
      ) : null}
      {target.kind === 'reached' ? (
        <View style={styles.reached} testID="trend-target-reached">
          <AppText weight="semibold">✓ {p.targetReached}</AppText>
          <Button
            variant="ghost"
            label={p.reviewGoal}
            onPress={() => router.push('/settings/profile')}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: tokens.space.xs },
  reached: { gap: tokens.space.xs, alignItems: 'flex-start' },
});
