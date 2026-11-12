import type { OnboardingDraft, Units } from '@pt/contracts';
import { cmToFeetInches, computeAge, formatNumber, kgToLb } from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

/** What the chat has collected so far (AC8), in the user's units. Values come from @pt/core. */
export function DraftChips({
  draft,
  units,
  today,
}: {
  draft: OnboardingDraft;
  units: Units;
  today: string;
}) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const f = t.onboarding.form;
  const n = (value: number, decimals = 0) => formatNumber(value, locale, decimals);

  const height =
    draft.heightCm === undefined
      ? null
      : units === 'imperial'
        ? (({ feet, inches }) => `${feet} ft ${inches} in`)(cmToFeetInches(draft.heightCm))
        : `${n(draft.heightCm, 1)} cm`;
  const weight =
    draft.weightKg === undefined
      ? null
      : units === 'imperial'
        ? `${n(kgToLb(draft.weightKg))} lb`
        : `${n(draft.weightKg, 1)} kg`;

  const chips = [
    draft.sex && f.sexOptions[draft.sex],
    draft.birthDate &&
      format(t.onboarding.chat.ageYears, { age: computeAge(draft.birthDate, today) }),
    height,
    weight,
    draft.activityLevel && f.activityOptions[draft.activityLevel],
    draft.goal && f.goalOptions[draft.goal],
    draft.dietType && f.dietOptions[draft.dietType],
    ...(draft.allergies ?? []),
  ].filter((chip): chip is string => Boolean(chip));

  if (chips.length === 0) return null;
  return (
    <View style={styles.wrap} testID="draft-chips">
      <AppText variant="caption" tone="muted">
        {t.onboarding.chat.collected}
      </AppText>
      <View style={styles.chips}>
        {chips.map((chip) => (
          <View key={chip} style={[styles.chip, { backgroundColor: colors.surfaceMuted }]}>
            <AppText variant="caption" weight="semibold">
              {chip}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: tokens.space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs },
  chip: {
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 2,
  },
});
