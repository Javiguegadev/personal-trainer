import { MEAL_TYPES, type MealItem } from '@pt/contracts';
import {
  formatNumber,
  formatPortion,
  initialPortion,
  itemPortion,
  showsFoodNumbers,
} from '@pt/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { Notice } from '@/components/Notice';
import { PortionSheet } from '@/components/PortionSheet';
import { Screen } from '@/components/Screen';
import { useFoodLogActions } from '@/hooks/useFoodLogActions';
import { useI18n } from '@/hooks/useI18n';
import { useToday } from '@/hooks/useToday';
import { useFavouriteFoods, useFood, useFoodLog, useMe, useSetFavouriteFood } from '@/lib/api';

/** A logged item (spec 005 AC11), opened over the tabs: change its portion or its meal, or delete it. */
export default function FoodItemRoute() {
  const { t } = useI18n();
  const router = useRouter();
  const me = useMe();
  const today = useToday();
  const log = useFoodLog(today);
  const { id } = useLocalSearchParams<{ id: string }>();
  const found = log.data?.find((item) => item.id === id);
  // A deleted item leaves the log at once: keep showing it while the sheet closes.
  const [last, setLast] = useState(found);
  if (found && found !== last) setLast(found);
  const item = found ?? last;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/food'));

  if (!me.data?.profile || log.isPending) return <BlockingState />;
  if (!item) {
    return (
      <Screen testID="food-item-sheet">
        <Notice tone="info" message={t.food.item.notFound} testID="food-item-missing" />
        <Button variant="secondary" label={t.food.item.close} onPress={close} />
      </Screen>
    );
  }
  return (
    <ItemEditor
      item={item}
      showNumbers={showsFoodNumbers(me.data.profile.safetyFlags)}
      close={close}
    />
  );
}

function ItemEditor({
  item,
  showNumbers,
  close,
}: {
  item: MealItem;
  showNumbers: boolean;
  close: () => void;
}) {
  const { t, format, locale } = useI18n();
  const actions = useFoodLogActions();
  const setFavourite = useSetFavouriteFood();
  const favourites = useFavouriteFoods(locale);
  const portion = itemPortion(item);
  // The servings come from the catalog: a quick add, or a food that left it, has none.
  const food = useFood(portion ? item.foodId : null, locale);
  const [mealType, setMealType] = useState(item.mealType);
  const i = t.food.item;

  const extras = (
    <>
      <ChoiceGroup
        label={i.meal}
        options={MEAL_TYPES.map((value) => ({ value, label: t.food.meals[value] }))}
        value={mealType}
        onChange={setMealType}
        testID="item-meal"
      />
      <Button
        variant="secondary"
        label={i.delete}
        onPress={() => {
          actions.remove(item);
          close();
        }}
        testID="delete-item"
      />
    </>
  );

  if (portion && food.data) {
    const catalogFood = food.data;
    const favourite = favourites.data?.some((f) => f.id === catalogFood.id) ?? false;
    return (
      <PortionSheet
        food={catalogFood}
        initial={initialPortion(catalogFood, portion)}
        favourite={favourite}
        onToggleFavourite={() =>
          setFavourite.mutate({ food: catalogFood, favourite: !favourite, locale })
        }
        showNumbers={showNumbers}
        submitLabel={t.food.portion.save}
        onSubmit={(next) => {
          actions.changePortion(item, catalogFood, next, mealType);
          close();
        }}
        onCancel={close}
        testID="food-item-sheet"
      >
        {extras}
      </PortionSheet>
    );
  }
  if (food.isLoading) return <BlockingState />;

  const portionText = formatPortion(item, locale);
  return (
    <Screen
      testID="food-item-sheet"
      footer={
        <>
          <Button
            label={t.food.portion.save}
            onPress={() => {
              if (mealType !== item.mealType) actions.move(item, mealType);
              close();
            }}
            testID="portion-submit"
          />
          <Button
            variant="ghost"
            label={t.food.portion.cancel}
            onPress={close}
            testID="portion-cancel"
          />
        </>
      }
    >
      <AppText variant="title">{item.label}</AppText>
      {portionText ? <AppText tone="muted">{portionText}</AppText> : null}
      {showNumbers ? (
        <AppText weight="bold">
          {format(t.food.kcal, { value: formatNumber(Math.round(item.nutrients.kcal), locale) })}
        </AppText>
      ) : null}
      <Notice
        tone="info"
        message={portion && item.foodId ? i.foodError : i.moveOnly}
        testID="food-item-move-only"
      />
      {extras}
    </Screen>
  );
}
