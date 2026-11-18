import { FOOD_LOG_DAYS } from '@pt/api-client';
import {
  MEAL_TYPES,
  type MealItem,
  type MealType,
  type Profile,
  type Targets,
} from '@pt/contracts';
import { dailyTotals, lastDays, repeatableMeal, showsFoodNumbers } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { DaySelector } from '@/components/DaySelector';
import { FeedbackCard } from '@/components/FeedbackCard';
import { FoodRejectedNotice } from '@/components/FoodRejectedNotice';
import { MealSection } from '@/components/MealSection';
import { Notice } from '@/components/Notice';
import { NutritionSummaryCard } from '@/components/NutritionSummaryCard';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Screen } from '@/components/Screen';
import { UndoToast } from '@/components/UndoToast';
import { useFoodLogActions } from '@/hooks/useFoodLogActions';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useFoodLog, useMe, usePendingMealItemIds } from '@/lib/api';
import { useFoodUndo } from '@/lib/foodUndo';

/** The Food tab (spec 005 AC15, AC16): a day, its summary and its six meals. */
export default function FoodScreen() {
  const me = useMe();
  if (!me.data?.profile) return <BlockingState />;
  return <FoodLog profile={me.data.profile} targets={me.data.targets} />;
}

function FoodLog({ profile, targets }: { profile: Profile; targets: Targets | null }) {
  const { t, format } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const today = useToday();
  const log = useFoodLog(today);
  const pendingIds = usePendingMealItemIds();
  const actions = useFoodLogActions();
  const undo = useFoodUndo();
  const [day, setDay] = useState(today);
  const f = t.food;

  const showNumbers = showsFoodNumbers(profile.safetyFlags);
  const items = log.data ?? [];
  const dayItems = items.filter((item) => item.localDate === day);
  const itemsOf = (meal: MealType) => dayItems.filter((item) => item.mealType === meal);

  const add = (meal: MealType) =>
    router.push({ pathname: '/food/add', params: { date: day, meal } });
  const open = (item: MealItem) =>
    router.push({ pathname: '/food/item/[id]', params: { id: item.id } });

  let body;
  if (log.isPending) {
    body = (
      <ActivityIndicator
        color={colors.primary}
        accessibilityLabel={t.common.loading}
        style={styles.loading}
      />
    );
  } else if (log.isError && !log.data) {
    body = (
      <View style={styles.gap}>
        <Notice tone="danger" message={f.loadError} />
        <Button variant="secondary" label={t.common.retry} onPress={() => void log.refetch()} />
      </View>
    );
  } else {
    body = (
      <>
        {showNumbers ? (
          <NutritionSummaryCard
            title={f.summary.title}
            totals={dailyTotals(dayItems)}
            targets={targets}
          />
        ) : null}
        <FeedbackCard
          key={day}
          localDate={day}
          today={today}
          items={dayItems}
          safetyFlags={profile.safetyFlags}
          hasTargets={targets !== null}
        />
        {items.length === 0 ? (
          <AppText tone="muted" testID="food-first-hint">
            {f.firstHint}
          </AppText>
        ) : null}
        {MEAL_TYPES.map((meal) => (
          <MealSection
            key={meal}
            meal={meal}
            items={itemsOf(meal)}
            showNumbers={showNumbers}
            pendingIds={pendingIds}
            repeatable={repeatableMeal(items, meal, day)}
            onAdd={() => add(meal)}
            onRepeat={() => actions.repeatYesterday(items, meal, day)}
            onOpenItem={open}
          />
        ))}
      </>
    );
  }

  return (
    <Screen
      testID="food-screen"
      footer={
        undo ? (
          <UndoToast
            message={
              undo.kind === 'deleted'
                ? format(f.item.deleted, { food: undo.item.label })
                : format(undo.kind === 'added' ? f.item.added : f.item.repeated, {
                    count:
                      undo.items.length === 1
                        ? f.foodsOne
                        : format(f.foodsOther, { count: String(undo.items.length) }),
                  })
            }
            onUndo={() => actions.undo(undo)}
          />
        ) : undefined
      }
    >
      <AppText variant="title">{f.title}</AppText>
      <OfflineBanner />
      <FoodRejectedNotice />
      <DaySelector
        label={f.day}
        // Today and the 6 days before; the cached log holds one more day for "repeat yesterday".
        days={lastDays(today, FOOD_LOG_DAYS - 1)}
        today={today}
        value={day}
        onChange={setDay}
        layout="scroll"
        testID="food-day"
      />
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: tokens.space.xl },
  gap: { gap: tokens.space.sm },
});
