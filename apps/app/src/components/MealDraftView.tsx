import {
  FOOD_LOG_LIMITS,
  MEAL_DRAFT_LIMITS,
  type DraftItem,
  type Food,
  type Portion,
} from '@pt/contracts';
import {
  draftTotals,
  formatNumber,
  formatPortion,
  initialPortion,
  portionForReplacement,
  portionPreview,
  type QuickAddValues,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useFoodSearch } from '@/lib/api';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { PortionSheet } from './PortionSheet';
import { QuickAddForm } from './QuickAddForm';
import { Screen } from './Screen';
import { TextField } from './TextField';

/** One line of the draft as the user edits it: a catalog food with its portion, or a quick add. */
export type DraftEntry =
  | ({ key: string; kind: 'food' } & DraftItem)
  | { key: string; kind: 'quick'; values: QuickAddValues & { label: string } };

interface Unresolved {
  key: string;
  mention: string;
}

type View_ =
  | { kind: 'list' }
  | { kind: 'portion'; key: string }
  | { kind: 'search'; purpose: 'add' }
  | { kind: 'search'; purpose: 'replace'; key: string }
  | { kind: 'search'; purpose: 'resolve'; key: string; mention: string }
  | { kind: 'quick'; key: string; mention: string };

interface MealDraftViewProps {
  source: 'text' | 'photo';
  items: DraftItem[];
  unresolved: { mention: string }[];
  /** The photo as a data URI, shown above the draft; it lives only in memory (AC3). */
  photoUri: string | null;
  /** The meal chips of the add screen, when its meal can still change (AC7). */
  mealPicker: ReactNode;
  showNumbers: boolean;
  favouriteIds: ReadonlySet<string>;
  onToggleFavourite: (food: Food) => void;
  /** Saves every entry, in order (AC8). */
  onSave: (entries: DraftEntry[]) => void;
  onCancel: () => void;
}

let counter = 0;
const nextKey = () => `draft-${++counter}`;

/**
 * The editable draft of a sentence or a plate photo (spec 007 AC4–AC8). Nothing is logged until
 * "Añadir N alimentos": every item can change its portion or its food, or go; a mention without a food
 * is searched or quick-added; "Añadir otro" adds a food from the search.
 */
