import { MUSCLE_FILTERS, type Exercise, type Locale, type MuscleFilter } from '@pt/contracts';
import { buildFoodSearchIndex, searchFoods, type FoodSearchIndex } from '../food/search';

/**
 * Exercise search (spec 009 AC3), on the device: the catalog is small, so the same ranking as the food
 * search runs over it (whole name, name prefix, every word, synonyms, one typo, popularity). The name
 * of the user's locale ranks as the name; the synonyms of both locales and the other name count as
 * synonyms, because Spanish gyms use English names ("hip thrust", "face pull").
 */

type SearchableExercise = Pick<
  Exercise,
  'id' | 'nameEs' | 'nameEn' | 'synonymsEs' | 'synonymsEn' | 'popularity'
>;

const indexes = new WeakMap<
  readonly SearchableExercise[],
  Partial<Record<Locale, FoodSearchIndex>>
>();

function exerciseIndex(exercises: readonly SearchableExercise[], locale: Locale): FoodSearchIndex {
  const cached = indexes.get(exercises) ?? {};
  const existing = cached[locale];
  if (existing) return existing;
  const index = buildFoodSearchIndex(
    exercises.map((e) =>
      locale === 'en'
        ? {
            id: e.id,
            nameEs: e.nameEn,
            nameEn: e.nameEn,
            synonymsEs: [...e.synonymsEn, e.nameEs, ...e.synonymsEs],
            popularity: e.popularity,
          }
        : {
            id: e.id,
            nameEs: e.nameEs,
            nameEn: e.nameEn,
            synonymsEs: [...e.synonymsEs, e.nameEn, ...e.synonymsEn],
            popularity: e.popularity,
          },
    ),
  );
  indexes.set(exercises, { ...cached, [locale]: index });
  return index;
}

/**
 * Ids of the best matches, best first (AC3). `preferred` holds the exercises the user did recently:
 * they come first among equal matches.
 */
export function searchExercises(
  exercises: readonly SearchableExercise[],
  query: string,
  locale: Locale,
  limit = 30,
  preferred?: ReadonlySet<string>,
): string[] {
  // The food search ranks names in Spanish only unless the locale is English; the index above already
  // put the locale's name in `nameEs`, so it always runs with `es`.
  return searchFoods(exerciseIndex(exercises, locale), query, 'es', limit, undefined, preferred);
}

/** The muscle chips of the picker (AC5). "Cardio" is a category, the others are primary muscles. */
export function filterExercises<T extends Pick<Exercise, 'primaryMuscles' | 'category'>>(
  exercises: readonly T[],
  filter: MuscleFilter,
): T[] {
  if (filter === 'cardio') return exercises.filter((e) => e.category === 'cardio');
  const groups: readonly string[] = MUSCLE_FILTERS[filter];
  return exercises.filter((e) => e.primaryMuscles.some((m) => groups.includes(m)));
}

/** The name of an exercise in the user's locale. */
export function exerciseName(
  exercise: Pick<Exercise, 'nameEs' | 'nameEn'>,
  locale: Locale,
): string {
  return locale === 'en' ? exercise.nameEn : exercise.nameEs;
}
