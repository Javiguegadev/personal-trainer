import { z } from 'zod';
import { IsoDateSchema, MinuteOfDaySchema } from './profile';

/** Limits of the daily check-in (spec 011). */
export const CHECKIN_LIMITS = {
  /** Sleep of one night, in minutes (0 to 16 h). */
  sleepMinutesMax: 960,
  /** Longest range one `GET /me/checkins` can ask for, in days. */
  listDaysMax: 92,
  /** How far back the API accepts a check-in, in days (AC15). */
  historyDays: 366,
  /** Days before today the app lets the user add, change or delete a check-in (AC5). */
  editDaysBack: 27,
} as const;

const datetime = z.iso.datetime({ offset: true });

export const StressLevelSchema = z.enum(['low', 'normal', 'high']);
export type StressLevel = z.infer<typeof StressLevelSchema>;

/** Today's shift of a shift or irregular worker (AC3). `off` is a day off: it has no hours. */
export const WorkShiftSchema = z.enum(['morning', 'afternoon', 'night', 'off']);
export type WorkShift = z.infer<typeof WorkShiftSchema>;

/** Where a check-in came from. Only `manual` in spec 011; `health_import` is reserved (ADR 007). */
export const CheckinSourceSchema = z.enum(['manual', 'health_import']);
export type CheckinSource = z.infer<typeof CheckinSourceSchema>;

export const SleepMinutesSchema = z.number().int().min(0).max(CHECKIN_LIMITS.sleepMinutesMax);

/** What the user answers. Every field may stay empty (AC2). */
const checkinAnswers = {
  sleepMinutes: SleepMinutesSchema.nullable(),
  stress: StressLevelSchema.nullable(),
  workShift: WorkShiftSchema.nullable(),
  /** The shift hours; an end before the start ends the next day. Set only for a working shift. */
  shiftStartMinute: MinuteOfDaySchema.nullable(),
  shiftEndMinute: MinuteOfDaySchema.nullable(),
};

type ShiftFields = {
  workShift: WorkShift | null;
  shiftStartMinute: number | null;
  shiftEndMinute: number | null;
};

/** A working shift has both hours, different from each other; `off` or no shift has none. */
export function isWorkingShift(shift: WorkShift | null): shift is Exclude<WorkShift, 'off'> {
  return shift !== null && shift !== 'off';
}

function checkShiftHours(value: ShiftFields, ctx: z.RefinementCtx) {
  const { workShift, shiftStartMinute: start, shiftEndMinute: end } = value;
  if (isWorkingShift(workShift)) {
    if (start === null || end === null) {
      ctx.addIssue({ code: 'custom', path: ['shiftStartMinute'], message: 'shift_hours_required' });
    } else if (start === end) {
      ctx.addIssue({ code: 'custom', path: ['shiftEndMinute'], message: 'shift_hours_equal' });
    }
  } else if (start !== null || end !== null) {
    ctx.addIssue({ code: 'custom', path: ['shiftStartMinute'], message: 'shift_hours_forbidden' });
  }
}

const dailyCheckin = z.object({
  /** The user's day (YYYY-MM-DD), with the day start of spec 010 AC6. */
  localDate: IsoDateSchema,
  ...checkinAnswers,
  source: CheckinSourceSchema,
  /** Device time of the write. The later one wins, also against a delete (AC15). */
  recordedAt: datetime,
});

/** One check-in per user and local day (spec 011). */
export const DailyCheckinSchema = dailyCheckin.superRefine(checkShiftHours);
export type DailyCheckin = z.infer<typeof DailyCheckinSchema>;

/** A check-in in "Descargar mis datos" (AC16): deleted ones are included with their date. */
export const ExportedCheckinSchema = dailyCheckin
  .extend({ deletedAt: datetime.nullable() })
  .superRefine(checkShiftHours);

/** `PUT /me/checkins/:localDate`. */
export const CheckinUpsertRequestSchema = z
  .object({
    ...checkinAnswers,
    recordedAt: datetime,
    /** The user's local date. The API accepts it only within ±1 day of server UTC. */
    today: IsoDateSchema,
  })
  .superRefine(checkShiftHours);
export type CheckinUpsertRequest = z.infer<typeof CheckinUpsertRequestSchema>;

export const CheckinDateParamSchema = z.object({ localDate: IsoDateSchema });

/** Query of `DELETE /me/checkins/:localDate`. */
export const CheckinDeleteQuerySchema = z.object({ recordedAt: datetime, today: IsoDateSchema });
export type CheckinDeleteQuery = z.infer<typeof CheckinDeleteQuerySchema>;

export const CheckinListQuerySchema = z.object({ from: IsoDateSchema, to: IsoDateSchema });
export type CheckinListQuery = z.infer<typeof CheckinListQuerySchema>;

export const CheckinListResponseSchema = z.object({
  /** Oldest first. Deleted check-ins are not listed. */
  checkins: z.array(DailyCheckinSchema),
});
export type CheckinListResponse = z.infer<typeof CheckinListResponseSchema>;

export const CheckinSaveResponseSchema = z.object({
  /** The check-in stored after the write (the newer one if another write won); null when deleted. */
  checkin: DailyCheckinSchema.nullable(),
});
export type CheckinSaveResponse = z.infer<typeof CheckinSaveResponseSchema>;

// ── Readiness (computed on the device by `dayReadiness` in @pt/core, never by the API) ─────────────

/** `unknown` changes nothing; `reduced` and `low` only ever remove volume (AC6, AC7). */
export const ReadinessLevelSchema = z.enum(['unknown', 'normal', 'reduced', 'low']);
export type ReadinessLevel = z.infer<typeof ReadinessLevelSchema>;

export const ReadinessReasonSchema = z.enum([
  'very_short_sleep',
  'short_sleep',
  'below_usual_sleep',
  'high_stress',
]);
export type ReadinessReason = z.infer<typeof ReadinessReasonSchema>;

export const ReadinessSchema = z.object({
  level: ReadinessLevelSchema,
  /** The rules that fired, in the order of `ReadinessReasonSchema`. */
  reasons: z.array(ReadinessReasonSchema),
});
export type Readiness = z.infer<typeof ReadinessSchema>;
