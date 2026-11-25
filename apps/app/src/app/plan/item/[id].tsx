import type { PlannedMealItem } from '@pt/contracts';
import {
  formatLongDate,
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
import { Notice } from '@/components/Notice';
import { PortionSheet } from '@/components/PortionSheet';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/hooks/useI18n';
import { usePlanActions } from '@/hooks/usePlanActions';
import { useToday } from '@/hooks/useToday';
import { useFavouriteFoods, useFood, useMe, usePlan, useSetFavouriteFood } from '@/lib/api';

/**
 * A planned item (spec 013 AC9), opened over the tabs. On today or a past day: the portion sheet with
 * the planned portion, "Registrar" (the portion can be changed first) and "Quitar del plan" with an
 * undo. A planned item of a future day cannot be logged.
 */
export default function PlannedItemRoute() {
  const { t } = useI18n();
  const router = useRouter();
  const me = useMe();
  const today = useToday();
  const plan = usePlan(today);
  const { id } = useLocalSearchParams<{ id: string }>();
  const found = plan.data?.mealItems.find((item) => item.id === id);
  // A removed item leaves the plan at once: keep showing it while the sheet closes.
  const [last, setLast] = useState(found);
  if (found && found !== last) setLast(found);
  const item = found ?? last;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/food'));

  if (!me.data?.profile || plan.isPending) return <BlockingState />;
  if (!item) {
    return (
      <Screen testID="plan-item-sheet">
        <Notice tone="info" message={t.plan.item.notFound} testID="plan-item-missing" />
        <Button variant="secondary" label={t.plan.item.close} onPress={close} />
      </Screen>
    );
  }
  return (
    <PlannedItemSheet
      item={item}
      canLog={item.localDate <= today}
      showNumbers={showsFoodNumbers(me.data.profile.safetyFlags)}
      close={close}
    />
  );
}

function PlannedItemSheet({
  item,
  canLog,
  showNumbers,
  close,
}: {
  item: PlannedMealItem;
  canLog: boolean;
  showNumbers: boolean;
  close: () => void;
}) {
  const { t, format, locale } = useI18n();
  const actions = usePlanActions();
  const setFavourite = useSetFavouriteFood();
  const favourites = useFavouriteFoods(locale);
  const portion = itemPortion(item);
  // The servings come from the catalog: a quick add, or a food that left it, has none.
  const food = useFood(portion ? item.foodId : null, locale);
  const i = t.plan.item;
  const when = format(i.plannedFor, {
    meal: t.food.meals[item.mealType],
    day: formatLongDate(item.localDate, locale),
  });
  const remove = (
    <Button
      variant="secondary"
      label={i.remove}
      onPress={() => {
        actions.removeItems([item], format(i.removed, { food: item.label }));
        close();
      }}
      testID="plan-item-remove"
    />
  );

  if (canLog && portion && food.data) {
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
        submitLabel={i.register}
        onSubmit={(next) => {
          actions.logPlannedPortion(item, catalogFood, next);
          close();
        }}
        onCancel={close}
        testID="plan-item-sheet"
      >
        <AppText tone="muted" testID="plan-item-when">
          {when}
        </AppText>
        {remove}
      </PortionSheet>
    );
  }
  if (food.isLoading) return <BlockingState />;

  const portionText = formatPortion(item, locale);
  return (
    <Screen
      testID="plan-item-sheet"
      footer={
        <>
          {canLog ? (
            <Button
              label={i.register}
              onPress={() => {
                actions.logPlanned([item]);
                close();
              }}
              testID="portion-submit"
            />
          ) : null}
          <Button variant="ghost" label={i.close} onPress={close} testID="portion-cancel" />
        </>
      }
    >
      <AppText variant="title">{item.label}</AppText>
      <AppText tone="muted" testID="plan-item-when">
        {when}
      </AppText>
      {portionText ? <AppText tone="muted">{portionText}</AppText> : null}
      {showNumbers ? (
        <AppText weight="bold">
          {format(t.food.kcal, { value: formatNumber(Math.round(item.nutrients.kcal), locale) })}
        </AppText>
      ) : null}
      {/* A portion without its food: it left the catalog, or it is not on the device (offline). */}
      {canLog && portion ? (
        <Notice tone="info" message={i.moveOnly} testID="plan-item-as-planned" />
      ) : null}
      {remove}
    </Screen>
  );
}
