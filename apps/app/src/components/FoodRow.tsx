import type { Food, Portion } from '@pt/contracts';
import { formatNumber, formatPortion, portionPreview } from '@pt/core';
import { tokens } from '@pt/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

interface FoodRowProps {
  food: Food;
  /** The portion the sheet will open with: the default serving, or the one used the last time. */
  portion: Portion;
  /** False with an eating-disorder signal: no kcal (AC18). */
  showNumbers: boolean;
  favourite: boolean;
  onPress: () => void;
  onToggleFavourite: () => void;
}

/** A catalog food in search results, recents or favourites: name, portion, kcal and its star (AC14). */
export function FoodRow({
  food,
  portion,
  showNumbers,
  favourite,
  onPress,
  onToggleFavourite,
}: FoodRowProps) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const preview = portionPreview(food, portion);
  const portionText = preview ? formatPortion(preview, locale) : null;
  const detail =
    preview && portionText && showNumbers
      ? format(t.food.add.portionKcal, {
          portion: portionText,
          kcal: formatNumber(Math.round(preview.nutrients.kcal), locale),
        })
      : portionText;

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]} testID={`food-${food.key}`}>
      <Pressable
        role="button"
        accessibilityLabel={detail ? `${food.name}. ${detail}` : food.name}
        onPress={onPress}
        testID={`food-${food.key}-open`}
        style={({ pressed }) => [styles.main, { opacity: pressed ? 0.6 : 1 }]}
      >
        <AppText>{food.name}</AppText>
        {detail ? (
          <AppText variant="caption" tone="muted">
            {detail}
          </AppText>
        ) : null}
      </Pressable>
      <FavouriteStar
        name={food.name}
        favourite={favourite}
        onToggle={onToggleFavourite}
        testID={`food-${food.key}-star`}
      />
    </View>
  );
}

/** The star of a food (AC14): filled when it is a favourite, so it is not read by colour alone. */
export function FavouriteStar({
  name,
  favourite,
  onToggle,
  testID,
}: {
  name: string;
  favourite: boolean;
  onToggle: () => void;
  testID?: string;
}) {
  const { t, format } = useI18n();
  return (
    <Pressable
      role="button"
      aria-pressed={favourite}
      accessibilityLabel={format(favourite ? t.food.add.unstar : t.food.add.star, { food: name })}
      onPress={onToggle}
      testID={testID}
      style={({ pressed }) => [styles.star, { opacity: pressed ? 0.6 : 1 }]}
    >
      <AppText variant="subtitle" tone={favourite ? 'primary' : 'muted'}>
        {favourite ? '★' : '☆'}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: {
    flex: 1,
    minHeight: tokens.layout.minTouchTarget,
    justifyContent: 'center',
    paddingVertical: tokens.space.sm,
    gap: 2,
  },
  star: {
    width: tokens.layout.minTouchTarget,
    height: tokens.layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
