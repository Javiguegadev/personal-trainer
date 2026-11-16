import { FOOD_LOG_DAYS } from '@pt/api-client';
import {
  FOOD_LOG_LIMITS,
  IsoDateSchema,
  MEAL_TYPES,
  MealTypeSchema,
  type Food,
  type MealType,
  type Portion,
} from '@pt/contracts';
import {
  addDays,
  formatPortion,
  formatWeekdayDay,
  initialPortion,
  mealTypeForTime,
  showsFoodNumbers,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { FoodRow } from '@/components/FoodRow';
import { Notice } from '@/components/Notice';
import { PortionSheet } from '@/components/PortionSheet';
import { QuickAddForm } from '@/components/QuickAddForm';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useFoodLogActions } from '@/hooks/useFoodLogActions';
import { useI18n } from '@/hooks/useI18n';
import { useOnline } from '@/hooks/useOnline';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import {
  useFavouriteFoods,
  useFoodSearch,
  useMe,
  useRecentFoods,
  useSetFavouriteFood,
} from '@/lib/api';

const SEARCH_DEBOUNCE_MS = 250;

type Step =
  | { kind: 'search' }
  | { kind: 'portion'; food: Food; inputMethod: 'search' | 'recent' | 'favourite' }
  | { kind: 'quick'; name: string };

/**
 * The add screen (spec 005 AC7, AC8, AC12), opened over the tabs. `?date=&meal=` come from a meal of the
 * Food tab; without `meal` (opened from Today) the meal is preselected from the time of day and can be
 * changed with chips.
 */
export default function FoodAddRoute() {
  const me = useMe();
  const today = useToday();
  const params = useLocalSearchParams<{ date?: string; meal?: string }>();
  // The meal is chosen once, when the screen opens: it must not change while the user adds foods.
  const [timeMeal] = useState(() => {
    const now = new Date();
    return mealTypeForTime(now.getHours() * 60 + now.getMinutes());
  });
  if (!me.data?.profile) return <BlockingState />;

  const requestedDate = IsoDateSchema.safeParse(params.date);
  const date =
    requestedDate.success &&
    requestedDate.data <= today &&
    requestedDate.data >= addDays(today, -(FOOD_LOG_DAYS - 2))
      ? requestedDate.data
      : today;
  const requestedMeal = MealTypeSchema.safeParse(params.meal);
  return (
    <FoodAdd
      date={date}
      today={today}
      initialMeal={requestedMeal.success ? requestedMeal.data : timeMeal}
      mealFixed={requestedMeal.success}
      showNumbers={showsFoodNumbers(me.data.profile.safetyFlags)}
    />
  );
}

