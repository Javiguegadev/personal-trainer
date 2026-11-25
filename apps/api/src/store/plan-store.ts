import type { PlanDelete, PlannedMealItem, PlannedWorkout } from '@pt/contracts';
import { and, asc, eq, gte, inArray, isNull, lte, ne, schema, sql, type Db } from '@pt/db';
import type { Ownership, Store } from '../deps';

const { plannedMealItems, plannedWorkouts, workouts } = schema;

type ItemRow = typeof plannedMealItems.$inferSelect;
type SessionRow = typeof plannedWorkouts.$inferSelect;
type Reader = Pick<Db, 'select'>;

function toPlannedItem(row: ItemRow): PlannedMealItem {
  return {
    id: row.id,
    localDate: row.localDate,
    mealType: row.mealType,
    foodId: row.foodId,
    servingId: row.servingId,
    servings: row.servings,
    servingLabel: row.servingLabel,
    grams: row.grams,
    unit: row.quantityUnit,
    label: row.label,
    nutrients: {
      kcal: row.kcal,
      proteinG: row.proteinG,
      carbsG: row.carbsG,
      fatG: row.fatG,
      fiberG: row.fiberG,
    },
    recordedAt: row.recordedAt.toISOString(),
  };
}

function toPlannedWorkout(row: SessionRow): PlannedWorkout {
  return {
    id: row.id,
    localDate: row.localDate,
    startMinute: row.startMinute,
    kind: row.kind,
    activity: row.activity,
    name: row.name,
    minutes: row.minutes,
    isMatch: row.isMatch,
    programSessionId: row.programSessionId,
    repeatWorkoutId: row.repeatWorkoutId,
    recordedAt: row.recordedAt.toISOString(),
  };
}

/** The live planned sessions of a range, by day and start time (untimed last). */
async function loadPlannedWorkouts(db: Reader, userId: string, from: string, to: string) {
  const rows = await db
    .select({ row: plannedWorkouts, repeatLive: workouts.id })
    .from(plannedWorkouts)
    .leftJoin(
      workouts,
      and(eq(workouts.id, plannedWorkouts.repeatWorkoutId), isNull(workouts.deletedAt)),
    )
    .where(
      and(
        eq(plannedWorkouts.userId, userId),
        isNull(plannedWorkouts.deletedAt),
        gte(plannedWorkouts.localDate, from),
        lte(plannedWorkouts.localDate, to),
      ),
    )
    .orderBy(
      asc(plannedWorkouts.localDate),
      asc(plannedWorkouts.startMinute),
      asc(plannedWorkouts.recordedAt),
    );
  // A deleted workout to repeat leaves a free gym session with its name (spec 013 Stale links).
  return rows.map(({ row, repeatLive }) => ({
    ...toPlannedWorkout(row),
    repeatWorkoutId: repeatLive ?? null,
  }));
}

/** The deletes of a bulk write grouped by device time: one statement per time (a copy uses one). */
function byRecordedAt(deletes: readonly PlanDelete[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const d of deletes) groups.set(d.recordedAt, [...(groups.get(d.recordedAt) ?? []), d.id]);
  return groups;
}

const ownership = (row: { userId: string } | undefined, userId: string): Ownership =>
  !row ? 'missing' : row.userId === userId ? 'own' : 'other';

type PlanStore = Pick<
  Store,
  | 'listPlan'
  | 'writePlannedMealItems'
  | 'writePlannedWorkouts'
  | 'plannedItemOwner'
  | 'plannedWorkoutOwner'
  | 'workoutOwner'
>;

/**
 * The weekly planner (spec 013), on Drizzle. Bulk writes run in one transaction with one statement per
 * kind of change; the later `recordedAt` of a row wins, also against a delete (a tombstone, AC23).
 */
