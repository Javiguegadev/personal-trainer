import type { Nutrients } from '@pt/contracts';
import { formatNumber, remaining, targetProgress, type MacroTargets } from '@pt/core';
import { tokens } from '@pt/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { Card } from './Card';

interface NutritionSummaryCardProps {
  title: string;
  /** Sum of the day's snapshots (`dailyTotals`). */
  totals: Nutrients;
  /** Null without numeric targets (pregnancy): only the eaten totals are shown (AC16). */
  targets: MacroTargets | null;
  /** Why there are no targets, where a notice explains it (Today). */
  noTargetsNote?: string;
  /** Shown at the right of the title (a spinner). */
  aside?: ReactNode;
  /** Actions under the numbers ("Registrar comida", "¿Cómo se calcula?"). */
  children?: ReactNode;
  testID?: string;
}

/**
 * What was eaten against the daily targets (spec 005 AC16): kcal eaten and left, and protein,
 * carbohydrates and fat as eaten / target with a bar. Neutral wording and colours: being above a target
 * is said in words, never in red (the bars share one colour), and every bar has its numbers beside it.
 */
export function NutritionSummaryCard({
  title,
  totals,
  targets,
  noTargetsNote,
  aside,
  children,
  testID = 'nutrition-summary',
}: NutritionSummaryCardProps) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const s = t.food.summary;
  const n = (value: number) => formatNumber(Math.round(value), locale);
  // From the rounded total, so the kcal eaten and the kcal left always add up to the target.
  const left = targets ? remaining(targets, { ...totals, kcal: Math.round(totals.kcal) }).kcal : 0;

  const macros = [
    {
      key: 'protein',
      label: t.targets.protein,
      eaten: totals.proteinG,
      target: targets?.proteinG,
    },
    {
      key: 'carbs',
      label: t.targets.carbs,
      eaten: totals.carbsG,
      target: targets?.carbsG,
    },
    {
      key: 'fat',
      label: t.targets.fat,
      eaten: totals.fatG,
      target: targets?.fatG,
    },
  ];

  return (
    <Card title={title} aside={aside} testID={testID}>
      <View>
        <AppText variant="caption" tone="muted">
          {s.eaten}
        </AppText>
        <View style={styles.kcal}>
          <AppText variant="display" testID="summary-kcal">
            {format(t.food.kcal, { value: n(totals.kcal) })}
          </AppText>
          {targets ? (
            <AppText tone="muted" testID="targets-kcal">
              {format(s.target, { value: formatNumber(targets.kcal, locale) })}
            </AppText>
          ) : null}
        </View>
        {targets ? (
          <AppText weight="semibold" testID="summary-remaining">
            {left >= 0 ? format(s.left, { value: n(left) }) : format(s.over, { value: n(-left) })}
          </AppText>
        ) : null}
      </View>

      <View style={styles.macros}>
        {macros.map((macro) => (
          <View key={macro.key} style={styles.macro} testID={`targets-${macro.key}`}>
            <View style={styles.macroHeader}>
              <AppText variant="label">{macro.label}</AppText>
              <AppText variant="label" weight="bold">
                {macro.target === undefined
                  ? format(s.macroEaten, { eaten: n(macro.eaten) })
                  : format(s.macro, { eaten: n(macro.eaten), target: n(macro.target) })}
              </AppText>
            </View>
            {macro.target === undefined ? null : (
              <View
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={macro.target}
                aria-valuenow={Math.round(macro.eaten)}
                accessibilityLabel={format(s.macroProgress, {
                  label: macro.label,
                  eaten: n(macro.eaten),
                  target: n(macro.target),
                })}
                style={[styles.track, { backgroundColor: colors.surfaceMuted }]}
              >
                <View
                  style={[
                    styles.fill,
                    {
                      backgroundColor: colors.primary,
                      width: `${targetProgress(macro.eaten, macro.target) * 100}%`,
                    },
                  ]}
                />
              </View>
            )}
          </View>
        ))}
      </View>

      {!targets && noTargetsNote ? (
        <AppText variant="caption" tone="muted" testID="targets-none">
          {noTargetsNote}
        </AppText>
      ) : null}
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  kcal: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: tokens.space.sm,
  },
  macros: { gap: tokens.space.sm },
  macro: { gap: tokens.space.xs },
  macroHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: tokens.space.sm },
  track: { height: 8, borderRadius: tokens.radius.full, overflow: 'hidden' },
  fill: { height: 8, borderRadius: tokens.radius.full },
});