function FoodAdd({
  date,
  today,
  initialMeal,
  mealFixed,
  showNumbers,
}: {
  date: string;
  today: string;
  initialMeal: MealType;
  mealFixed: boolean;
  showNumbers: boolean;
}) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const actions = useFoodLogActions();
  const setFavourite = useSetFavouriteFood();
  const recents = useRecentFoods(locale);
  const favourites = useFavouriteFoods(locale);
  const [step, setStep] = useState<Step>({ kind: 'search' });
  const [mealType, setMealType] = useState(initialMeal);
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const a = t.food.add;

  // Results follow the typing after a short pause; an emptied field shows the recents at once.
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS).trim();
  const searching =
    online &&
    debounced.length >= FOOD_LOG_LIMITS.searchMinLength &&
    query.trim().length >= FOOD_LOG_LIMITS.searchMinLength;
  const search = useFoodSearch(searching ? debounced : '', locale);

  const favouriteIds = new Set((favourites.data ?? []).map((food) => food.id));
  const lastPortion = (food: Food): Portion | null =>
    recents.data?.find((recent) => recent.food.id === food.id)?.lastPortion ?? null;
  const toggleFavourite = (food: Food) =>
    setFavourite.mutate({ food, favourite: !favouriteIds.has(food.id), locale });

  const close = () => (router.canGoBack() ? router.back() : router.replace('/food'));
  /** Back to the search with a confirmation, so several foods can be added in a row (AC8). */
  const afterAdd = (label: string, portion: string | null) => {
    setAdded(format(a.added, { food: portion ? `${label} · ${portion}` : label }));
    setQuery('');
    setStep({ kind: 'search' });
  };

  if (step.kind === 'portion') {
    const { food, inputMethod } = step;
    return (
      <PortionSheet
        food={food}
        initial={initialPortion(food, lastPortion(food))}
        favourite={favouriteIds.has(food.id)}
        onToggleFavourite={() => toggleFavourite(food)}
        showNumbers={showNumbers}
        submitLabel={t.food.portion.add}
        onSubmit={(portion) => {
          const item = actions.addFood(food, portion, inputMethod, date, mealType);
          afterAdd(item.label, formatPortion(item, locale));
        }}
        onCancel={() => setStep({ kind: 'search' })}
      />
    );
  }
  if (step.kind === 'quick') {
    return (
      <QuickAddForm
        initialName={step.name}
        onSubmit={(values) => {
          const item = actions.addQuick(values, date, mealType);
          afterAdd(item.label, null);
        }}
        onCancel={() => setStep({ kind: 'search' })}
      />
    );
  }

  const row = (food: Food, inputMethod: 'search' | 'recent' | 'favourite') => (
    <FoodRow
      key={food.id}
      food={food}
      portion={initialPortion(food, lastPortion(food))}
      showNumbers={showNumbers}
      favourite={favouriteIds.has(food.id)}
      onPress={() => setStep({ kind: 'portion', food, inputMethod })}
      onToggleFavourite={() => toggleFavourite(food)}
    />
  );
  const spinner = (
    <ActivityIndicator color={colors.primary} accessibilityLabel={t.common.loading} />
  );

  let list;
  if (searching) {
    const results = search.data ?? [];
    const settled = search.isSuccess && !search.isPlaceholderData;
    list = (
      <View testID="food-results">
        <View style={styles.heading}>
          <AppText variant="label" accessibilityRole="header">
            {a.results}
          </AppText>
          {search.isFetching ? spinner : null}
        </View>
        {search.isError ? (
          <View style={styles.gap}>
            <Notice tone="danger" message={a.searchError} testID="food-search-error" />
            <Button
              variant="secondary"
              label={t.common.retry}
              onPress={() => void search.refetch()}
            />
          </View>
        ) : settled && results.length === 0 ? (
          <View style={styles.gap} testID="food-no-results">
            <AppText tone="muted">{format(a.noResults, { query: debounced })}</AppText>
            <Button
              variant="secondary"
              label={format(a.quickAddQuery, { query: debounced })}
              onPress={() => setStep({ kind: 'quick', name: debounced })}
              testID="quick-add-query"
            />
          </View>
        ) : (
          <View style={search.isPlaceholderData ? styles.stale : undefined}>
            {results.map((food) => row(food, 'search'))}
          </View>
        )}
      </View>
    );
  } else {
    const recentFoods = recents.data ?? [];
    const favouriteFoods = favourites.data ?? [];
    list =
      recentFoods.length === 0 && favouriteFoods.length === 0 ? (
        recents.isLoading || favourites.isLoading ? (
          spinner
        ) : (
          <AppText tone="muted" testID="food-add-hint">
            {a.hint}
          </AppText>
        )
      ) : (
        <>
          {recentFoods.length > 0 ? (
            <View testID="food-recents">
              <AppText variant="label" accessibilityRole="header">
                {a.recents}
              </AppText>
              {recentFoods.map((recent) => row(recent.food, 'recent'))}
            </View>
          ) : null}
          {favouriteFoods.length > 0 ? (
            <View testID="food-favourites">
              <AppText variant="label" accessibilityRole="header">
                {a.favourites}
              </AppText>
              {favouriteFoods.map((food) => row(food, 'favourite'))}
            </View>
          ) : null}
        </>
      );
  }

  return (
    <Screen
      testID="food-add-screen"
      footer={<Button label={a.done} onPress={close} testID="food-add-done" />}
    >
      <View>
        <AppText variant="title">
          {mealFixed ? format(a.titleMeal, { meal: t.food.meals[mealType] }) : a.title}
        </AppText>
        {date === today ? null : <AppText tone="muted">{formatWeekdayDay(date, locale)}</AppText>}
      </View>
      {mealFixed ? null : (
        <ChoiceGroup
          label={a.meal}
          options={MEAL_TYPES.map((value) => ({ value, label: t.food.meals[value] }))}
          value={mealType}
          onChange={setMealType}
          testID="food-add-meal"
        />
      )}
      {added ? <Notice tone="success" message={`✓ ${added}`} testID="food-added" /> : null}
      <TextField
        label={a.search}
        placeholder={a.searchPlaceholder}
        value={query}
        onChangeText={setQuery}
        maxLength={FOOD_LOG_LIMITS.searchMaxLength}
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        inputMode="search"
        testID="food-search"
      />
      {online ? null : <Notice tone="info" message={a.offline} testID="food-search-offline" />}
      {list}
      <Button
        variant="secondary"
        label={a.quickAdd}
        onPress={() => setStep({ kind: 'quick', name: '' })}
        testID="quick-add-open"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    minHeight: 24,
  },
  gap: { gap: tokens.space.sm, marginTop: tokens.space.sm },
  stale: { opacity: 0.5 },
});
