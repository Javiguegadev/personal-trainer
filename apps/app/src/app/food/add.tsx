import { FOOD_LOG_DAYS, isApiError } from '@pt/api-client';
import {
  FOOD_LOG_LIMITS,
  IsoDateSchema,
  MEAL_TYPES,
  MealTypeSchema,
  type Food,
  type FoodInputMethod,
  type LabelImage,
  type MealType,
  type Portion,
} from '@pt/contracts';
import {
  addDays,
  customFoodAsFood,
  formatPortion,
  formatWeekdayDay,
  initialPortion,
  isOwnFood,
  mealTypeForTime,
  showsFoodNumbers,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { CustomFoodForm } from '@/components/CustomFoodForm';
import { FoodRejectedNotice } from '@/components/FoodRejectedNotice';
import { FoodRow } from '@/components/FoodRow';
import { Notice } from '@/components/Notice';
import { PortionSheet } from '@/components/PortionSheet';
import { ProductNotFound, type ProductMiss } from '@/components/ProductNotFound';
import { QuickAddForm } from '@/components/QuickAddForm';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { UndoToast } from '@/components/UndoToast';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useDeferredFoodDelete } from '@/hooks/useDeferredFoodDelete';
import { useFoodLogActions } from '@/hooks/useFoodLogActions';
import { useI18n } from '@/hooks/useI18n';
import { useOnline } from '@/hooks/useOnline';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import {
  useBarcodeLookup,
  useCustomFoods,
  useFavouriteFoods,
  useFoodSearch,
  useMe,
  useRecentFoods,
  useSaveCustomFood,
  useSetFavouriteFood,
} from '@/lib/api';
import { newId } from '@/lib/id';
import { pickLabelPhoto } from '@/lib/labelPhoto';

const SEARCH_DEBOUNCE_MS = 250;

/** How a food reaches the log from this screen (a quick add and "repeat yesterday" have their own). */
type AddMethod = Exclude<FoodInputMethod, 'quick_add' | 'repeat'>;

type Step =
  | { kind: 'search' }
  | { kind: 'portion'; food: Food; inputMethod: AddMethod }
  | { kind: 'quick'; name: string }
  | { kind: 'scan' }
  /** A scanned code without a food (spec 006 AC6, AC7). */
  | { kind: 'miss'; barcode: string; reason: ProductMiss }
  /** "Crear alimento": new (with the barcode of a scan, or a label photo already taken) or `food`. */
  | { kind: 'custom'; barcode: string | null; name: string; image?: LabelImage; food?: Food };

/** Why the API gave no food for a barcode. Anything unexpected counts as "could not ask". */
function missReason(error: unknown): ProductMiss {
  if (isApiError(error, 'product_not_found')) return 'not_found';
  if (isApiError(error, 'product_incomplete')) return 'incomplete';
  if (isApiError(error, 'rate_limited')) return 'rate_limited';
  return 'unavailable';
}

