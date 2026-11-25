import type { ReviewReason, WeeklyReview } from '@pt/contracts';
import { and, asc, desc, eq, gte, isNull, lte, schema, type Db } from '@pt/db';
import type { CalibrationWrite, Store } from '../deps';

const {
  bodyMeasurements,
  dailyCheckins,
  mealItems,
  nutritionTargets,
  profiles,
  weeklyReviews,
  workouts,
} = schema;

type ReviewRow = typeof weeklyReviews.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const toReview = (row: ReviewRow): WeeklyReview => ({
  weekStart: row.weekStart,
  status: row.status,
  summary: row.inputs,
  proposal:
    row.kcalDelta === null || row.fromKcal === null || row.toKcal === null
      ? null
      : { kcalDelta: row.kcalDelta, fromKcal: row.fromKcal, toKcal: row.toKcal },
  reasons: row.reasons as ReviewReason[],
  rulesVersion: row.rulesVersion,
  createdAt: row.createdAt.toISOString(),
  decidedAt: row.decidedAt?.toISOString() ?? null,
});

/** The calibration, the goal and flags evaluated with it, and the targets (closed and inserted). */
async function writeCalibration(tx: Tx, userId: string, write: CalibrationWrite, at: Date) {
  await tx
    .update(profiles)
    .set({
      energyCalibrationKcal: write.calibrationKcal,
      energyCalibratedAt: at,
      goal: write.evaluation.goal,
      safetyFlags: write.evaluation.safetyFlags,
      updatedAt: at,
    })
    .where(eq(profiles.id, userId));
  await tx
    .update(nutritionTargets)
    .set({ validTo: at })
    .where(and(eq(nutritionTargets.userId, userId), isNull(nutritionTargets.validTo)));
  if (write.evaluation.targets) {
    await tx
      .insert(nutritionTargets)
      .values({ userId, ...write.evaluation.targets, validFrom: at });
  }
}

/** The weekly reviews, oldest first, for "Descargar mis datos" (AC16). */
export async function exportWeeklyReviews(db: Db, userId: string): Promise<WeeklyReview[]> {
  const rows = await db
    .select()
    .from(weeklyReviews)
    .where(eq(weeklyReviews.userId, userId))
    .orderBy(asc(weeklyReviews.weekStart));
  return rows.map(toReview);
}

/** The weekly review, the streak's logged days and the calibration (spec 014). */
export function createReviewStore(
  db: Db,
): Pick<
  Store,
  | 'listTargetsHistory'
  | 'listLoggedDays'
  | 'getCalibrationChange'
  | 'listWeeklyReviews'
  | 'insertWeeklyReview'
  | 'decideWeeklyReview'
  | 'setCalibration'
  | 'deleteAllCheckins'
> {
  return {
    async listTargetsHistory(userId) {
      const rows = await db
        .select({ kcal: nutritionTargets.kcal, validFrom: nutritionTargets.validFrom })
        .from(nutritionTargets)
        .where(eq(nutritionTargets.userId, userId))
        .orderBy(asc(nutritionTargets.validFrom));
      return rows.map((r) => ({ kcal: r.kcal, validFrom: r.validFrom.toISOString() }));
    },

    async listLoggedDays(userId, from, to) {
      const [meals, sessions, weights] = await Promise.all([
        db
          .selectDistinct({ day: mealItems.localDate })
          .from(mealItems)
          .where(
            and(
              eq(mealItems.userId, userId),
              gte(mealItems.localDate, from),
              lte(mealItems.localDate, to),
              isNull(mealItems.deletedAt),
            ),
          ),
        db
          .selectDistinct({ day: workouts.localDate })
          .from(workouts)
          .where(
            and(
              eq(workouts.userId, userId),
              gte(workouts.localDate, from),
              lte(workouts.localDate, to),
              isNull(workouts.deletedAt),
            ),
          ),
        db
          .selectDistinct({ day: bodyMeasurements.localDate })
          .from(bodyMeasurements)
          .where(
            and(
              eq(bodyMeasurements.userId, userId),
              gte(bodyMeasurements.localDate, from),
              lte(bodyMeasurements.localDate, to),
            ),
          ),
      ]);
      return [...new Set([...meals, ...sessions, ...weights].map((r) => r.day))].sort();
    },

    async getCalibrationChange(userId) {
      const [row] = await db
        .select({ at: profiles.energyCalibratedAt })
        .from(profiles)
        .where(eq(profiles.id, userId));
      return row?.at ?? null;
    },

    async listWeeklyReviews(userId, limit) {
      const rows = await db
        .select()
        .from(weeklyReviews)
        .where(eq(weeklyReviews.userId, userId))
        .orderBy(desc(weeklyReviews.weekStart))
        .limit(limit);
      return rows.map(toReview);
    },

    async insertWeeklyReview(userId, draft, at) {
      await db
        .insert(weeklyReviews)
        .values({
          userId,
          weekStart: draft.weekStart,
          status: draft.status,
          kcalDelta: draft.proposal?.kcalDelta ?? null,
          fromKcal: draft.proposal?.fromKcal ?? null,
          toKcal: draft.proposal?.toKcal ?? null,
          reasons: draft.reasons,
          inputs: draft.summary,
          rulesVersion: draft.rulesVersion,
          createdAt: at,
        })
        // Two first reads at once: the first one stored wins, the second reads it back.
        .onConflictDoNothing({ target: [weeklyReviews.userId, weeklyReviews.weekStart] });
      const [row] = await db
        .select()
        .from(weeklyReviews)
        .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.weekStart, draft.weekStart)));
      return toReview(row!);
    },

    async decideWeeklyReview(userId, weekStart, decision, at, calibration) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(weeklyReviews)
          .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.weekStart, weekStart)))
          .for('update');
        if (!row) return 'not_found';
        if (row.status !== 'proposed') return 'decided';
        const [latest] = await tx
          .select({ weekStart: weeklyReviews.weekStart })
          .from(weeklyReviews)
          .where(eq(weeklyReviews.userId, userId))
          .orderBy(desc(weeklyReviews.weekStart))
          .limit(1);
        if (latest?.weekStart !== weekStart) return 'stale';
        await tx
          .update(weeklyReviews)
          .set({ status: decision, decidedAt: at })
          .where(eq(weeklyReviews.id, row.id));
        if (calibration) await writeCalibration(tx, userId, calibration, at);
        return 'ok';
      });
    },

    async setCalibration(userId, write, at) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.id, userId))
          .for('update');
        if (!row) return false;
        await writeCalibration(tx, userId, write, at);
        return true;
      });
    },

    async deleteAllCheckins(userId, at) {
      await db
        .update(dailyCheckins)
        .set({ deletedAt: at, recordedAt: at })
        .where(and(eq(dailyCheckins.userId, userId), isNull(dailyCheckins.deletedAt)));
    },
  };
}
