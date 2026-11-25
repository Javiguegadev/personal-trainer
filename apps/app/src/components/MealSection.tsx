import type { MealItem, MealType, PlannedMealItem } from '@pt/contracts';
import { dailyTotals, formatNumber, formatPortion } from '@pt/core';
import { tokens } from '@pt/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { Button } from './Button';
import { SyncBadge } from './SyncBadge';

interface MealSectionProps {
  meal: MealType;
  /** The items of this meal on the selected day, in the order they were logged. */
  items: readonly MealItem[];
  /** False with an eating-disorder signal: foods and portions, no numbers (AC18). */
  showNumbers: boolean;
  /** Items with a write that has not reached the server yet (AC19). */
  pendingIds: readonly string[];
  /** Yesterday's items of this meal, when it is empty today (AC13). */
  repeatable: { count: number; kcal: number } | null;
  /** Absent on a day that only shows what was logged (spec 010 AC12). */
  onAdd?: () => void;
  onRepeat: () => void;
  onOpenItem: (item: MealItem) => void;
  /** The pending planned items of this meal (spec 013 AC8), shown muted under the logged ones. */
  planned?: readonly PlannedMealItem[];
  /** "Registrar lo planificado": absent where the plan cannot be logged. */
  onLogPlanned?: () => void;
  onOpenPlanned?: (item: PlannedMealItem) => void;
}

/**
 * One meal of the day (spec 005 AC15): its items, its total and "Añadir". An empty meal is one line.
 * Its pending planned items follow, muted and marked "Plan", with "Registrar lo planificado" (spec 013
 * AC8); they never count in the total.
 */
export function MealSection({
  meal,
  items,
  showNumbers,
  pendingIds,
  repeatable,
  onAdd,
  onRepeat,
  onOpenItem,
  planned = [],
  onLogPlanned,
  onOpenPlanned,
}: MealSectionProps) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const f = t.food;
  const name = f.meals[meal];
  const kcal = (value: number) =>
    format(f.kcal, { value: formatNumber(Math.round(value), locale) });
  const foods = (count: number) =>
    count === 1 ? f.foodsOne : format(f.foodsOther, { count: String(count) });

  return (
    <View
      style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID={`meal-${meal}`}
    >
      <View style={styles.header}>
        <View style={styles.title}>
          <AppText variant="subtitle" weight="bold" accessibilityRole="header">
            {name}
          </AppText>
          {showNumbers && items.length > 0 ? (
            <AppText variant="caption" tone="muted" testID={`meal-${meal}-kcal`}>
              {kcal(dailyTotals(items).kcal)}
            </AppText>
          ) : null}
        </View>
        {onAdd ? (
          <Button
            variant="secondary"
            label={f.meal.add}
            accessibilityLabel={format(f.meal.addTo, { meal: name })}
            onPress={onAdd}
            testID={`meal-${meal}-add`}
          />
        ) : null}
      </View>

      {items.map((item) => {
        const portion = formatPortion(item, locale);
        return (
          <Pressable
            key={item.id}
            role="button"
            accessibilityLabel={format(f.meal.editItem, { food: item.label })}
            onPress={() => onOpenItem(item)}
            testID="meal-item"
            style={({ pressed }) => [
              styles.item,
              { borderTopColor: colors.border, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <View style={styles.itemMain}>
              <AppText>{item.label}</AppText>
              {portion ? (
                <AppText variant="caption" tone="muted">
                  {portion}
                </AppText>
              ) : null}
              {/* A planned item that was logged (spec 013 AC9): no longer pending. */}
              {item.plannedItemId ? (
                <AppText variant="caption" tone="muted" testID="meal-item-registered">
                  {t.plan.registered}
                </AppText>
              ) : null}
              {pendingIds.includes(item.id) ? <SyncBadge /> : null}
            </View>
            {showNumbers ? (
              <AppText variant="label" weight="bold">
                {kcal(item.nutrients.kcal)}
              </AppText>
            ) : null}
          </Pressable>
        );
      })}

      {planned.map((item) => {
        const portion = formatPortion(item, locale);
        return (
          <Pressable
            key={item.id}
            role="button"
            accessibilityLabel={format(t.plan.openPlanned, { food: item.label })}
            disabled={!onOpenPlanned}
            onPress={() => onOpenPlanned?.(item)}
            testID="meal-planned-item"
            style={({ pressed }) => [
              styles.item,
              { borderTopColor: colors.border, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <View style={styles.itemMain}>
              <AppText tone="muted">{item.label}</AppText>
              <AppText variant="caption" tone="muted">
                {[t.plan.tag, portion].filter(Boolean).join(' · ')}
              </AppText>
              {pendingIds.includes(item.id) ? <SyncBadge /> : null}
            </View>
            {showNumbers ? (
              <AppText variant="label" tone="muted">
                {kcal(item.nutrients.kcal)}
              </AppText>
            ) : null}
          </Pressable>
        );
      })}

      {onLogPlanned && planned.length > 0 ? (
        <Button
          variant="secondary"
          label={
            showNumbers
              ? format(t.plan.logPlanned, {
                  count: foods(planned.length),
                  kcal: formatNumber(Math.round(dailyTotals(planned).kcal), locale),
                })
              : format(t.plan.logPlannedNoNumbers, { count: foods(planned.length) })
          }
          accessibilityLabel={format(t.plan.logPlannedA11y, { meal: name })}
          onPress={onLogPlanned}
          testID={`meal-${meal}-log-planned`}
        />
      ) : null}

      {repeatable ? (
        <Button
          variant="ghost"
          label={
            showNumbers
              ? format(f.meal.repeat, {
                  count: foods(repeatable.count),
                  kcal: formatNumber(repeatable.kcal, locale),
                })
              : format(f.meal.repeatNoNumbers, { count: foods(repeatable.count) })
          }
          onPress={onRepeat}
          testID={`meal-${meal}-repeat`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: tokens.radius.lg,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.space.sm,
  },
  title: { flex: 1 },
  item: {
    minHeight: tokens.layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    marginTop: tokens.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemMain: { flex: 1, gap: 2 },
});
