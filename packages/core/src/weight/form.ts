import { PROFILE_LIMITS, WEIGHT_LIMITS, type Locale, type Units } from '@pt/contracts';
import { addDays, daysBetween, lastDays } from '../dates';
import { formatDecimal, parseDecimal } from '../format';
import type { FormErrorCode } from '../profile/form';
import { kgToLb, lbToKg, roundTo } from '../units';
import type { WeightPoint } from './trend';

/**
 * The weight sheet (spec 003 AC6, AC7): the value as typed, changed with two buttons, validated into
 * kilograms. Pounds exist only in the field; everything else is metric.
 */

/** One tap on − or +: 0.1 kg, or 0.2 lb (about 0.09 kg). */
export const WEIGHT_STEP: Record<Units, number> = { metric: 0.1, imperial: 0.2 };

/** A reading further than this from the previous one asks for confirmation (AC7). Not a clinical value. */
export const WEIGHT_CONFIRM_RATIO = 0.03;
const CONFIRM_LOOKBACK_DAYS = 7;

/** Days offered as chips in the sheet: today and the 6 days before. */
export const WEIGHT_DAY_CHIPS = 7;

/** The text shown in the field, and in lists, for a weight in kilograms: at most one decimal in either unit. */
export function weightFieldFromKg(kg: number, units: Units, locale: Locale): string {
  return formatDecimal(units === 'metric' ? kg : kgToLb(kg), locale, 1);
}

export type ParsedWeightField =
  { ok: true; weightKg: number } | { ok: false; error: FormErrorCode };

export function parseWeightField(text: string, units: Units): ParsedWeightField {
  if (text.trim() === '') return { ok: false, error: 'required' };
  const parsed = parseDecimal(text);
  if (parsed === null) return { ok: false, error: 'invalid_number' };
  const weightKg = roundTo(units === 'metric' ? parsed : lbToKg(parsed), 1);
  if (weightKg < PROFILE_LIMITS.weightKg.min) return { ok: false, error: 'too_small' };
  if (weightKg > PROFILE_LIMITS.weightKg.max) return { ok: false, error: 'too_big' };
  return { ok: true, weightKg };
}

/** The field after one tap on − (`-1`) or + (`1`). An empty or unreadable field is left as it is. */
export function stepWeightField(
  text: string,
  units: Units,
  locale: Locale,
  direction: -1 | 1,
): string {
  const parsed = parseDecimal(text);
  if (parsed === null) return text;
  return formatDecimal(roundTo(parsed + direction * WEIGHT_STEP[units], 1), locale, 1);
}

/** Today first, then the days before it. */
export function weightDayOptions(today: string): string[] {
  return lastDays(today, WEIGHT_DAY_CHIPS);
}

/** An entry cannot be dated in the future or more than 5 years ago (AC7). */
export function checkWeightDate(localDate: string, today: string): 'in_future' | 'too_old' | null {
  if (localDate > today) return 'in_future';
  if (localDate < addDays(today, -WEIGHT_LIMITS.historyYears * 365)) return 'too_old';
  return null;
}

/**
 * Whether the sheet asks "is that right?" before saving (AC7): the weight is more than 3 % away from the
 * latest entry of the 7 days before `localDate`. Returns that entry's weight, or null.
 */
export function weightNeedingConfirmation(
  weightKg: number,
  localDate: string,
  entries: readonly WeightPoint[],
): number | null {
  const previous = entries
    .filter((entry) => {
      const age = daysBetween(entry.localDate, localDate);
      return age >= 1 && age <= CONFIRM_LOOKBACK_DAYS;
    })
    .sort((a, b) => (a.localDate < b.localDate ? 1 : -1))[0];
  if (!previous) return null;
  return Math.abs(weightKg - previous.weightKg) / previous.weightKg > WEIGHT_CONFIRM_RATIO
    ? previous.weightKg
    : null;
}
