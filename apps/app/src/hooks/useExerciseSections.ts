import type { Exercise, MuscleFilter } from '@pt/contracts';
import { exerciseName, filterExercises, recentExerciseIds, searchExercises } from '@pt/core';
import { useMemo } from 'react';
import type { ExerciseSection } from '@/components/ExercisePickerList';
import { useI18n } from './useI18n';
import { useExerciseLookups } from './useTraining';

/**
 * The sections of the picker and the library (spec 009 AC3, AC5), searched on the device: results for a
 * query; otherwise a muscle group, or the recent exercises and then all of them, the most common first.
 */
export function useExerciseSections(query: string, filter: MuscleFilter | null) {
  const { t, locale } = useI18n();
  const { exercises, exerciseById, statsList } = useExerciseLookups();
  const p = t.training.picker;

  return useMemo(() => {
    const recents = recentExerciseIds(statsList)
      .map((id) => exerciseById.get(id))
      .filter((e): e is Exercise => e !== undefined);
    const trimmed = query.trim();
    if (trimmed) {
      const ids = searchExercises(
        exercises,
        trimmed,
        locale,
        30,
        new Set(recents.map((e) => e.id)),
      );
      const data = ids.map((id) => exerciseById.get(id)).filter((e): e is Exercise => !!e);
      return data.length ? [{ key: 'results', title: p.results, data }] : [];
    }
    const byPopularity = (list: readonly Exercise[]) =>
      [...list].sort(
        (a, b) =>
          b.popularity - a.popularity ||
          exerciseName(a, locale).localeCompare(exerciseName(b, locale), locale),
      );
    if (filter) {
      return [
        {
          key: filter,
          title: t.training.muscleFilters[filter],
          data: byPopularity(filterExercises(exercises, filter)),
        },
      ];
    }
    const sections: ExerciseSection[] = [];
    if (recents.length) sections.push({ key: 'recents', title: p.recents, data: recents });
    sections.push({ key: 'all', title: p.all, data: byPopularity(exercises) });
    return sections;
  }, [query, filter, exercises, exerciseById, statsList, locale, p, t]);
}
