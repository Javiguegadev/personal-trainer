import type { Targets, TargetsBreakdown } from '@pt/contracts';
import { formatNumber } from '@pt/core';
import { tokens } from '@pt/ui';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';

export type TargetsCardProps =
  | { status: 'incomplete' }
  | { status: 'loading' }
  | { status: 'error'; message: string; onRetry: () => void }
  /** `targets` is null when safety rules forbid numbers (pregnancy): the notices explain why. */
  | {
      status: 'ready';
      targets: Targets | null;
      breakdown: TargetsBreakdown | null;
      /** A newer preview is loading; the numbers shown are the previous ones. */
      refreshing?: boolean;
    };

/** Daily targets computed by @pt/core (never by the AI), with "How is this calculated?" (AC15). */
export function TargetsCard(props: TargetsCardProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID="targets-card"
    >
      <View style={styles.header}>
        <AppText variant="subtitle" weight="bold" accessibilityRole="header">
          {t.targets.title}
        </AppText>
        {props.status === 'loading' || (props.status === 'ready' && props.refreshing) ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel={t.targets.calculating} />
        ) : null}
      </View>
      <TargetsBody {...props} />
    </View>
  );
}

function TargetsBody(props: TargetsCardProps) {
  const { t } = useI18n();
  switch (props.status) {
    case 'incomplete':
      return <AppText tone="muted">{t.targets.incomplete}</AppText>;
    case 'loading':
      return <AppText tone="muted">{t.targets.calculating}</AppText>;
    case 'error':
      return (
        <View style={styles.gap}>
          <Notice tone="danger" title={t.targets.previewError} message={props.message} />
          <Button variant="secondary" label={t.common.retry} onPress={props.onRetry} />
        </View>
      );
    case 'ready':
      return props.targets ? (
        <TargetNumbers targets={props.targets} breakdown={props.breakdown} />
      ) : null;
  }
}

function TargetNumbers({
  targets,
  breakdown,
}: {
  targets: Targets;
  breakdown: TargetsBreakdown | null;
}) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const grams = (value: number) =>
    format(t.targets.gramsValue, { value: formatNumber(value, locale) });
  const macros = [
    {
      key: 'protein',
      label: t.targets.protein,
      value: grams(targets.proteinG),
      color: tokens.color.protein,
    },
    {
      key: 'carbs',
      label: t.targets.carbs,
      value: grams(targets.carbsG),
      color: tokens.color.carbs,
    },
    { key: 'fat', label: t.targets.fat, value: grams(targets.fatG), color: tokens.color.fat },
    { key: 'fiber', label: t.targets.fiber, value: grams(targets.fiberG), color: colors.textMuted },
  ];

  return (
    <View style={styles.gap}>
      <View>
        <AppText variant="caption" tone="muted">
          {t.targets.kcal}
        </AppText>
        <AppText variant="display" testID="targets-kcal">
          {format(t.targets.kcalValue, { value: formatNumber(targets.kcal, locale) })}
        </AppText>
      </View>
      <View style={styles.macros}>
        {macros.map((macro) => (
          <View
            key={macro.key}
            style={[styles.macro, { backgroundColor: colors.surfaceMuted }]}
            testID={`targets-${macro.key}`}
          >
            <View style={[styles.swatch, { backgroundColor: macro.color }]} />
            <AppText variant="caption" tone="muted">
              {macro.label}
            </AppText>
            <AppText weight="bold">{macro.value}</AppText>
          </View>
        ))}
      </View>
      {breakdown ? (
        <>
          <Button
            variant="ghost"
            label={open ? t.targets.hideCalculation : t.targets.howCalculated}
            onPress={() => setOpen(!open)}
            testID="how-calculated"
          />
          {open ? <Breakdown targets={targets} breakdown={breakdown} /> : null}
        </>
      ) : null}
    </View>
  );
}

function Breakdown({ targets, breakdown }: { targets: Targets; breakdown: TargetsBreakdown }) {
  const { t, format, locale } = useI18n();
  const b = t.targets.breakdown;
  const n = (value: number, decimals = 0) => formatNumber(value, locale, decimals);
  const signed = (value: number) =>
    value > 0 ? `+${n(value)}` : value < 0 ? `−${n(Math.abs(value))}` : n(0);
  const lines = [
    format(b.bmr, { age: breakdown.ageYears, value: n(breakdown.bmrKcal) }),
    format(b.tdee, {
      bmr: n(breakdown.bmrKcal),
      factor: n(breakdown.activityFactor, 3),
      value: n(breakdown.tdeeKcal),
    }),
    format(b.adjustment, { value: signed(breakdown.goalAdjustmentKcal) }),
    format(b.floor, { value: n(breakdown.floorKcal) }),
    format(b.protein, {
      perKg: n(breakdown.proteinGPerKg, 1),
      weight: n(breakdown.referenceWeightKg, 1),
    }),
    b.fat,
    b.carbs,
    b.fiber,
  ];
  return (
    <View style={styles.breakdown} testID="targets-breakdown">
      {lines.map((line) => (
        <AppText key={line} variant="label" weight="regular">
          • {line}
        </AppText>
      ))}
      <AppText variant="label" weight="bold">
        {b.sources}
      </AppText>
      <AppText variant="caption" tone="muted">
        {b.sourceList}
      </AppText>
      <AppText variant="caption" tone="muted">
        {format(b.version, { version: targets.formulaVersion })}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.md,
    gap: tokens.space.md,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gap: { gap: tokens.space.md },
  macros: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
  macro: {
    flexGrow: 1,
    flexBasis: '45%',
    borderRadius: tokens.radius.md,
    padding: tokens.space.sm,
    gap: 2,
  },
  swatch: { width: 24, height: 4, borderRadius: 2, marginBottom: 2 },
  breakdown: { gap: tokens.space.xs },
});