/**
 * The add screen (spec 005 AC7, AC8, AC12), opened over the tabs. `?date=&meal=` come from a meal of the
 * Food tab; without `meal` (opened from Today) the meal is preselected from the time of day and can be
 * changed with chips. Scanning a barcode and creating a food (spec 006) are steps of this screen, like
 * the portion sheet, so the search, the meal and the day stay as they were.
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
  const saveFood = useSaveCustomFood();
  const deferredDelete = useDeferredFoodDelete();
  const barcodes = useBarcodeLookup();
  const recents = useRecentFoods(locale);
  const favourites = useFavouriteFoods(locale);
  const ownFoods = useCustomFoods(locale);
  const [step, setStep] = useState<Step>({ kind: 'search' });
  const [mealType, setMealType] = useState(initialMeal);
  const [query, setQuery] = useState('');
  /** What just happened ("Añadido: 2 huevos"), shown above the search. */
  const [done, setDone] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const a = t.food.add;
  const c = t.food.custom;
  const s = t.food.scan;

  // Results follow the typing after a short pause; an emptied field shows the recents at once.
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS).trim();
  const searching =
    online &&
    debounced.length >= FOOD_LOG_LIMITS.searchMinLength &&
    query.trim().length >= FOOD_LOG_LIMITS.searchMinLength;
  const search = useFoodSearch(searching ? debounced : '', locale);

  // A food whose delete can still be undone is already gone from every list.
  const shown = (food: Food) => food.id !== deferredDelete.pending?.id;
  const favouriteIds = new Set((favourites.data ?? []).map((food) => food.id));
  const lastPortion = (food: Food): Portion | null =>
    recents.data?.find((recent) => recent.food.id === food.id)?.lastPortion ?? null;
  const toggleFavourite = (food: Food) =>
    setFavourite.mutate({ food, favourite: !favouriteIds.has(food.id), locale });

  const close = () => (router.canGoBack() ? router.back() : router.replace('/food'));
  const toSearch = () => setStep({ kind: 'search' });
  /** Back to the search with a confirmation, so several foods can be added in a row (AC8). */
  const afterAdd = (label: string, portion: string | null) => {
    setDone(format(a.added, { food: portion ? `${label} · ${portion}` : label }));
    setQuery('');
    toSearch();
  };

  /**
   * The food of a scanned or typed barcode (spec 006 AC3, AC8): first among the foods the device holds,
   * which also works without a connection, then from the API.
   */
  const findBarcode = async (barcode: string) => {
    const cached = barcodes.cached(barcode, locale);
    if (cached) return setStep({ kind: 'portion', food: cached, inputMethod: 'barcode' });
    if (!online) return setStep({ kind: 'miss', barcode, reason: 'offline' });
    setLooking(true);
    try {
      const food = await barcodes.fetch(barcode, locale);
      setStep({ kind: 'portion', food, inputMethod: 'barcode' });
    } catch (error) {
      setStep({ kind: 'miss', barcode, reason: missReason(error) });
    } finally {
      setLooking(false);
    }
  };

  /** "Leer la etiqueta con una foto" of AC6: the photo is taken here and the form reads it. */
  const photographLabel = async (barcode: string) => {
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const photo = await pickLabelPhoto('camera');
      if (photo.status === 'ok') setStep({ kind: 'custom', barcode, name: '', image: photo.image });
      if (photo.status === 'denied') setPhotoError(t.food.label.permission);
    } catch {
      setPhotoError(t.food.label.failed);
    } finally {
      setPhotoBusy(false);
    }
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
        onCancel={toSearch}
      >
        {isOwnFood(food) ? (
          <View style={styles.gap}>
            <Button
              variant="secondary"
              label={c.edit}
              accessibilityLabel={format(c.editFood, { food: food.name })}
              onPress={() =>
                setStep({ kind: 'custom', food, barcode: food.barcode, name: food.name })
              }
              testID="custom-food-edit"
            />
            <Button
              variant="ghost"
              label={c.delete}
              accessibilityLabel={format(c.deleteFood, { food: food.name })}
              onPress={() => {
                deferredDelete.request(food);
                setDone(null);
                toSearch();
              }}
              testID="custom-food-delete"
            />
          </View>
        ) : null}
      </PortionSheet>
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
        onCancel={toSearch}
      />
    );
  }
  if (step.kind === 'scan') {
    return (
      <BarcodeScanner
        busy={looking}
        notice={
          looking ? (
            <Notice tone="info" message={s.looking} testID="barcode-looking" />
          ) : online ? null : (
            <Notice tone="info" message={s.offline} testID="barcode-offline" />
          )
        }
        onCode={(barcode) => void findBarcode(barcode)}
        onCancel={toSearch}
      />
    );
  }
  if (step.kind === 'miss') {
    const { barcode } = step;
    return (
      <ProductNotFound
        barcode={barcode}
        reason={step.reason}
        busy={looking || photoBusy}
        showNumbers={showNumbers}
        error={photoError}
        onRetry={() => void findBarcode(barcode)}
        onLabelPhoto={() => void photographLabel(barcode)}
        onByHand={() => setStep({ kind: 'custom', barcode, name: '' })}
        onQuickAdd={() => setStep({ kind: 'quick', name: '' })}
        onScanAnother={() => setStep({ kind: 'scan' })}
        onCancel={toSearch}
      />
    );
  }
  if (step.kind === 'custom') {
    const editing = step.food;
    return (
      <CustomFoodForm
        food={editing}
        barcode={step.barcode}
        initialName={step.name}
        initialImage={step.image}
        showNumbers={showNumbers}
        onSubmit={(request) => {
          // Optimistic and queued: the food is in the lists at once, also without a connection.
          const id = editing?.id ?? newId();
          saveFood.mutate({ id, request });
          const food = customFoodAsFood(id, request);
          if (editing) {
            setDone(format(c.saved, { food: food.name }));
            return toSearch();
          }
          // A new food is for logging now: its portion comes next.
          const inputMethod = request.origin === 'label' ? 'label' : 'custom';
          setStep({ kind: 'portion', food, inputMethod });
        }}
        onCancel={toSearch}
      />
    );
  }

  const row = (food: Food, inputMethod: AddMethod) => (
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
    const results = (search.data ?? []).filter(shown);
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
              label={format(c.createNamed, { query: debounced })}
              onPress={() => setStep({ kind: 'custom', barcode: null, name: debounced })}
              testID="custom-food-query"
            />
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
    const recentFoods = (recents.data ?? []).filter((recent) => shown(recent.food));
    const favouriteFoods = (favourites.data ?? []).filter(shown);
    const myFoods = (ownFoods.data ?? []).filter(shown);
    list =
      recentFoods.length === 0 && favouriteFoods.length === 0 && myFoods.length === 0 ? (
        recents.isLoading || favourites.isLoading || ownFoods.isLoading ? (
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
          {myFoods.length > 0 ? (
            <View testID="food-mine">
              <AppText variant="label" accessibilityRole="header">
                {c.mine}
              </AppText>
              {myFoods.map((food) => row(food, 'search'))}
            </View>
          ) : null}
        </>
      );
  }

  const deleted = deferredDelete.pending;
  return (
    <Screen
      testID="food-add-screen"
      footer={
        <>
          {deleted ? (
            <UndoToast
              message={format(c.deleted, { food: deleted.name })}
              onUndo={deferredDelete.undo}
            />
          ) : null}
          <Button label={a.done} onPress={close} testID="food-add-done" />
        </>
      }
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
      {done ? <Notice tone="success" message={`✓ ${done}`} testID="food-added" /> : null}
      <FoodRejectedNotice />
      <View style={styles.searchRow}>
        <View style={styles.searchField}>
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
        </View>
        <Button
          variant="secondary"
          label={s.open}
          accessibilityLabel={s.openLabel}
          onPress={() => setStep({ kind: 'scan' })}
          testID="food-scan"
        />
      </View>
      {online ? null : <Notice tone="info" message={a.offline} testID="food-search-offline" />}
      {list}
      <Button
        variant="secondary"
        label={c.create}
        onPress={() => setStep({ kind: 'custom', barcode: null, name: '' })}
        testID="custom-food-open"
      />
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
  // The scan button sits beside the field, level with its input (the label is above it).
  searchRow: { flexDirection: 'row', alignItems: 'flex-end', gap: tokens.space.sm },
  searchField: { flex: 1 },
});
