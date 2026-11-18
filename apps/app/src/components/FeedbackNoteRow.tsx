import type {
  FeedbackNote,
  FeedbackObservationKind,
  FeedbackState,
  FeedbackSuggestion,
  MealType,
} from '@pt/contracts';
import { formatNumber } from '@pt/core';
import { tokens } from '@pt/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

/** A neutral mark per kind, beside the text (decorative: the text says it all). */
const MARK: Record<FeedbackObservationKind, string> = {
  day_incomplete: '✎',
  protein_low: '🥚',
  protein_gap: '🥚',
  protein_uneven: '🥚',
  kcal_low: '⚡',
  kcal_above: '⚡',
  fiber_low: '🌾',
  fiber_gap: '🌾',
  carbs_low_training: '🍚',
  carbs_gap_training: '🍚',
  on_track: '✓',
};

/**
 * One note of the daily feedback (spec 008 AC13, AC16): the text (the AI's, or the fixed wording with
 * core's numbers), a chip with the numbers, and the suggested foods. On a day in progress a suggestion
 * opens the add screen on the next meal; on a closed day it is a "next time" line. Same look for every
 * kind: no red, no score (ADR 006).
 */
export function FeedbackNoteRow({
  note,
  state,
  onSuggest,
  index,
}: {
  note: FeedbackNote;
  state: FeedbackState;
  onSuggest: (suggestion: FeedbackSuggestion, meal: MealType) => void;
  index: number;
}) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const f = t.feedback;
  const { kind, numbers } = note.observation;
  const n = (value: number) => formatNumber(value, locale);
  const mealName = (meal: MealType) => t.food.meals[meal];
  const meals = numbers.mealsLeft.map((meal) => mealName(meal).toLowerCase()).join(f.and);
  const text =
    note.text ??
    format(f.template[kind], {
      meals,
      eaten: numbers.eaten === null ? '' : n(numbers.eaten),
      target: numbers.target === null ? '' : n(numbers.target),
      left: numbers.left === null ? '' : n(numbers.left),
    });

  const chips: { label: string; a11y: string }[] = [];
  if (kind === 'protein_uneven') {
    for (const { mealType, grams } of numbers.perMeal) {
      const values = { meal: mealName(mealType), grams: n(grams) };
      chips.push({ label: format(f.perMeal, values), a11y: format(f.perMealLabel, values) });
    }
  } else if (numbers.nutrient && numbers.eaten !== null && numbers.target !== null) {
    const kcal = numbers.nutrient === 'kcal';
    const values = {
      nutrient: f.nutrients[numbers.nutrient],
      eaten: n(numbers.eaten),
      target: n(numbers.target),
      unit: kcal ? f.units.kcal : f.units.g,
    };
    chips.push({
      label: format(f.chip, values),
      a11y: format(f.chipLabel, {
        ...values,
        nutrient: values.nutrient.toLowerCase(),
        unitLong: kcal ? f.units.kcalLong : f.units.gLong,
      }),
    });
  }

  const nextMeal = state === 'in_progress' ? numbers.mealsLeft[0] : undefined;
  return (
    <View style={styles.row} testID={`feedback-note-${kind}`}>
      <View style={styles.header}>
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden
          style={styles.mark}
        >
          {MARK[kind]}
        </AppText>
        <AppText style={styles.text} testID={`feedback-text-${index}`}>
          {text}
        </AppText>
      </View>
      {chips.length > 0 ? (
        <View style={styles.chips}>
          {chips.map((chip) => (
            <View
              key={chip.label}
              accessible
              accessibilityLabel={chip.a11y}
              style={[styles.chip, { backgroundColor: colors.surfaceMuted }]}
              testID="feedback-chip"
            >
              <AppText variant="caption" weight="semibold">
                {chip.label}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
      {note.suggestions.length > 0 && nextMeal ? (
        <View style={styles.chips}>
          {note.suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.food.id}
              accessibilityRole="button"
              accessibilityLabel={format(f.suggestion, {
                food: suggestion.food.name,
                meal: mealName(nextMeal).toLowerCase(),
              })}
              onPress={() => onSuggest(suggestion, nextMeal)}
              style={({ pressed }) => [
                styles.suggestion,
                { borderColor: colors.primary, opacity: pressed ? 0.7 : 1 },
              ]}
              testID="feedback-suggestion"
            >
              <AppText variant="label" tone="primary">
                {`+ ${suggestion.food.name}`}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
      {note.suggestions.length > 0 && !nextMeal ? (
        <AppText variant="caption" tone="muted" testID="feedback-next-time">
          {format(f.nextTime, {
            foods: note.suggestions.map((s) => s.food.name).join(', '),
          })}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: tokens.space.xs },
  header: { flexDirection: 'row', gap: tokens.space.sm, alignItems: 'flex-start' },
  mark: { width: 24, textAlign: 'center' },
  text: { flex: 1 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.space.xs,
    paddingLeft: 24 + tokens.space.sm,
  },
  chip: {
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 2,
  },
  suggestion: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.space.md,
  },
});
