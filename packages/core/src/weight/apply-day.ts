import type { WeightPoint } from './trend';

/** The log with the entry of `localDate` set to `weightKg` (one entry per day, spec 003 AC8). */
export function withWeightOnDay(
  entries: readonly WeightPoint[],
  localDate: string,
  weightKg: number,
): WeightPoint[] {
  return [...entries.filter((entry) => entry.localDate !== localDate), { localDate, weightKg }];
}
