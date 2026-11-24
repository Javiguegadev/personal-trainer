import type { AiUsage, OwnExerciseEntry, WorkoutCatalogEntry } from '@pt/ai';
import {
  WORKOUT_DRAFT_LIMITS,
  type Exercise,
  type WorkoutDraftResponse,
  type WorkoutTextDraftRequest,
} from '@pt/contracts';
import { labelFor, workoutDraft } from '@pt/core';
import type { Deps } from '../deps';
import type { ExerciseCatalog } from './training';

export interface WorkoutDraftResult {
  draft: WorkoutDraftResponse;
  usage: AiUsage;
}

interface CatalogRefs {
  entries: WorkoutCatalogEntry[];
  refs: Map<string, Exercise>;
}

/**
 * Short refs for the catalog (`e1`… in the store's order: most popular first). The same catalog object
 * always gives the same array, so the prompt block built from it stays byte-identical and cached.
 */
function catalogRefs(catalog: ExerciseCatalog): CatalogRefs {
  const refs = new Map<string, Exercise>();
  const entries = catalog.exercises.map((exercise, i) => {
    const ref = `e${i + 1}`;
    refs.set(ref, exercise);
    return {
      ref,
      nameEs: exercise.nameEs,
      nameEn: exercise.nameEn,
      synonyms: [...exercise.synonymsEs, ...exercise.synonymsEn],
      tracking: exercise.tracking,
    };
  });
  return { entries, refs };
}

/**
 * A workout draft from a sentence (spec 012 AC3–AC9). The model sees the whole curated catalog (in the
 * cached system prompt) and the names and tracking of the user's own exercises, each under a short ref
 * (`e12`, `u3`): fewer tokens than ids, and a ref this request did not hand out cannot come back as an
 * exercise. `@pt/core` (`workoutDraft`) checks the rest. Nothing is stored: the user saves the draft.
 */
export function createWorkoutDrafter(
  deps: Pick<Deps, 'store' | 'readWorkout'>,
  getCatalog: () => Promise<ExerciseCatalog>,
) {
  const byCatalog = new WeakMap<ExerciseCatalog, CatalogRefs>();
  const refsOf = (catalog: ExerciseCatalog) => {
    let found = byCatalog.get(catalog);
    if (!found) {
      found = catalogRefs(catalog);
      byCatalog.set(catalog, found);
    }
    return found;
  };

  return async function draftWorkout(
    userId: string,
    request: WorkoutTextDraftRequest,
  ): Promise<WorkoutDraftResult> {
    const [catalog, mine] = await Promise.all([
      getCatalog(),
      deps.store.listCustomExercises(userId),
    ]);
    const shared = refsOf(catalog);
    const refs = new Map(shared.refs);
    const own: OwnExerciseEntry[] = mine
      .slice(0, WORKOUT_DRAFT_LIMITS.ownExercisesMax)
      .map((exercise, i) => {
        const ref = `u${i + 1}`;
        refs.set(ref, exercise);
        return { ref, name: labelFor(exercise, request.locale), tracking: exercise.tracking };
      });

    const { reading, usage } = await deps.readWorkout({
      text: request.text,
      today: request.today,
      catalog: shared.entries,
      own,
    });
    return { draft: workoutDraft(reading, refs, request.today, request.localDate), usage };
  };
}
