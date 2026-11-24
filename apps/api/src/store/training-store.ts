import type { Exercise, Program, ProgramExercise, Workout, WorkoutExercise } from '@pt/contracts';
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
  ne,
  notInArray,
  or,
  schema,
  sql,
  type Db,
  type SQL,
} from '@pt/db';
import type { Store } from '../deps';

const { exercises, programExercises, programSessions, workoutPrograms, workouts, workoutSets } =
  schema;

type ExerciseRow = typeof exercises.$inferSelect;
type WorkoutRow = typeof workouts.$inferSelect;
type SetRow = typeof workoutSets.$inferSelect;
type ProgramExerciseRow = typeof programExercises.$inferSelect;
type Reader = Pick<Db, 'select'>;

type StoredProgram = Program & { deletedAt: string | null };

const toProgramExercise = (row: ProgramExerciseRow): ProgramExercise => ({
  exerciseId: row.exerciseId,
  label: row.exerciseLabel,
  tracking: row.tracking,
  sets: row.sets,
  repsMin: row.repsMin,
  repsMax: row.repsMax,
  durationS: row.durationS,
  restS: row.restS,
});

/** Routines matching `where`, oldest first, with their sessions and exercises in order. */
async function loadPrograms(db: Reader, where: SQL | undefined): Promise<StoredProgram[]> {
  const rows = await db
    .select()
    .from(workoutPrograms)
    .where(where)
    .orderBy(asc(workoutPrograms.createdAt));
  if (rows.length === 0) return [];
  const sessions = await db
    .select()
    .from(programSessions)
    .where(
      inArray(
        programSessions.programId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(programSessions.position));
  const exerciseRows =
    sessions.length === 0
      ? []
      : await db
          .select()
          .from(programExercises)
          .where(
            inArray(
              programExercises.sessionId,
              sessions.map((s) => s.id),
            ),
          )
          .orderBy(asc(programExercises.position));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    origin: row.origin,
    templateKey: row.templateKey,
    sessions: sessions
      .filter((s) => s.programId === row.id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        exercises: exerciseRows.filter((e) => e.sessionId === s.id).map(toProgramExercise),
      })),
    recordedAt: row.recordedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }));
}

const withoutTombstone = ({ deletedAt: _, ...program }: StoredProgram): Program => program;

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
    programSessionId: row.programSessionId,
    // Stored with the planner's migration (spec 013, db step).
    plannedWorkoutId: null,
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
  | 'getProgram'
  | 'upsertProgram'
  | 'deleteProgram'
  | 'programSessionOwner'
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
          programSessionId: workout.programSessionId,
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

    async getProgram(userId) {
      const [program] = await loadPrograms(
        db,
        and(eq(workoutPrograms.userId, userId), isNull(workoutPrograms.deletedAt)),
      );
      return program ? withoutTombstone(program) : null;
    },

    async upsertProgram(userId, program) {
      const recordedAt = new Date(program.recordedAt);
      const sessionIds = program.sessions.map((s) => s.id);
      const conflict = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ userId: workoutPrograms.userId, recordedAt: workoutPrograms.recordedAt })
          .from(workoutPrograms)
          .where(eq(workoutPrograms.id, program.id))
          .for('update');
        if (existing && existing.userId !== userId) return 'id_taken' as const;
        // AC22: a later write or delete already won; the caller reads what is stored.
        if (existing && existing.recordedAt > recordedAt) return null;
        const [takenSession] = await tx
          .select({ id: programSessions.id })
          .from(programSessions)
          .where(
            and(inArray(programSessions.id, sessionIds), ne(programSessions.programId, program.id)),
          )
          .limit(1);
        if (takenSession) return 'id_taken' as const;
        const [other] = await tx
          .select({ id: workoutPrograms.id })
          .from(workoutPrograms)
          .where(
            and(
              eq(workoutPrograms.userId, userId),
              isNull(workoutPrograms.deletedAt),
              ne(workoutPrograms.id, program.id),
            ),
          )
          .limit(1);
        if (other) return 'program_exists' as const;

        const update = {
          name: program.name,
          origin: program.origin,
          templateKey: program.templateKey,
          recordedAt,
          deletedAt: null,
        };
        await tx
          .insert(workoutPrograms)
          .values({ id: program.id, userId, ...update })
          .onConflictDoUpdate({
            target: workoutPrograms.id,
            set: { ...update, updatedAt: sql`now()` },
          });
        // A session left out is deleted: its workouts keep their sets and lose the link (AC22).
        await tx
          .delete(programSessions)
          .where(
            and(
              eq(programSessions.programId, program.id),
              notInArray(programSessions.id, sessionIds),
            ),
          );
        for (const [position, session] of program.sessions.entries()) {
          await tx
            .insert(programSessions)
            .values({ id: session.id, programId: program.id, userId, position, name: session.name })
            .onConflictDoUpdate({
              target: programSessions.id,
              set: { position, name: session.name },
            });
        }
        await tx.delete(programExercises).where(inArray(programExercises.sessionId, sessionIds));
        const rows = program.sessions.flatMap((session) =>
          session.exercises.map((exercise, position) => ({
            sessionId: session.id,
            userId,
            position,
            exerciseId: exercise.exerciseId,
            exerciseLabel: exercise.label,
            tracking: exercise.tracking,
            sets: exercise.sets,
            repsMin: exercise.repsMin,
            repsMax: exercise.repsMax,
            durationS: exercise.durationS,
            restS: exercise.restS,
          })),
        );
        if (rows.length > 0) await tx.insert(programExercises).values(rows);
        return null;
      });
      if (conflict) return conflict;
      const [saved] = await loadPrograms(
        db,
        and(
          eq(workoutPrograms.id, program.id),
          eq(workoutPrograms.userId, userId),
          isNull(workoutPrograms.deletedAt),
        ),
      );
      return saved ? withoutTombstone(saved) : null;
    },

    async deleteProgram(userId, id, recordedAt) {
      const at = new Date(recordedAt);
      // A tombstone: workouts keep pointing at its sessions, and an older write cannot bring it back.
      await db
        .update(workoutPrograms)
        .set({ deletedAt: sql`now()`, recordedAt: at, updatedAt: sql`now()` })
        .where(
          and(
            eq(workoutPrograms.id, id),
            eq(workoutPrograms.userId, userId),
            isNull(workoutPrograms.deletedAt),
            lte(workoutPrograms.recordedAt, at),
          ),
        );
    },

    async programSessionOwner(userId, sessionId) {
      const [row] = await db
        .select({ userId: programSessions.userId })
        .from(programSessions)
        .where(eq(programSessions.id, sessionId));
      if (!row) return 'missing';
      return row.userId === userId ? 'own' : 'other';
    },
  };
}

/**
 * The training log, the user's own exercises (spec 009 AC25) and their routines, deleted ones
 * included (spec 010 AC24), for "Download my data".
 */
export async function exportTrainingLog(db: Db, userId: string) {
  const [log, custom, programs] = await Promise.all([
    loadWorkouts(db, liveWorkouts(userId)),
    db
      .select()
      .from(exercises)
      .where(eq(exercises.ownerId, userId))
      .orderBy(asc(exercises.createdAt)),
    loadPrograms(db, eq(workoutPrograms.userId, userId)),
  ]);
  return {
    workouts: log.reverse(),
    programs,
    customExercises: custom.map((row) => ({
      ...toExercise(row),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    })),
  };
}
