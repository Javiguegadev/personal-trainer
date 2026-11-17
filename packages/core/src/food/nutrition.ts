import {
  MEAL_TYPES,
  type FoodServing,
  type MealItem,
  type MealType,
  type Nutrients,
  type Portion,
  type SafetyFlag,
} from '@pt/contracts';

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** The snapshot of a portion (spec 005 AC9): values per 100 g scaled to `grams`, to two decimals. */
export function itemNutrition(per100g: Nutrients, grams: number): Nutrients {
  const scale = (value: number) => round((value * grams) / 100, 2);
  return {
    kcal: scale(per100g.kcal),
    proteinG: scale(per100g.proteinG),
    carbsG: scale(per100g.carbsG),
    fatG: scale(per100g.fatG),
    fiberG: per100g.fiberG === null ? null : scale(per100g.fiberG),
  };
}

/** Grams of a portion (AC8), to one decimal; null when the serving is not one of the food's. */
export function portionGrams(portion: Portion, servings: readonly FoodServing[]): number | null {
  if (portion.kind === 'grams') return portion.grams;
  const serving = servings.find((s) => s.id === portion.servingId);
  return serving ? round(serving.grams * portion.servings, 1) : null;
}

const EMPTY: Nutrients = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null };

/** Sum of the snapshots, unrounded (AC16). Fiber sums the known values; null when none is known. */
export function dailyTotals(items: readonly Pick<MealItem, 'nutrients'>[]): Nutrients {
  return items.reduce<Nutrients>(
    (sum, { nutrients: n }) => ({
      kcal: sum.kcal + n.kcal,
      proteinG: sum.proteinG + n.proteinG,
      carbsG: sum.carbsG + n.carbsG,
      fatG: sum.fatG + n.fatG,
      fiberG: n.fiberG === null ? sum.fiberG : (sum.fiberG ?? 0) + n.fiberG,
    }),
    EMPTY,
  );
}

/** Totals per meal, with every meal present in the order of the day (AC15). */
export function mealTotals(
  items: readonly Pick<MealItem, 'mealType' | 'nutrients'>[],
): Record<MealType, Nutrients> {
  return Object.fromEntries(
    MEAL_TYPES.map((meal) => [meal, dailyTotals(items.filter((i) => i.mealType === meal))]),
  ) as Record<MealType, Nutrients>;
}

export interface MacroTargets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** What is left of each target (AC16); negative above it. Unrounded: the UI rounds. */
export function remaining(targets: MacroTargets, totals: Nutrients): MacroTargets {
  return {
    kcal: round(targets.kcal - totals.kcal, 6),
    proteinG: round(targets.proteinG - totals.proteinG, 6),
    carbsG: round(targets.carbsG - totals.carbsG, 6),
    fatG: round(targets.fatG - totals.fatG, 6),
  };
}

/** With `ed_soft_stop` the food log shows foods and portions without any number (AC18). */
export function showsFoodNumbers(flags: readonly SafetyFlag[]): boolean {
  return !flags.includes('ed_soft_stop');
}
