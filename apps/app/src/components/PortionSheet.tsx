import { FOOD_LOG_LIMITS, type Food, type Portion } from '@pt/contracts';
import {
  formatDecimal,
  formatNumber,
  gramsFieldFromPortion,
  parseGramsField,
  portionPreview,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { Button } from './Button';
import { ChoiceGroup } from './ChoiceGroup';
import { FavouriteStar } from './FoodRow';
import { Screen } from './Screen';
import { Stepper } from './Stepper';
import { TextField } from './TextField';

const GRAMS = 'grams';

interface PortionSheetProps {
  food: Food;
  /** The portion preselected (`initialPortion`): the first serving, or the one used the last time. */
  initial: Portion;
  favourite: boolean;
  onToggleFavourite: () => void;
  /** False with an eating-disorder signal: grams only, no kcal or macros (AC18). */
  showNumbers: boolean;
  submitLabel: string;
  onSubmit: (portion: Portion) => void;
  onCancel: () => void;
  /** More fields under the portion (the meal and "Delete" when editing an item). */
  children?: ReactNode;
  testID?: string;
}

/**
 * The portion of a food (spec 005 AC8): its household servings as chips with a stepper of half servings,
 * or grams; it previews what the portion adds, and the buttons stay above the keyboard (Screen footer).
 */
export function PortionSheet({
  food,
  initial,
  favourite,
  onToggleFavourite,
  showNumbers,
  submitLabel,
  onSubmit,
  onCancel,
  children,
  testID = 'portion-sheet',
}: PortionSheetProps) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const p = t.food.portion;
  const [choice, setChoice] = useState<string>(
    initial.kind === 'serving' ? initial.servingId : GRAMS,
  );
  const [servings, setServings] = useState(initial.kind === 'serving' ? initial.servings : 1);
  const [gramsText, setGramsText] = useState(
    initial.kind === 'grams' ? formatDecimal(initial.grams, locale, 1) : '',
  );
  const [gramsError, setGramsError] = useState<string | null>(null);

  const parsedGrams = parseGramsField(gramsText);
  const portion: Portion | null =
    choice !== GRAMS
      ? { kind: 'serving', servingId: choice, servings }
      : parsedGrams.ok
        ? { kind: 'grams', grams: parsedGrams.grams }
        : null;
  const preview = portion ? portionPreview(food, portion) : null;

  const choose = (next: string) => {
    // "Gramos" starts from the grams of the portion chosen so far.
    if (next === GRAMS && portion?.kind === 'serving') {
      setGramsText(gramsFieldFromPortion(food, portion, locale));
    }
    setChoice(next);
    setGramsError(null);
  };

  const submit = () => {
    if (portion) return onSubmit(portion);
    const formErrors: Record<string, string> = t.onboarding.form.errors;
    setGramsError(
      (parsedGrams.ok ? undefined : formErrors[parsedGrams.error]) ?? t.errors.validation_error,
    );
  };

  const n = (value: number, decimals = 0) => formatNumber(value, locale, decimals);
  const macros = preview
    ? [
        { key: 'protein', label: t.targets.protein, value: preview.nutrients.proteinG },
        { key: 'carbs', label: t.targets.carbs, value: preview.nutrients.carbsG },
        { key: 'fat', label: t.targets.fat, value: preview.nutrients.fatG },
      ]
    : [];

  return (
    <Screen
      testID={testID}
      footer={
        <>
          <Button label={submitLabel} onPress={submit} testID="portion-submit" />
          <Button variant="ghost" label={p.cancel} onPress={onCancel} testID="portion-cancel" />
        </>
      }
    >
      <View style={styles.header}>
        <AppText variant="title" style={styles.name}>
          {food.name}
        </AppText>
        <FavouriteStar
          name={food.name}
          favourite={favourite}
          onToggle={onToggleFavourite}
          testID="portion-star"
        />
      </View>

      <ChoiceGroup
        label={p.serving}
        options={[
          ...food.servings.map((serving) => ({
            value: serving.id,
            label: format(p.servingOption, { label: serving.label, grams: n(serving.grams, 1) }),
          })),
          { value: GRAMS, label: p.grams },
        ]}
        value={choice}
        onChange={choose}
        testID="portion-serving"
      />

      {choice === GRAMS ? (
        <TextField
          label={p.grams}
          value={gramsText}
          onChangeText={(text) => {
            setGramsText(text);
            setGramsError(null);
          }}
          error={gramsError}
          keyboardType="decimal-pad"
          inputMode="decimal"
          selectTextOnFocus
          autoFocus
          testID="portion-grams"
        />
      ) : (
        <Stepper
          label={p.quantity}
          value={servings}
          min={FOOD_LOG_LIMITS.servingsMin}
          max={FOOD_LOG_LIMITS.servingsMax}
          step={FOOD_LOG_LIMITS.servingsStep}
          formatValue={(value) => formatDecimal(value, locale, 1)}
          onChange={setServings}
          decreaseLabel={p.decrease}
          increaseLabel={p.increase}
          testID="portion-quantity"
        />
      )}

      <View
        style={[styles.preview, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityLiveRegion="polite"
        aria-live="polite"
        testID="portion-preview"
      >
        {showNumbers ? (
          <AppText variant="title" testID="portion-kcal">
            {preview ? format(t.food.kcal, { value: n(Math.round(preview.nutrients.kcal)) }) : '—'}
          </AppText>
        ) : null}
        <AppText tone="muted" testID="portion-total">
          {preview ? format(p.total, { grams: n(preview.grams, 1) }) : '—'}
        </AppText>
        {showNumbers && preview ? (
          <View style={styles.macros}>
            {macros.map((macro) => (
              <View
                key={macro.key}
                style={[styles.macro, { borderTopColor: colors.border }]}
                testID={`portion-${macro.key}`}
              >
                <AppText variant="label" weight="regular" tone="muted">
                  {macro.label}
                </AppText>
                <AppText weight="bold">
                  {format(t.targets.gramsValue, { value: n(macro.value, 1) })}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space.sm },
  name: { flex: 1 },
  preview: {
    borderWidth: 1,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.md,
    gap: tokens.space.xs,
  },
  macros: { marginTop: tokens.space.xs },
  macro: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
