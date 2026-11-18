import type { Exercise, Workout, WorkoutExercise } from '@pt/contracts';
import { customExercise, type ExerciseSetRow } from '@pt/core';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  schema,
  sql,
  type Db,
  type SQL,
} from '@pt/db';
import type { Store } from '../deps';

const { exercises, workouts, workoutSets } = schema;

type ExerciseRow = typeof exercises.$inferSelect;
type WorkoutRow = typeof workouts.$inferSelect;
type SetRow = typeof workoutSets.$inferSelect;
type Reader = Pick<Db, 'select'>;

function toExercise(row: ExerciseRow): Exercise {
  return {
    id: row.id,
    key: row.key,
    origin: row.origin,
    nameEs: row.nameEs,
    nameEn: row.nameEn,
    synonymsEs: row.synonymsEs,
    synonymsEn: row.synonymsEn,
    tracking: row.tracking,
    category: row.category,
    primaryMuscles: row.primaryMuscles,
    secondaryMuscles: row.secondaryMuscles,
    equipment: row.equipment,
    popularity: row.popularity,
    source: row.source,
  };
}

const setValues = (row: SetRow) => ({
  reps: row.reps,
  weightKg: row.weightKg,
  durationS: row.durationS,
  distanceM: row.distanceM,
  restS: row.restS,
  setNumber: row.setNumber,
});

function toWorkout(row: WorkoutRow, sets: SetRow[]): Workout {
  // Sets come ordered by position and set number: one exercise per position.
  const byPosition = new Map<number, WorkoutExercise>();
  for (const set of sets) {
    const exercise = byPosition.get(set.position) ?? {
      exerciseId: set.exerciseId,
      label: set.exerciseLabel,
      tracking: set.tracking,
      sets: [],
    };
    exercise.sets.push(setValues(set));
    byPosition.set(set.position, exercise);
  }
  return {
    id: row.id,
    localDate: row.localDate,
    kind: row.kind,
    activity: row.activity,
    name: row.name,
    startedAt: row.startedAt.toISOString(),
    minutes: row.minutes,
    sessionRpe: row.sessionRpe,
    inputMethod: row.inputMethod,
    exercises: [...byPosition.values()],
    recordedAt: row.recordedAt.toISOString(),
  };
}

const liveWorkouts = (userId: string) =>
  and(eq(workouts.userId, userId), isNull(workouts.deletedAt));

