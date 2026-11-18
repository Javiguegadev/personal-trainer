import type { Workout } from '@pt/contracts';
import { formatNumber, workoutSetCount } from '@pt/core';
import { useI18n } from './useI18n';

/** How a saved workout is named and summed up (spec 009 AC20, AC21). */
export function useWorkoutText() {
  const { t, format, locale } = useI18n();
  const tr = t.training;
  const count = (n: number, one: string, other: string) =>
    n === 1 ? one : format(other, { count: formatNumber(n, locale) });

  return {
    /** The name the user gave, or the activity type, or "Entreno de gimnasio". */
    label: (workout: Workout) =>
      workout.name ??
      (workout.kind === 'gym' ? tr.gymDefault : tr.activities[workout.activity ?? 'other']),
    minutes: (minutes: number) => format(tr.minutes, { count: formatNumber(minutes, locale) }),
    /** "5 ejercicios · 18 series", or the effort of an activity. */
    detail: (workout: Workout) => {
      if (workout.kind !== 'gym') {
        return workout.sessionRpe === null
          ? null
          : format(tr.rpeValue, { value: workout.sessionRpe });
      }
      const exercises = workout.exercises.filter((e) => e.sets.length > 0).length;
      return `${count(exercises, tr.exercisesOne, tr.exercisesOther)} · ${count(
        workoutSetCount(workout),
        tr.setsOne,
        tr.setsOther,
      )}`;
    },
    records: (n: number) => count(n, tr.recordsOne, tr.recordsOther),
  };
}
