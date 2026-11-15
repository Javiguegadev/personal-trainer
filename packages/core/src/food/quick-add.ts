import { FOOD_LOG_LIMITS } from '@pt/contracts';

export interface QuickAddValues {
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

/**
 * True when the energy of the macros (4·P + 4·C + 9·F) exceeds the kcal by more than 20 %: the form asks
 * for confirmation before saving, to catch a typing mistake (spec 005 AC10).
 */
export function quickAddEnergyMismatch(values: QuickAddValues): boolean {
  const macroKcal = 4 * (values.proteinG ?? 0) + 4 * (values.carbsG ?? 0) + 9 * (values.fatG ?? 0);
  return macroKcal > values.kcal * (1 + FOOD_LOG_LIMITS.quickAddEnergyTolerance) + 1e-9;
}