/** Workouts matching `where`, newest first, each with its sets in session order. */
async function loadWorkouts(db: Reader, where: SQL | undefined): Promise<Workout[]> {
  const rows = await db
    .select()
    .from(workouts)
    .where(where)
    .orderBy(desc(workouts.localDate), desc(workouts.startedAt));
  if (rows.length === 0) return [];
  const sets = await db
    .select()
    .from(workoutSets)
    .where(
      inArray(
        workoutSets.workoutId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(workoutSets.workoutId), asc(workoutSets.position), asc(workoutSets.setNumber));
  const byWorkout = new Map<string, SetRow[]>();
  for (const set of sets) {
    const list = byWorkout.get(set.workoutId) ?? [];
    list.push(set);
    byWorkout.set(set.workoutId, list);
  }
  return rows.map((row) => toWorkout(row, byWorkout.get(row.id) ?? []));
}

type TrainingStore = Pick<
  Store,
  | 'listExerciseCatalog'
  | 'listCustomExercises'
  | 'getLoggableExercises'
  | 'upsertCustomExercise'
  | 'deleteCustomExercise'
  | 'listWorkouts'
  | 'listWorkoutIdsOfDay'
  | 'upsertWorkout'
  | 'deleteWorkout'
  | 'listExerciseSetRows'
>;

/** The exercise catalog, custom exercises and the workout log (spec 009), on Drizzle. */
export function createTrainingStore(db: Db): TrainingStore {
  return {
    async listExerciseCatalog() {
      const rows = await db
        .select()
        .from(exercises)
        .where(eq(exercises.origin, 'catalog'))
        .orderBy(desc(exercises.popularity), asc(exercises.key));
      // Any import touches `updated_at`, so the latest one and the count tell the cache it changed.
      const latest = rows.reduce((max, r) => Math.max(max, r.updatedAt.getTime()), 0);
      return { exercises: rows.map(toExercise), version: `${rows.length}-${latest}` };
    },

    async listCustomExercises(userId) {
      const rows = await db
        .select()
        .from(exercises)
        .where(and(eq(exercises.ownerId, userId), isNull(exercises.deletedAt)))
        .orderBy(desc(exercises.updatedAt));
      return rows.map(toExercise);
    },

    async getLoggableExercises(userId, ids) {
      if (ids.length === 0) return [];
      return db
        .select({
          id: exercises.id,
          nameEs: exercises.nameEs,
          nameEn: exercises.nameEn,
          tracking: exercises.tracking,
        })
        .from(exercises)
        .where(
          and(
            inArray(exercises.id, [...ids]),
            or(isNull(exercises.ownerId), eq(exercises.ownerId, userId)),
          ),
        );
    },

    async upsertCustomExercise(userId, id, request) {
      const [existing] = await db
        .select({ ownerId: exercises.ownerId })
        .from(exercises)
        .where(eq(exercises.id, id));
      if (existing && existing.ownerId !== userId) return 'id_taken';
      const exercise = customExercise(id, request);
      const update = {
        nameEs: exercise.nameEs,
        nameEn: exercise.nameEn,
        tracking: exercise.tracking,
        category: exercise.category,
        primaryMuscles: exercise.primaryMuscles,
        recordedAt: new Date(request.recordedAt),
        deletedAt: null,
      };
      // The later device time wins, also against a delete; another user's id is never touched.
      await db
        .insert(exercises)
        .values({ id, origin: 'user', ownerId: userId, ...update })
        .onConflictDoUpdate({
          target: exercises.id,
          set: { ...update, updatedAt: sql`now()` },
          setWhere: sql`${exercises.ownerId} = ${userId} and ${exercises.recordedAt} <= ${request.recordedAt}::timestamptz`,
        });
      const [row] = await db
        .select()
        .from(exercises)
        .where(and(eq(exercises.id, id), eq(exercises.ownerId, userId)));
      return row && row.deletedAt === null ? toExercise(row) : null;
    },

    async deleteCustomExercise(userId, id, recordedAt) {
      const at = new Date(recordedAt);
      // A tombstone: past sets keep pointing at it, and an older write cannot bring it back.
      await db
        .update(exercises)
        .set({ deletedAt: sql`now()`, recordedAt: at, updatedAt: sql`now()` })
        .where(
          and(eq(exercises.id, id), eq(exercises.ownerId, userId), lte(exercises.recordedAt, at)),
        );
    },

    async listWorkouts(userId, from, to) {
      return loadWorkouts(
        db,
        and(liveWorkouts(userId), gte(workouts.localDate, from), lte(workouts.localDate, to)),
      );
    },

    async listWorkoutIdsOfDay(userId, localDate) {
      const rows = await db
        .select({ id: workouts.id })
        .from(workouts)
        .where(and(liveWorkouts(userId), eq(workouts.localDate, localDate)));
      return rows.map((r) => r.id);
    },

    async upsertWorkout(userId, workout) {
      await db.transaction(async (tx) => {
        const update = {
          localDate: workout.localDate,
          kind: workout.kind,
          activity: workout.activity,
          name: workout.name,
          startedAt: new Date(workout.startedAt),
          minutes: workout.minutes,
          sessionRpe: workout.sessionRpe,
          inputMethod: workout.inputMethod,
          recordedAt: new Date(workout.recordedAt),
          deletedAt: null,
        };
        // AC23: the later device time wins, also against a delete; another user's id is never touched.
        const written = await tx
          .insert(workouts)
          .values({ id: workout.id, userId, ...update })
          .onConflictDoUpdate({
            target: workouts.id,
            set: { ...update, updatedAt: sql`now()` },
            setWhere: sql`${workouts.userId} = ${userId} and ${workouts.recordedAt} <= ${workout.recordedAt}::timestamptz`,
          })
          .returning({ id: workouts.id });
        if (written.length === 0) return;
        // A `PUT` replaces the whole workout: its sets are never merged (AC23).
        await tx.delete(workoutSets).where(eq(workoutSets.workoutId, workout.id));
        const sets = workout.exercises.flatMap((exercise, position) =>
          exercise.sets.map((set) => ({
            workoutId: workout.id,
            userId,
            exerciseId: exercise.exerciseId,
            exerciseLabel: exercise.label,
            tracking: exercise.tracking,
            position,
            setNumber: set.setNumber,
            reps: set.reps,
            weightKg: set.weightKg,
            durationS: set.durationS,
            distanceM: set.distanceM,
            restS: set.restS,
          })),
        );
        if (sets.length > 0) await tx.insert(workoutSets).values(sets);
      });
      const [saved] = await loadWorkouts(
        db,
        and(eq(workouts.id, workout.id), liveWorkouts(userId)),
      );
      return saved ?? null;
    },

    async deleteWorkout(userId, id, recordedAt) {
      const at = new Date(recordedAt);
      // The sets stay with the tombstone: they no longer count, since every read joins live workouts.
      await db
        .update(workouts)
        .set({ deletedAt: sql`now()`, recordedAt: at, updatedAt: sql`now()` })
        .where(and(eq(workouts.id, id), eq(workouts.userId, userId), lte(workouts.recordedAt, at)));
    },

    async listExerciseSetRows(userId, exerciseId) {
      const rows = await db
        .select({ set: workoutSets, workout: workouts })
        .from(workoutSets)
        .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
        .where(
          and(
            eq(workoutSets.userId, userId),
            isNull(workouts.deletedAt),
            exerciseId ? eq(workoutSets.exerciseId, exerciseId) : isNotNull(workoutSets.exerciseId),
          ),
        )
        .orderBy(asc(workouts.startedAt), asc(workoutSets.position), asc(workoutSets.setNumber));
      return rows.map(({ set, workout }): ExerciseSetRow => ({
        workoutId: workout.id,
        localDate: workout.localDate,
        startedAt: workout.startedAt.toISOString(),
        exerciseId: set.exerciseId!,
        tracking: set.tracking,
        set: setValues(set),
      }));
    },
  };
}

/** The training log and the user's own exercises for "Download my data" (AC25). */
export async function exportTrainingLog(db: Db, userId: string) {
  const [log, custom] = await Promise.all([
    loadWorkouts(db, liveWorkouts(userId)),
    db
      .select()
      .from(exercises)
      .where(eq(exercises.ownerId, userId))
      .orderBy(asc(exercises.createdAt)),
  ]);
  return {
    workouts: log.reverse(),
    customExercises: custom.map((row) => ({
      ...toExercise(row),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    })),
  };
}
