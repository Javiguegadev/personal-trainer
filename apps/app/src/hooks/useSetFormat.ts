import type { ExerciseTracking, SetValues, Units } from '@pt/contracts';
import {
  displayWeight,
  formatDecimal,
  formatDuration,
  formatNumber,
  groupSets,
  type BestKind,
} from '@pt/core';
import { useI18n } from './useI18n';

/**
 * How sets read in the user's units (spec 009 AC7, AC10, AC15): "8 · 60 kg", "12 reps", "1:30",
 * "2,5 km · 12:00". Everything is stored in kg, seconds and metres; lb only here, at the UI edge.
 */
export function useSetFormat(units: Units) {
  const { t, format, locale } = useI18n();
  const v = t.training.values;
  const unit = t.weight.units[units];

  const weightField = (kg: number) => formatDecimal(displayWeight(kg, units), locale, 2);
  const weight = (kg: number) => format(v.weight, { value: weightField(kg), unit });
  const distance = (m: number) =>
    m >= 1000
      ? format(v.km, { value: formatDecimal(m / 1000, locale, 2) })
      : format(v.meters, { value: formatNumber(m, locale) });

  const set = (values: SetValues, tracking: ExerciseTracking): string => {
    switch (tracking) {
      case 'weight_reps':
        return format(v.weightReps, {
          reps: values.reps ?? '–',
          weight: values.weightKg === null ? '–' : weight(values.weightKg),
        });
      case 'reps':
        return values.weightKg
          ? format(v.repsExtra, { reps: values.reps ?? '–', weight: weight(values.weightKg) })
          : format(v.reps, { reps: values.reps ?? '–' });
      case 'duration':
        return values.durationS === null ? '–' : formatDuration(values.durationS);
      case 'distance_duration': {
        const d = values.distanceM === null ? '–' : distance(values.distanceM);
        return values.durationS === null
          ? format(v.distance, { distance: d })
          : format(v.distanceTime, { distance: d, time: formatDuration(values.durationS) });
      }
    }
  };

  return {
    unit,
    weight,
    weightField,
    distance,
    set,
    /** "3 × 8 · 60 kg, 6 · 65 kg": equal sets in a row are grouped (AC7). */
    sets: (sets: readonly SetValues[], tracking: ExerciseTracking) =>
      groupSets(sets)
        .map((g) =>
          g.count === 1
            ? set(g.values, tracking)
            : format(t.training.session.setGroup, {
                count: g.count,
                set: set(g.values, tracking),
              }),
        )
        .join(', '),
    /** The value of a best (AC10, AC15). */
    best: (kind: BestKind, value: number) =>
      kind === 'heaviestKg' || kind === 'oneRepMaxKg'
        ? weight(value)
        : kind === 'longestS'
          ? formatDuration(value)
          : kind === 'longestM'
            ? distance(value)
            : formatNumber(value, locale),
  };
}

export type SetFormat = ReturnType<typeof useSetFormat>;