export function createPlanStore(db: Db): PlanStore {
  return {
    async listPlan(userId, from, to) {
      const [items, sessions] = await Promise.all([
        db
          .select()
          .from(plannedMealItems)
          .where(
            and(
              eq(plannedMealItems.userId, userId),
              isNull(plannedMealItems.deletedAt),
              gte(plannedMealItems.localDate, from),
              lte(plannedMealItems.localDate, to),
            ),
          )
          .orderBy(asc(plannedMealItems.localDate), asc(plannedMealItems.recordedAt)),
        loadPlannedWorkouts(db, userId, from, to),
      ]);
      return { mealItems: items.map(toPlannedItem), workouts: sessions };
    },

    async writePlannedMealItems(userId, rows, deletes) {
      const ids = rows.map((r) => r.id);
      return db.transaction(async (tx) => {
        if (ids.length > 0) {
          const taken = await tx
            .select({ id: plannedMealItems.id })
            .from(plannedMealItems)
            .where(and(inArray(plannedMealItems.id, ids), ne(plannedMealItems.userId, userId)))
            .limit(1);
          if (taken.length > 0) return 'id_taken' as const;
        }
        for (const [recordedAt, group] of byRecordedAt(deletes)) {
          const at = new Date(recordedAt);
          await tx
            .update(plannedMealItems)
            .set({
              deletedAt: sql`coalesce(${plannedMealItems.deletedAt}, now())`,
              recordedAt: at,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                inArray(plannedMealItems.id, group),
                eq(plannedMealItems.userId, userId),
                lte(plannedMealItems.recordedAt, at),
              ),
            );
        }
        if (ids.length === 0) return [];
        await tx
          .insert(plannedMealItems)
          .values(
            rows.map((r) => ({
              id: r.id,
              userId,
              localDate: r.localDate,
              mealType: r.mealType,
              foodId: r.foodId,
              servingId: r.servingId,
              servings: r.servings,
              servingLabel: r.servingLabel,
              label: r.label,
              grams: r.grams,
              quantityUnit: r.unit,
              kcal: r.nutrients.kcal,
              proteinG: r.nutrients.proteinG,
              carbsG: r.nutrients.carbsG,
              fatG: r.nutrients.fatG,
              fiberG: r.nutrients.fiberG,
              recordedAt: new Date(r.recordedAt),
            })),
          )
          .onConflictDoUpdate({
            target: plannedMealItems.id,
            set: {
              localDate: sql`excluded.local_date`,
              mealType: sql`excluded.meal_type`,
              foodId: sql`excluded.food_id`,
              servingId: sql`excluded.serving_id`,
              servings: sql`excluded.servings`,
              servingLabel: sql`excluded.serving_label`,
              label: sql`excluded.label`,
              grams: sql`excluded.grams`,
              quantityUnit: sql`excluded.quantity_unit`,
              kcal: sql`excluded.kcal`,
              proteinG: sql`excluded.protein_g`,
              carbsG: sql`excluded.carbs_g`,
              fatG: sql`excluded.fat_g`,
              fiberG: sql`excluded.fiber_g`,
              recordedAt: sql`excluded.recorded_at`,
              deletedAt: null,
              updatedAt: sql`now()`,
            },
            // The later device time wins, also against a delete; another user's id is never touched.
            setWhere: sql`${plannedMealItems.userId} = ${userId} and ${plannedMealItems.recordedAt} <= excluded.recorded_at`,
          });
        const stored = await tx
          .select()
          .from(plannedMealItems)
          .where(
            and(
              inArray(plannedMealItems.id, ids),
              eq(plannedMealItems.userId, userId),
              isNull(plannedMealItems.deletedAt),
            ),
          );
        const byId = new Map(stored.map((row) => [row.id, toPlannedItem(row)]));
        return ids.flatMap((id) => byId.get(id) ?? []);
      });
    },

    async writePlannedWorkouts(userId, rows, deletes) {
      const ids = rows.map((r) => r.id);
      return db.transaction(async (tx) => {
        if (ids.length > 0) {
          const taken = await tx
            .select({ id: plannedWorkouts.id })
            .from(plannedWorkouts)
            .where(and(inArray(plannedWorkouts.id, ids), ne(plannedWorkouts.userId, userId)))
            .limit(1);
          if (taken.length > 0) return 'id_taken' as const;
        }
        for (const [recordedAt, group] of byRecordedAt(deletes)) {
          const at = new Date(recordedAt);
          await tx
            .update(plannedWorkouts)
            .set({
              deletedAt: sql`coalesce(${plannedWorkouts.deletedAt}, now())`,
              recordedAt: at,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                inArray(plannedWorkouts.id, group),
                eq(plannedWorkouts.userId, userId),
                lte(plannedWorkouts.recordedAt, at),
              ),
            );
        }
        if (ids.length === 0) return [];
        await tx
          .insert(plannedWorkouts)
          .values(
            rows.map((r) => ({
              id: r.id,
              userId,
              localDate: r.localDate,
              startMinute: r.startMinute,
              kind: r.kind,
              activity: r.activity,
              name: r.name,
              minutes: r.minutes,
              isMatch: r.isMatch,
              programSessionId: r.programSessionId,
              repeatWorkoutId: r.repeatWorkoutId,
              recordedAt: new Date(r.recordedAt),
            })),
          )
          .onConflictDoUpdate({
            target: plannedWorkouts.id,
            set: {
              localDate: sql`excluded.local_date`,
              startMinute: sql`excluded.start_minute`,
              kind: sql`excluded.kind`,
              activity: sql`excluded.activity`,
              name: sql`excluded.name`,
              minutes: sql`excluded.minutes`,
              isMatch: sql`excluded.is_match`,
              programSessionId: sql`excluded.program_session_id`,
              repeatWorkoutId: sql`excluded.repeat_workout_id`,
              recordedAt: sql`excluded.recorded_at`,
              deletedAt: null,
              updatedAt: sql`now()`,
            },
            setWhere: sql`${plannedWorkouts.userId} = ${userId} and ${plannedWorkouts.recordedAt} <= excluded.recorded_at`,
          });
        const stored = await tx
          .select()
          .from(plannedWorkouts)
          .where(
            and(
              inArray(plannedWorkouts.id, ids),
              eq(plannedWorkouts.userId, userId),
              isNull(plannedWorkouts.deletedAt),
            ),
          );
        const byId = new Map(stored.map((row) => [row.id, toPlannedWorkout(row)]));
        return ids.flatMap((id) => byId.get(id) ?? []);
      });
    },

    async plannedItemOwner(userId, id) {
      const [row] = await db
        .select({ userId: plannedMealItems.userId })
        .from(plannedMealItems)
        .where(eq(plannedMealItems.id, id));
      return ownership(row, userId);
    },

    async plannedWorkoutOwner(userId, id) {
      const [row] = await db
        .select({ userId: plannedWorkouts.userId })
        .from(plannedWorkouts)
        .where(eq(plannedWorkouts.id, id));
      return ownership(row, userId);
    },

    async workoutOwner(userId, id) {
      const [row] = await db
        .select({ userId: workouts.userId })
        .from(workouts)
        .where(eq(workouts.id, id));
      return ownership(row, userId);
    },
  };
}

/** The plan for "Descargar mis datos" (AC25): every planned row, deleted ones with their date. */
export async function exportPlan(db: Reader, userId: string) {
  const [items, sessions] = await Promise.all([
    db
      .select()
      .from(plannedMealItems)
      .where(eq(plannedMealItems.userId, userId))
      .orderBy(asc(plannedMealItems.localDate), asc(plannedMealItems.recordedAt)),
    db
      .select()
      .from(plannedWorkouts)
      .where(eq(plannedWorkouts.userId, userId))
      .orderBy(asc(plannedWorkouts.localDate), asc(plannedWorkouts.startMinute)),
  ]);
  const deletedAt = (row: { deletedAt: Date | null }) => row.deletedAt?.toISOString() ?? null;
  return {
    mealItems: items.map((row) => ({ ...toPlannedItem(row), deletedAt: deletedAt(row) })),
    workouts: sessions.map((row) => ({ ...toPlannedWorkout(row), deletedAt: deletedAt(row) })),
  };
}
