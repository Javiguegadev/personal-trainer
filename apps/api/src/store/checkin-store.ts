import type { DailyCheckin } from '@pt/contracts';
import { and, asc, eq, gte, isNull, lte, schema, sql, type Db } from '@pt/db';
import type { Store } from '../deps';

const { dailyCheckins } = schema;

type CheckinRow = typeof dailyCheckins.$inferSelect;
type Reader = Pick<Db, 'select'>;

const toCheckin = (row: CheckinRow): DailyCheckin => ({
  localDate: row.localDate,
  sleepMinutes: row.sleepMinutes,
  stress: row.stress,
  workShift: row.workShift,
  shiftStartMinute: row.shiftStartMinute,
  shiftEndMinute: row.shiftEndMinute,
  source: row.source,
  recordedAt: row.recordedAt.toISOString(),
});

async function liveCheckin(db: Reader, userId: string, localDate: string) {
  const [row] = await db
    .select()
    .from(dailyCheckins)
    .where(
      and(
        eq(dailyCheckins.userId, userId),
        eq(dailyCheckins.localDate, localDate),
        isNull(dailyCheckins.deletedAt),
      ),
    );
  return row ? toCheckin(row) : null;
}

/** The daily check-in (spec 011): one row per user and day, the later `recordedAt` wins (AC15). */
export function createCheckinStore(
  db: Db,
): Pick<Store, 'listCheckins' | 'upsertCheckin' | 'deleteCheckin'> {
  return {
    async listCheckins(userId, from, to) {
      const rows = await db
        .select()
        .from(dailyCheckins)
        .where(
          and(
            eq(dailyCheckins.userId, userId),
            gte(dailyCheckins.localDate, from),
            lte(dailyCheckins.localDate, to),
            isNull(dailyCheckins.deletedAt),
          ),
        )
        .orderBy(asc(dailyCheckins.localDate));
      return rows.map(toCheckin);
    },

    async upsertCheckin(userId, checkin) {
      const answers = {
        sleepMinutes: checkin.sleepMinutes,
        stress: checkin.stress,
        workShift: checkin.workShift,
        shiftStartMinute: checkin.shiftStartMinute,
        shiftEndMinute: checkin.shiftEndMinute,
        source: checkin.source,
        recordedAt: new Date(checkin.recordedAt),
        deletedAt: null,
      };
      // The later device time wins, also against a delete (a tombstone keeps its `recorded_at`).
      await db
        .insert(dailyCheckins)
        .values({ userId, localDate: checkin.localDate, ...answers })
        .onConflictDoUpdate({
          target: [dailyCheckins.userId, dailyCheckins.localDate],
          set: { ...answers, updatedAt: sql`now()` },
          setWhere: sql`${dailyCheckins.recordedAt} <= ${checkin.recordedAt}::timestamptz`,
        });
      return liveCheckin(db, userId, checkin.localDate);
    },

    async deleteCheckin(userId, localDate, recordedAt) {
      const at = new Date(recordedAt);
      // With no row yet, a tombstone: an older write arriving later must not create the check-in.
      await db
        .insert(dailyCheckins)
        .values({ userId, localDate, recordedAt: at, deletedAt: sql`now()` })
        .onConflictDoUpdate({
          target: [dailyCheckins.userId, dailyCheckins.localDate],
          // A newer delete of a tombstone moves its time forward, so a write between the two still loses.
          set: {
            deletedAt: sql`coalesce(${dailyCheckins.deletedAt}, now())`,
            recordedAt: at,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${dailyCheckins.recordedAt} <= ${recordedAt}::timestamptz`,
        });
      return liveCheckin(db, userId, localDate);
    },
  };
}

/** Every check-in of the user, deleted ones included with their date (AC16), oldest first. */
export async function exportCheckins(db: Reader, userId: string) {
  const rows = await db
    .select()
    .from(dailyCheckins)
    .where(eq(dailyCheckins.userId, userId))
    .orderBy(asc(dailyCheckins.localDate));
  return rows.map((row) => ({
    ...toCheckin(row),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }));
}