export function MealDraftView({
  source,
  items,
  unresolved: initialUnresolved,
  photoUri,
  mealPicker,
  showNumbers,
  favouriteIds,
  onToggleFavourite,
  onSave,
  onCancel,
}: MealDraftViewProps) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const d = t.food.draft;
  const [entries, setEntries] = useState<DraftEntry[]>(() =>
    items.map((item) => ({ ...item, key: nextKey(), kind: 'food' as const })),
  );
  const [unresolved, setUnresolved] = useState<Unresolved[]>(() =>
    initialUnresolved.map((u) => ({ ...u, key: nextKey() })),
  );
  const [view, setView] = useState<View_>({ kind: 'list' });
  const toList = () => setView({ kind: 'list' });

  const update = (key: string, change: (entry: DraftEntry) => DraftEntry) =>
    setEntries((all) => all.map((e) => (e.key === key ? change(e) : e)));
  const removeEntry = (key: string) => setEntries((all) => all.filter((e) => e.key !== key));
  const resolve = (key: string) => setUnresolved((all) => all.filter((u) => u.key !== key));
  const addFood = (food: Food, mention: string) =>
    setEntries((all) => [
      ...all,
      {
        key: nextKey(),
        kind: 'food',
        food,
        portion: initialPortion(food, null),
        mention,
        confidence: 'high',
        quantityAssumed: false,
        inferred: false,
      },
    ]);

  if (view.kind === 'portion') {
    const entry = entries.find((e) => e.key === view.key);
    if (entry?.kind !== 'food') return null;
    return (
      <PortionSheet
        food={entry.food}
        initial={entry.portion}
        favourite={favouriteIds.has(entry.food.id)}
        onToggleFavourite={() => onToggleFavourite(entry.food)}
        showNumbers={showNumbers}
        submitLabel={d.save}
        onSubmit={(portion: Portion) => {
          // A portion the user chose is no longer assumed nor doubtful.
          update(entry.key, (e) =>
            e.kind === 'food' ? { ...e, portion, quantityAssumed: false, confidence: 'high' } : e,
          );
          toList();
        }}
        onCancel={toList}
        testID="draft-portion"
      >
        <View style={styles.gap}>
          <Button
            variant="secondary"
            label={d.change}
            onPress={() => setView({ kind: 'search', purpose: 'replace', key: entry.key })}
            testID="draft-change-food"
          />
          <Button
            variant="ghost"
            label={d.remove}
            onPress={() => {
              removeEntry(entry.key);
              toList();
            }}
            testID="draft-remove"
          />
        </View>
      </PortionSheet>
    );
  }

  if (view.kind === 'search') {
    const replacing =
      view.purpose === 'replace' ? entries.find((e) => e.key === view.key) : undefined;
    return (
      <DraftFoodSearch
        title={
          replacing?.kind === 'food'
            ? format(d.replaceTitle, { food: replacing.food.name })
            : d.searchTitle
        }
        initialQuery={view.purpose === 'resolve' ? view.mention : ''}
        showNumbers={showNumbers}
        onPick={(food) => {
          if (view.purpose === 'replace') {
            update(view.key, (e) =>
              e.kind === 'food'
                ? { ...e, food, portion: portionForReplacement(e.portion, e.food, food) }
                : e,
            );
          } else if (view.purpose === 'resolve') {
            addFood(food, view.mention);
            resolve(view.key);
          } else {
            addFood(food, food.name);
          }
          toList();
        }}
        onCancel={toList}
      />
    );
  }

  if (view.kind === 'quick') {
    return (
      <QuickAddForm
        initialName={view.mention}
        onSubmit={(values) => {
          setEntries((all) => [...all, { key: nextKey(), kind: 'quick', values }]);
          resolve(view.key);
          toList();
        }}
        onCancel={toList}
      />
    );
  }

  const foods = entries.flatMap((e) => (e.kind === 'food' ? [e] : []));
  const quickKcal = entries.reduce((sum, e) => sum + (e.kind === 'quick' ? e.values.kcal : 0), 0);
  const totalKcal = draftTotals(foods).kcal + quickKcal;
  const count = entries.length;

  return (
    <Screen
      testID="meal-draft"
      footer={
        <>
          {showNumbers && count > 0 ? (
            <AppText variant="label" testID="draft-total">
              {format(d.total, { kcal: formatNumber(totalKcal, locale, 0) })}
            </AppText>
          ) : null}
          <Button
            label={count === 1 ? d.submitOne : format(d.submitOther, { count: String(count) })}
            onPress={() => onSave(entries)}
            disabled={count === 0}
            testID="draft-save"
          />
          <Button variant="ghost" label={t.food.portion.cancel} onPress={onCancel} />
        </>
      }
    >
      <AppText variant="title" accessibilityRole="header">
        {d.title}
      </AppText>
      {photoUri ? (
        <Image
          source={{ uri: photoUri }}
          style={[styles.photo, { backgroundColor: colors.surface }]}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {mealPicker}
      <Notice
        tone="info"
        message={source === 'photo' ? d.photoNote : d.textNote}
        testID="draft-note"
      />
      <View testID="draft-items">
        {entries.map((entry) =>
          entry.kind === 'food' ? (
            <DraftFoodRow
              key={entry.key}
              entry={entry}
              showNumbers={showNumbers}
              source={source}
              onPress={() => setView({ kind: 'portion', key: entry.key })}
            />
          ) : (
            <View key={entry.key} style={[styles.row, { borderColor: colors.border }]}>
              <View style={styles.rowText}>
                <AppText>{entry.values.label}</AppText>
                {showNumbers ? (
                  <AppText tone="muted">
                    {format(t.food.kcal, { value: String(entry.values.kcal) })}
                  </AppText>
                ) : null}
              </View>
              <Button
                variant="ghost"
                label={d.remove}
                accessibilityLabel={`${d.remove}: ${entry.values.label}`}
                onPress={() => removeEntry(entry.key)}
              />
            </View>
          ),
        )}
      </View>
      {unresolved.map((u) => (
        <View
          key={u.key}
          style={[styles.unresolved, { borderColor: colors.border }]}
          testID="draft-unresolved"
        >
          <AppText>{format(d.notFound, { words: u.mention })}</AppText>
          <View style={styles.actions}>
            <Button
              variant="secondary"
              label={d.search}
              onPress={() =>
                setView({ kind: 'search', purpose: 'resolve', key: u.key, mention: u.mention })
              }
              testID="draft-unresolved-search"
            />
            <Button
              variant="secondary"
              label={d.quickAdd}
              onPress={() => setView({ kind: 'quick', key: u.key, mention: u.mention })}
              testID="draft-unresolved-quick"
            />
          </View>
        </View>
      ))}
      {unresolved.length > 0 && count > 0 ? (
        <Notice tone="warning" message={d.unresolvedLeft} testID="draft-unresolved-left" />
      ) : null}
      {count === 0 && unresolved.length === 0 ? (
        <AppText tone="muted" testID="draft-empty">
          {d.empty}
        </AppText>
      ) : null}
      {count < MEAL_DRAFT_LIMITS.itemsMax ? (
        <Button
          variant="secondary"
          label={d.addAnother}
          onPress={() => setView({ kind: 'search', purpose: 'add' })}
          testID="draft-add-another"
        />
      ) : null}
    </Screen>
  );
}

/** A food of the draft: name, portion, kcal and the marks of AC4 and AC5. Tap to edit it. */
function DraftFoodRow({
  entry,
  showNumbers,
  source,
  onPress,
}: {
  entry: Extract<DraftEntry, { kind: 'food' }>;
  showNumbers: boolean;
  source: 'text' | 'photo';
  onPress: () => void;
}) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const d = t.food.draft;
  const preview = portionPreview(entry.food, entry.portion);
  const portion = preview ? formatPortion(preview, locale) : null;
  const marks = [
    entry.inferred ? d.probable : null,
    entry.quantityAssumed ? d.assumed : null,
    // A sentence gives exact amounts: any estimate there is worth a look (domain review).
    !entry.quantityAssumed &&
    (entry.confidence === 'low' || (source === 'text' && entry.confidence === 'medium'))
      ? d.checkAmount
      : null,
  ].filter((mark): mark is string => mark !== null);
  const details = [
    portion,
    showNumbers && preview
      ? format(t.food.kcal, { value: formatNumber(preview.nutrients.kcal, locale, 0) })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={format(d.edit, { food: entry.food.name })}
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
      testID="draft-item"
    >
      <View style={styles.rowText}>
        <AppText>
          {entry.food.brand ? `${entry.food.name} · ${entry.food.brand}` : entry.food.name}
        </AppText>
        {details ? <AppText tone="muted">{details}</AppText> : null}
        {entry.mention && entry.mention !== entry.food.name ? (
          <AppText tone="muted" variant="caption">
            {format(d.fromWords, { words: entry.mention })}
          </AppText>
        ) : null}
        {marks.length > 0 ? (
          <View style={styles.marks}>
            {marks.map((mark) => (
              <View
                key={mark}
                style={[styles.mark, { backgroundColor: colors.warningSurface }]}
                testID="draft-mark"
              >
                <AppText variant="caption">{mark}</AppText>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** The search inside the draft: to add a food, give a food to a mention, or replace a food (AC6, AC7). */
function DraftFoodSearch({
  title,
  initialQuery,
  showNumbers,
  onPick,
  onCancel,
}: {
  title: string;
  initialQuery: string;
  showNumbers: boolean;
  onPick: (food: Food) => void;
  onCancel: () => void;
}) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const a = t.food.add;
  const [query, setQuery] = useState(initialQuery.slice(0, FOOD_LOG_LIMITS.searchMaxLength));
  const debounced = useDebouncedValue(query, 250).trim();
  const enabled = debounced.length >= FOOD_LOG_LIMITS.searchMinLength;
  const search = useFoodSearch(enabled ? debounced : '', locale);
  const results = search.data ?? [];

  return (
    <Screen
      testID="draft-search"
      footer={<Button variant="ghost" label={t.food.portion.cancel} onPress={onCancel} />}
    >
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      <TextField
        label={a.search}
        placeholder={a.searchPlaceholder}
        value={query}
        onChangeText={setQuery}
        maxLength={FOOD_LOG_LIMITS.searchMaxLength}
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
        inputMode="search"
        testID="draft-search-field"
      />
      {search.isFetching ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t.common.loading} />
      ) : null}
      {search.isError ? <Notice tone="danger" message={a.searchError} /> : null}
      {enabled && search.isSuccess && results.length === 0 ? (
        <AppText tone="muted">{format(a.noResults, { query: debounced })}</AppText>
      ) : null}
      <View testID="draft-search-results">
        {results.map((food) => {
          const preview = portionPreview(food, initialPortion(food, null));
          const kcal =
            showNumbers && preview
              ? format(t.food.kcal, { value: formatNumber(preview.nutrients.kcal, locale, 0) })
              : null;
          const portion = preview ? formatPortion(preview, locale) : null;
          return (
            <Pressable
              key={food.id}
              onPress={() => onPick(food)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
              testID="draft-search-result"
            >
              <View style={styles.rowText}>
                <AppText>{food.brand ? `${food.name} · ${food.brand}` : food.name}</AppText>
                {portion ? (
                  <AppText tone="muted">{kcal ? `${portion} · ${kcal}` : portion}</AppText>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: tokens.space.sm, marginTop: tokens.space.sm },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    maxHeight: 140,
    borderRadius: tokens.radius.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    minHeight: 56,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  marks: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs },
  mark: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 2,
    borderRadius: tokens.radius.sm,
  },
  unresolved: {
    gap: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
