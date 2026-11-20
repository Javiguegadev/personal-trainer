import { isApiError } from '@pt/api-client';
import {
  FOOD_LOG_LIMITS,
  IsoDateSchema,
  MEAL_TYPES,
  MealTypeSchema,
  PortionSchema,
  type DraftItem,
  type Food,
  type FoodInputMethod,
  type ImageUpload,
  type LabelImage,
  type MealDraftResponse,
  type MealUnreadableReason,
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
  WEEK_VIEW,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { CustomFoodForm } from '@/components/CustomFoodForm';
import { FoodRejectedNotice } from '@/components/FoodRejectedNotice';
import { FoodRow } from '@/components/FoodRow';
import { MealDraftView } from '@/components/MealDraftView';
import { MealTextInput } from '@/components/MealTextInput';
import { Notice } from '@/components/Notice';
import { PlatePhotoPicker } from '@/components/PlatePhotoPicker';
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
  useFood,
  useFoodSearch,
  useMealDraft,
  useMe,
  useRecentFoods,
  useSaveCustomFood,
  useSetFavouriteFood,
} from '@/lib/api';
import { useFoodUndo } from '@/lib/foodUndo';
import { newId } from '@/lib/id';
import { pickPhoto } from '@/lib/photo';

const SEARCH_DEBOUNCE_MS = 250;

/** How a food reaches the log from this screen (a quick add and "repeat yesterday" have their own). */
type AddMethod = Exclude<FoodInputMethod, 'quick_add' | 'repeat'>;

type Step =
  | { kind: 'search' }
  /** `portion`: the one a daily-feedback suggestion brings (spec 008 AC16). */
  | { kind: 'portion'; food: Food; inputMethod: AddMethod; portion?: Portion }
  | { kind: 'quick'; name: string }
  | { kind: 'scan' }
  /** A scanned code without a food (spec 006 AC6, AC7). */
  | { kind: 'miss'; barcode: string; reason: ProductMiss }
  /** "Crear alimento": new (with the barcode of a scan, or a label photo already taken) or `food`. */
  | { kind: 'custom'; barcode: string | null; name: string; image?: LabelImage; food?: Food }
  /** The shortcuts of spec 007: a sentence, a plate photo, the wait, the draft, or why there is none. */
  | { kind: 'describe'; text: string }
  | { kind: 'platePhoto' }
  | { kind: 'preparing'; run: number; source: DraftSource; text: string; photoUri: string | null }
  | {
      kind: 'draft';
      source: DraftSource;
      items: DraftItem[];
      unresolved: { mention: string }[];
      photoUri: string | null;
    }
  | { kind: 'draftFailed'; source: DraftSource; text: string; message: string };

type DraftSource = 'text' | 'photo';

/** What the screen says when a draft cannot be made (spec 007 AC11, AC12). */
function draftFailure(
  error: unknown,
  d: { capReached: string; unavailable: string; tooLarge: string; error: string },
): string {
  if (isApiError(error, 'ai_cap_reached')) return d.capReached;
  if (isApiError(error, 'ai_unavailable')) return d.unavailable;
  if (isApiError(error, 'image_too_large')) return d.tooLarge;
  return d.error;
}

/** Each draft request gets a number, so the answer of one the user cancelled is dropped. */
let draftRuns = 0;

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
  const params = useLocalSearchParams<{
    date?: string;
    meal?: string;
    foodId?: string;
    portion?: string;
  }>();
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
    // The Food tab offers 6 days back; a day screen of the week view 27 (spec 010 AC12).
    requestedDate.data >= addDays(today, -WEEK_VIEW.addDaysBack)
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
      suggested={suggestedFood(params.foodId, params.portion)}
    />
  );
}

/** A food and portion suggested by the daily feedback (spec 008 AC16), from the route params. */
function suggestedFood(
  foodId: string | undefined,
  portion: string | undefined,
): { foodId: string; portion: Portion } | null {
  if (!foodId || !portion) return null;
  try {
    const parsed = PortionSchema.safeParse(JSON.parse(portion));
    return parsed.success ? { foodId, portion: parsed.data } : null;
  } catch {
    return null;
  }
}

