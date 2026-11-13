import type { Units, WeightEntry } from '@pt/contracts';
import { formatShortDate } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useWeightFormat } from '@/hooks/useWeightFormat';
import { useDeleteWeight, usePendingWeightDates } from '@/lib/api';
import { AppText } from './AppText';
import { SyncBadge } from './SyncBadge';

/** Every entry, newest first, with edit and delete (spec 003 AC9, AC14). Also the chart's table view. */
export function WeightList({ entries, units }: { entries: readonly WeightEntry[]; units: Units }) {
  const { t } = useI18n();
  const newestFirst = [...entries].reverse();
  return (
    <View style={styles.list} testID="weight-list">
      <AppText variant="subtitle" weight="bold" accessibilityRole="header">
        {t.progress.list}
      </AppText>
      {newestFirst.map((entry) => (
        <WeightRow key={entry.localDate} entry={entry} units={units} />
      ))}
    </View>
  );
}

function WeightRow({ entry, units }: { entry: WeightEntry; units: Units }) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const today = useToday();
  const fmt = useWeightFormat(units);
  const pending = usePendingWeightDates();
  const remove = useDeleteWeight();
  const [confirming, setConfirming] = useState(false);
  const p = t.progress;
  const date = formatShortDate(
    entry.localDate,
    locale,
    entry.localDate.slice(0, 4) !== today.slice(0, 4),
  );

  return (
    <View
      style={[styles.row, { borderColor: colors.border }]}
      testID={`weight-row-${entry.localDate}`}
    >
      <View style={styles.main}>
        <AppText tone="muted">{date}</AppText>
        <AppText weight="bold" testID={`weight-row-${entry.localDate}-value`}>
          {fmt.weight(entry.weightKg)}
        </AppText>
        {pending.includes(entry.localDate) ? <SyncBadge /> : null}
      </View>
      {confirming ? (
        <View style={styles.actions}>
          <AppText variant="label">{p.deleteConfirm}</AppText>
          <RowAction
            label={p.deleteYes}
            tone="danger"
            onPress={() => {
              setConfirming(false);
              remove.mutate({ localDate: entry.localDate, today });
            }}
            testID={`weight-row-${entry.localDate}-delete-yes`}
          />
          <RowAction label={p.cancel} onPress={() => setConfirming(false)} />
        </View>
      ) : (
        <View style={styles.actions}>
          <RowAction
            label={p.edit}
            accessibilityLabel={format(p.editEntry, { date })}
            onPress={() => router.push({ pathname: '/weight', params: { date: entry.localDate } })}
            testID={`weight-row-${entry.localDate}-edit`}
          />
          <RowAction
            label={p.delete}
            accessibilityLabel={format(p.deleteEntry, { date })}
            tone="danger"
            onPress={() => setConfirming(true)}
            testID={`weight-row-${entry.localDate}-delete`}
          />
        </View>
      )}
    </View>
  );
}

/** A compact text button that still has a 48 px touch target. */
function RowAction({
  label,
  accessibilityLabel,
  tone = 'primary',
  onPress,
  testID,
}: {
  label: string;
  accessibilityLabel?: string;
  tone?: 'primary' | 'danger';
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      role="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
    >
      <AppText variant="label" weight="bold" tone={tone}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: tokens.space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: tokens.space.xs,
  },
  main: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: tokens.space.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs },
  action: {
    minHeight: tokens.layout.minTouchTarget,
    minWidth: tokens.layout.minTouchTarget,
    paddingHorizontal: tokens.space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
