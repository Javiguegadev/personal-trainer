import type { Profile } from '@pt/contracts';
import { invitesWeighIn, isWeightTrendHidden, weightAverageSeries, weightTrend } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { Notice } from '@/components/Notice';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ProgressReview } from '@/components/ProgressReview';
import { Screen } from '@/components/Screen';
import { TrendSummary } from '@/components/TrendSummary';
import { WeightChart } from '@/components/WeightChart';
import { WeightList } from '@/components/WeightList';
import { TargetsChangeNotice, WeightRejectedNotice } from '@/components/WeightNotices';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useMe, useWeights } from '@/lib/api';

const RANGES = ['30', '90', '365'] as const;
type Range = (typeof RANGES)[number];

/**
 * Progress (spec 003 AC14–AC17, AC24): the logging streak and the weekly review (spec 014 AC9), chart,
 * trend and the list of entries.
 */
export default function ProgressScreen() {
  const me = useMe();
  if (!me.data?.profile) return <BlockingState />;
  return <Progress profile={me.data.profile} />;
}

function Progress({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const today = useToday();
  const weights = useWeights(today);
  const [range, setRange] = useState<Range>('90');
  const p = t.progress;

  const entries = weights.data ?? [];
  const hidden = isWeightTrendHidden(profile.safetyFlags);
  const trend = weightTrend(entries, today);
  const average = hidden ? [] : weightAverageSeries(entries);

  let body;
  if (weights.isPending) {
    body = (
      <ActivityIndicator
        color={colors.primary}
        accessibilityLabel={t.common.loading}
        style={styles.loading}
      />
    );
  } else if (weights.isError && !weights.data) {
    body = (
      <View style={styles.gap}>
        <Notice tone="danger" message={t.weight.card.loadError} />
        <Button variant="secondary" label={t.common.retry} onPress={() => void weights.refetch()} />
      </View>
    );
  } else if (entries.length === 0) {
    body = (
      <View style={styles.empty} testID="progress-empty">
        <AppText variant="subtitle" weight="bold">
          {p.empty.title}
        </AppText>
        {invitesWeighIn(profile.safetyFlags) ? (
          <>
            <AppText tone="muted">{p.empty.text}</AppText>
            <Button
              label={p.empty.button}
              onPress={() => router.push('/weight')}
              testID="log-weight"
            />
          </>
        ) : (
          <>
            <AppText tone="muted">{p.empty.textNeutral}</AppText>
            <Button
              variant="secondary"
              label={p.add}
              onPress={() => router.push('/weight')}
              testID="add-weight"
            />
          </>
        )}
      </View>
    );
  } else {
    body = (
      <>
        <ChoiceGroup
          label={p.range}
          options={RANGES.map((value) => ({ value, label: p.ranges[`days${value}`] }))}
          value={range}
          onChange={setRange}
          testID="progress-range"
        />
        <WeightChart
          entries={entries}
          average={average}
          today={today}
          days={Number(range)}
          units={profile.units}
        />
        <TrendSummary trend={trend} profile={profile} />
        <Button
          variant="secondary"
          label={p.add}
          onPress={() => router.push('/weight')}
          testID="add-weight"
        />
        <WeightList entries={entries} units={profile.units} />
      </>
    );
  }

  return (
    <Screen testID="progress-screen">
      <AppText variant="title">{p.title}</AppText>
      <OfflineBanner />
      <WeightRejectedNotice />
      <TargetsChangeNotice withSafety />
      <ProgressReview today={today} />
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: tokens.space.xl },
  gap: { gap: tokens.space.sm },
  empty: { gap: tokens.space.sm, alignItems: 'flex-start' },
});
