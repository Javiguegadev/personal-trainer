import type { Units } from '@pt/contracts';
import { formatDecimal, kgToLb, weightFieldFromKg } from '@pt/core';
import { useI18n } from './useI18n';

/** Weights for display in the user's units ("79,6 kg", "175.5 lb"). Everything else stays in kg. */
export function useWeightFormat(units: Units) {
  const { t, format, locale } = useI18n();
  const unit = t.weight.units[units];
  const toUnits = (kg: number) => (units === 'metric' ? kg : kgToLb(kg));
  const withUnit = (value: string) => format(t.weight.value, { value, unit });
  return {
    unit,
    weight: (kg: number) => withUnit(weightFieldFromKg(kg, units, locale)),
    /** A difference with its sign: "−0,4 kg", "+0,3 kg", "0 kg". */
    change: (kg: number) => {
      const value = toUnits(kg);
      const text = formatDecimal(Math.abs(value), locale, 1);
      const sign = Math.round(Math.abs(value) * 10) === 0 ? '' : value < 0 ? '−' : '+';
      return withUnit(sign + text);
    },
    /** A distance, always positive. */
    distance: (kg: number) => withUnit(formatDecimal(Math.abs(toUnits(kg)), locale, 1)),
  };
}
