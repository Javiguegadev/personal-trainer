import { MEAL_TYPES, type MealType, type PlannedMealItem } from '@pt/contracts';
import {
  formatLongDate,
  formatNumber,
  formatPortion,
  initialPortion,
  itemPortion,
  planTargetWeeks,
  showsFoodNumbers,
} from '@pt/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { DaySelector } from '@/components/DaySelector';
import { Notice } from '@/components/Notice';
import { PortionSheet } from '@/components/PortionSheet';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/hooks/useI18n';
import { usePlanActions } from '@/hooks/usePlanActions';
import { useToday } from '@/hooks/useToday';
import { useFavouriteFoods, useFood, useMe, usePlan, useSetFavouriteFood } from '@/lib/api';

/**
 * A planned item, opened over the tabs. On today or a past day (spec 013 AC9): the portion sheet with
 * the planned portion, "Registrar" (the portion can be changed first) and "Quitar del plan" with an
 * undo. On a future day (AC6): its portion, its meal and its day (inside the horizon) can be changed,
 * or it is removed with an undo; it cannot be logged.
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
  const showNumbers = showsFoodNumbers(me.data.profile.safetyFlags);
  if (item.localDate > today) {
    return <PlannedItemEditor item={item} today={today} showNumbers={showNumbers} close={close} />;
  }
  return <PlannedItemSheet item={item} showNumbers={showNumbers} close={close} />;
}

/** "Quitar del plan" with its undo (AC6, AC9). */
function RemoveButton({ item, close }: { item: PlannedMealItem; close: () => void }) {
  const { t, format } = useI18n();
  const actions = usePlanActions();
  return (
    <Button
      variant="secondary"
      label={t.plan.item.remove}
      onPress={() => {
        actions.removeItems([item], format(t.plan.item.removed, { food: item.label }));
        close();
      }}
      testID="plan-item-remove"
    />
  );
}

/** The item as it was planned, when there is no catalog food to change its portion with. */
function PlannedItemSummary({
  item,
  showNumbers,
  when,
  children,
  footer,
}: {
  item: PlannedMealItem;
  showNumbers: boolean;
  when: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const { t, format, locale } = useI18n();
  const portionText = formatPortion(item, locale);
  return (
    <Screen testID="plan-item-sheet" footer={footer}>
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
      {children}
    </Screen>
  );
}

function usePlannedWhen(item: PlannedMealItem): string {
  const { t, format, locale } = useI18n();
  return format(t.plan.item.plannedFor, {
    meal: t.food.meals[item.mealType],
    day: formatLongDate(item.localDate, locale),
  });
}

/** Today or a past day (AC9): log it, with the portion chosen, or remove it. */
function PlannedItemSheet({
  item,
  showNumbers,
  close,
}: {
  item: PlannedMealItem;
  showNumbers: boolean;
  close: () => void;
}) {
  const { t, locale } = useI18n();
  const actions = usePlanActions();
  const setFavourite = useSetFavouriteFood();
  const favourites = useFavouriteFoods(locale);
  const portion = itemPortion(item);
  // The servings come from the catalog: a quick add, or a food that left it, has none.
  const food = useFood(portion ? item.foodId : null, locale);
  const i = t.plan.item;
  const when = usePlannedWhen(item);

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
        <RemoveButton item={item} close={close} />
      </PortionSheet>
    );
  }
  if (food.isLoading) return <BlockingState />;

  return (
    <PlannedItemSummary
      item={item}
      showNumbers={showNumbers}
      when={when}
      footer={
        <>
          <Button
            label={i.register}
            onPress={() => {
              actions.logPlanned([item]);
              close();
            }}
            testID="portion-submit"
          />
          <Button variant="ghost" label={i.close} onPress={close} testID="portion-cancel" />
        </>
      }
    >
      {/* A portion without its food: it left the catalog, or it is not on the device (offline). */}
      {portion ? <Notice tone="info" message={i.moveOnly} testID="plan-item-as-planned" /> : null}
      <RemoveButton item={item} close={close} />
    </PlannedItemSummary>
  );
}

/** The days a planned item can move to (AC6): today to the end of the horizon. */
const horizonDays = (today: string): string[] =>
  planTargetWeeks(today).flatMap((week) => week.days);

/** A future day (AC6): its portion, meal and day can change, or it is removed; never logged. */
function PlannedItemEditor({
  item,
  today,
  showNumbers,
  close,
}: {
  item: PlannedMealItem;
  today: string;
  showNumbers: boolean;
  close: () => void;
}) {
  const { t, locale } = useI18n();
  const actions = usePlanActions();
  const setFavourite = useSetFavouriteFood();
  const favourites = useFavouriteFoods(locale);
  const portion = itemPortion(item);
  const food = useFood(portion ? item.foodId : null, locale);
  const [mealType, setMealType] = useState<MealType>(item.mealType);
  const [day, setDay] = useState(item.localDate);
  const i = t.plan.item;
  const when = usePlannedWhen(item);

  const placement = (
    <>
      <ChoiceGroup
        label={i.meal}
        options={MEAL_TYPES.map((value) => ({ value, label: t.food.meals[value] }))}
        value={mealType}
        onChange={setMealType}
        testID="plan-item-meal"
      />
      <DaySelector
        label={i.day}
        days={horizonDays(today)}
        today={today}
        value={day}
        onChange={setDay}
        layout="scroll"
        testID="plan-item-day"
      />
      <RemoveButton item={item} close={close} />
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
        submitLabel={i.save}
        onSubmit={(next) => {
          actions.changeItem(
            item,
            { localDate: day, mealType },
            { food: catalogFood, portion: next },
          );
          close();
        }}
        onCancel={close}
        testID="plan-item-sheet"
      >
        <AppText tone="muted" testID="plan-item-when">
          {when}
        </AppText>
        {placement}
      </PortionSheet>
    );
  }
  if (food.isLoading) return <BlockingState />;

  return (
    <PlannedItemSummary
      item={item}
      showNumbers={showNumbers}
      when={when}
      footer={
        <>
          <Button
            label={i.save}
            onPress={() => {
              if (day !== item.localDate || mealType !== item.mealType) {
                actions.changeItem(item, { localDate: day, mealType }, null);
              }
              close();
            }}
            testID="portion-submit"
          />
          <Button variant="ghost" label={i.close} onPress={close} testID="portion-cancel" />
        </>
      }
    >
      {portion ? <Notice tone="info" message={i.keepOnly} testID="plan-item-keep-only" /> : null}
      {placement}
    </PlannedItemSummary>
  );
}
