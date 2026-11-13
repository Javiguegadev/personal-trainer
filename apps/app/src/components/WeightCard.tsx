import type { Profile } from '@pt/contracts';
import { formatShortDate, invitesWeighIn } from '@pt/core';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useWeightFormat } from '@/hooks/useWeightFormat';
import { usePendingWeightDates, useWeights } from '@/lib/api';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { Notice } from './Notice';
import { SyncBadge } from './SyncBadge';

/**
 * The weight block of "Today" (spec 003 AC4): the last weight and one action. Protected profiles
 * (eating-disorder signal, pregnancy, 16–17) get a plain link to the log instead of an invitation.
 */
export function WeightCard({ profile }: { profile: Profile }) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const today = useToday();
  const weights = useWeights(today);
  const pending = usePendingWeightDates();
  const fmt = useWeightFormat(profile.units);
  const c = t.weight.card;

  const entries = weights.data ?? [];
  const latest = entries.at(-1) ?? null;
  const todayEntry = entries.find((entry) => entry.localDate === today);

  let action;
  if (!invitesWeighIn(profile.safetyFlags)) {
    action = (
      <Button
        variant="ghost"
        label={c.log}
        onPress={() => router.navigate('/progress')}
        testID="weight-log-link"
      />
    );
  } else if (todayEntry) {
    action = (
      <Button
        variant="secondary"
        label={c.edit}
        onPress={() => router.push({ pathname: '/weight', params: { date: today } })}
        testID="edit-weight"
      />
    );
  } else {
    action = (
      <Button label={c.logToday} onPress={() => router.push('/weight')} testID="log-weight" />
    );
  }

  return (
    <Card
      title={c.title}
      testID="weight-card"
      aside={
        weights.isFetching && !weights.data ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel={t.common.loading} />
        ) : null
      }
    >
      {weights.isError && !weights.data ? (
        <View style={styles.gap}>
          <Notice tone="danger" message={c.loadError} />
          <Button
            variant="secondary"
            label={t.common.retry}
            onPress={() => void weights.refetch()}
          />
        </View>
      ) : (
        <View style={styles.value}>
          <AppText variant="display" testID="weight-card-value">
            {fmt.weight(latest?.weightKg ?? profile.weightKg)}
          </AppText>
          <AppText tone="muted" testID="weight-card-date">
            {latest
              ? latest.localDate === today
                ? c.today
                : format(c.last, { date: formatShortDate(latest.localDate, locale) })
              : c.fromProfile}
          </AppText>
          {latest && pending.includes(latest.localDate) ? <SyncBadge /> : null}
        </View>
      )}
      {action}
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  value: { gap: 4 },
});
