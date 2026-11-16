import type { Food } from '@pt/contracts';
import { allergenNames, formatList } from '@pt/core';
import { openURL } from 'expo-linking';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';

/**
 * What the app says about a product read from Open Food Facts (spec 006 AC5): where its values come
 * from, a prompt to check them when the energy does not match the macros, and the allergens and traces
 * the source declares. Volunteers write that data, so the note always ends with "check the package",
 * and a product without allergen data shows nothing: the app never says a product is free of anything.
 */
export function ProductNotes({ food }: { food: Food }) {
  const { t, format, locale } = useI18n();
  const p = t.food.product;
  if (food.origin !== 'off') return null;

  const names: Record<string, string> = p.allergenNames;
  const list = (tags: readonly string[]) => formatList(allergenNames(tags, names), locale);
  const declared = [
    food.allergens.length > 0 ? format(p.allergens, { list: list(food.allergens) }) : null,
    food.traces.length > 0 ? format(p.traces, { list: list(food.traces) }) : null,
  ].filter((line): line is string => line !== null);
  const { sourceUrl } = food;

  return (
    <>
      {food.energyMismatch ? (
        <Notice tone="warning" message={p.checkValues} testID="product-check-values" />
      ) : null}
      {declared.length > 0 ? (
        <Notice tone="info" testID="product-allergens">
          {declared.map((line) => (
            <AppText key={line} variant="label" weight="regular">
              {line}
            </AppText>
          ))}
          <AppText variant="label" weight="bold">
            {p.checkPackage}
          </AppText>
        </Notice>
      ) : null}
      <AppText variant="caption" tone="muted" testID="product-source">
        {p.source}
      </AppText>
      {sourceUrl ? (
        <Button
          variant="ghost"
          label={p.openSource}
          onPress={() => void openURL(sourceUrl)}
          testID="product-source-link"
        />
      ) : null}
    </>
  );
}