function FoodAdd({
  date,
  today,
  initialMeal,
  mealFixed,
  showNumbers,
  suggested,
}: {
  date: string;
  today: string;
  initialMeal: MealType;
  mealFixed: boolean;
  showNumbers: boolean;
  suggested: { foodId: string; portion: Portion } | null;
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
  const mealDraft = useMealDraft();
  const undo = useFoodUndo();
  const recents = useRecentFoods(locale);
  const favourites = useFavouriteFoods(locale);
  const ownFoods = useCustomFoods(locale);
  const [step, setStep] = useState<Step>({ kind: 'search' });
  // A suggestion of the daily feedback opens its portion sheet once, with the suggested portion; the
  // food is in the cache already (the feedback card put it there). Nothing is logged until "Añadir".
  const suggestion = useFood(suggested?.foodId ?? null, locale);
  const suggestionShown = useRef(false);
  useEffect(() => {
    if (!suggested || suggestionShown.current || !suggestion.data) return;
    suggestionShown.current = true;
    setStep({
      kind: 'portion',
      food: suggestion.data,
      inputMethod: 'recent',
      portion: suggested.portion,
    });
  }, [suggested, suggestion.data]);
  const [mealType, setMealType] = useState(initialMeal);
  const [query, setQuery] = useState('');
  /**
   * Whether the search field opens the keyboard when it shows. Off after the camera (a scan or a plate
   * photo), so the confirmation of a scanned product is not covered by the keyboard; back on when the
   * user types again.
   */
  const [focusSearch, setFocusSearch] = useState(true);
  const openCamera = (next: { kind: 'scan' } | { kind: 'platePhoto' }) => {
    setFocusSearch(false);
    setStep(next);
  };
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
      const photo = await pickPhoto('camera');
      if (photo.status === 'ok') setStep({ kind: 'custom', barcode, name: '', image: photo.image });
      if (photo.status === 'denied') setPhotoError(t.food.label.permission);
    } catch {
      setPhotoError(t.food.label.failed);
    } finally {
      setPhotoBusy(false);
    }
  };

  /** Sends the sentence or the photo and opens the draft (spec 007 AC4, AC5, AC10–AC12). */
  const prepareDraft = async (
    source: DraftSource,
    input: { text: string } | { image: ImageUpload },
  ) => {
    const run = ++draftRuns;
    const text = 'text' in input ? input.text : '';
    const photoUri =
      'image' in input ? `data:${input.image.mediaType};base64,${input.image.data}` : null;
    setStep({ kind: 'preparing', run, source, text, photoUri });
    const still = (current: Step) => current.kind === 'preparing' && current.run === run;
    let draft: MealDraftResponse;
    try {
      draft =
        'text' in input
          ? await mealDraft.mutateAsync({ kind: 'text', body: { text: input.text, locale } })
          : await mealDraft.mutateAsync({ kind: 'photo', body: { image: input.image, locale } });
    } catch (error) {
      const message = draftFailure(error, t.food.draft);
      setStep((current) =>
        still(current) ? { kind: 'draftFailed', source, text, message } : current,
      );
      return;
    }
    setStep((current) => {
      if (!still(current)) return current;
      if (draft.status === 'ok') {
        return {
          kind: 'draft',
          source,
          items: draft.items,
          unresolved: draft.unresolved,
          photoUri,
        };
      }
      const reason: MealUnreadableReason = draft.reason;
      const message =
        source === 'text' && reason === 'not_food'
          ? t.food.draft.notFoodText
          : t.food.draft.unreadable[reason];
      return { kind: 'draftFailed', source, text, message };
    });
  };

  if (step.kind === 'describe') {
    return (
      <MealTextInput
        initialText={step.text}
        online={online}
        onSubmit={(text) => void prepareDraft('text', { text })}
        onCancel={toSearch}
      />
    );
  }
  if (step.kind === 'platePhoto') {
    return (
      <PlatePhotoPicker
        online={online}
        onPhoto={(image) => void prepareDraft('photo', { image })}
        onCancel={toSearch}
      />
    );
  }
  if (step.kind === 'preparing') {
    return (
      <Screen
        testID="meal-draft-preparing"
        footer={<Button variant="ghost" label={t.food.portion.cancel} onPress={toSearch} />}
      >
        <AppText variant="title" accessibilityRole="header">
          {t.food.draft.title}
        </AppText>
        {step.photoUri ? (
          <Image
            source={{ uri: step.photoUri }}
            style={styles.photo}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <AppText tone="muted">«{step.text}»</AppText>
        )}
        <View style={styles.heading}>
          <ActivityIndicator color={colors.primary} />
          <AppText accessibilityLiveRegion="polite">{t.food.draft.preparing}</AppText>
        </View>
      </Screen>
    );
  }
  if (step.kind === 'draftFailed') {
    const { source, text } = step;
    return (
      <Screen
        testID="meal-draft-failed"
        footer={<Button variant="ghost" label={t.food.portion.cancel} onPress={toSearch} />}
      >
        <AppText variant="title" accessibilityRole="header">
          {t.food.draft.title}
        </AppText>
        <Notice tone="warning" message={step.message} testID="meal-draft-failed-message" />
        <Button
          label={source === 'photo' ? t.food.draft.retakePhoto : t.food.draft.editText}
          onPress={() =>
            setStep(source === 'photo' ? { kind: 'platePhoto' } : { kind: 'describe', text })
          }
          testID="meal-draft-retry"
        />
        <Button
          variant="secondary"
          label={t.food.draft.toSearch}
          onPress={toSearch}
          testID="meal-draft-to-search"
        />
      </Screen>
    );
  }
  if (step.kind === 'draft') {
    const { source } = step;
    return (
      <MealDraftView
        source={source}
        items={step.items}
        unresolved={step.unresolved}
        photoUri={step.photoUri}
        mealPicker={
          mealFixed ? null : (
            <ChoiceGroup
              label={a.meal}
              options={MEAL_TYPES.map((value) => ({ value, label: t.food.meals[value] }))}
              value={mealType}
              onChange={setMealType}
              testID="draft-meal"
            />
          )
        }
        showNumbers={showNumbers}
        favouriteIds={favouriteIds}
        onToggleFavourite={toggleFavourite}
        onSave={(entries) => {
          const items = actions.addDraft(entries, source, date, mealType);
          setDone(
            format(t.food.item.added, {
              count:
                items.length === 1
                  ? t.food.foodsOne
                  : format(t.food.foodsOther, { count: String(items.length) }),
            }),
          );
          setQuery('');
          toSearch();
        }}
        onCancel={toSearch}
      />
    );
  }

  if (step.kind === 'portion') {
    const { food, inputMethod } = step;
    return (
      <PortionSheet
        food={food}
        initial={initialPortion(food, step.portion ?? lastPortion(food))}
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
          ) : undo?.kind === 'added' ? (
            <UndoToast
              message={format(t.food.item.added, {
                count:
                  undo.items.length === 1
                    ? t.food.foodsOne
                    : format(t.food.foodsOther, { count: String(undo.items.length) }),
              })}
              onUndo={() => {
                actions.undo(undo);
                setDone(null);
              }}
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
            onChangeText={(text) => {
              setQuery(text);
              setFocusSearch(true);
            }}
            maxLength={FOOD_LOG_LIMITS.searchMaxLength}
            autoFocus={focusSearch}
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
          onPress={() => openCamera({ kind: 'scan' })}
          testID="food-scan"
        />
      </View>
      <View style={styles.shortcuts}>
        <View style={styles.shortcut}>
          <Button
            variant="secondary"
            label={t.food.shortcuts.photo}
            accessibilityLabel={t.food.shortcuts.photoLabel}
            onPress={() => openCamera({ kind: 'platePhoto' })}
            disabled={!online}
            testID="food-plate-photo"
          />
        </View>
        <View style={styles.shortcut}>
          <Button
            variant="secondary"
            label={t.food.shortcuts.describe}
            accessibilityLabel={t.food.shortcuts.describeLabel}
            onPress={() => setStep({ kind: 'describe', text: '' })}
            disabled={!online}
            testID="food-describe"
          />
        </View>
      </View>
      {online ? null : (
        <>
          <Notice tone="info" message={a.offline} testID="food-search-offline" />
          <Notice tone="info" message={t.food.shortcuts.offline} testID="food-shortcuts-offline" />
        </>
      )}
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
  shortcuts: { flexDirection: 'row', gap: tokens.space.sm },
  shortcut: { flex: 1 },
  photo: { width: '100%', aspectRatio: 4 / 3, maxHeight: 140, borderRadius: tokens.radius.md },
});
