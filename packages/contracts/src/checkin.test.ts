import { describe, expect, it } from 'vitest';
import {
  CHECKIN_LIMITS,
  CheckinDeleteQuerySchema,
  CheckinUpsertRequestSchema,
  DailyCheckinSchema,
  ReadinessSchema,
  isWorkingShift,
  type CheckinUpsertRequest,
} from './checkin';

const request: CheckinUpsertRequest = {
  sleepMinutes: 390,
  stress: 'normal',
  workShift: null,
  shiftStartMinute: null,
  shiftEndMinute: null,
  recordedAt: '2026-11-23T07:30:00.000+01:00',
  today: '2026-11-23',
};

const issues = (input: unknown) =>
  CheckinUpsertRequestSchema.safeParse(input).error?.issues.map((i) => i.message) ?? [];

describe('CheckinUpsertRequestSchema (spec 011)', () => {
  it('accepts sleep, stress and no shift', () => {
    expect(CheckinUpsertRequestSchema.parse(request)).toEqual(request);
  });

  it('accepts a check-in with every answer empty (AC2)', () => {
    const empty = { ...request, sleepMinutes: null, stress: null };
    expect(CheckinUpsertRequestSchema.safeParse(empty).success).toBe(true);
  });

  it('keeps sleep within 0–960 whole minutes', () => {
    for (const sleepMinutes of [0, 270, CHECKIN_LIMITS.sleepMinutesMax]) {
      expect(CheckinUpsertRequestSchema.safeParse({ ...request, sleepMinutes }).success).toBe(true);
    }
    for (const sleepMinutes of [-1, 961, 390.5]) {
      expect(CheckinUpsertRequestSchema.safeParse({ ...request, sleepMinutes }).success).toBe(
        false,
      );
    }
  });

  it('requires the hours of a working shift (AC3)', () => {
    expect(issues({ ...request, workShift: 'night' })).toEqual(['shift_hours_required']);
    expect(issues({ ...request, workShift: 'night', shiftStartMinute: 1320 })).toEqual([
      'shift_hours_required',
    ]);
    const night = { ...request, workShift: 'night', shiftStartMinute: 1320, shiftEndMinute: 360 };
    expect(CheckinUpsertRequestSchema.safeParse(night).success).toBe(true);
  });

  it('rejects a working shift that starts and ends at the same minute', () => {
    const shift = { ...request, workShift: 'morning', shiftStartMinute: 360, shiftEndMinute: 360 };
    expect(issues(shift)).toEqual(['shift_hours_equal']);
  });

  it('forbids hours on a day off or without a shift', () => {
    const hours = { shiftStartMinute: 360, shiftEndMinute: 840 };
    expect(issues({ ...request, workShift: 'off', ...hours })).toEqual(['shift_hours_forbidden']);
    expect(issues({ ...request, workShift: null, ...hours })).toEqual(['shift_hours_forbidden']);
    expect(CheckinUpsertRequestSchema.safeParse({ ...request, workShift: 'off' }).success).toBe(
      true,
    );
  });

  it('keeps the shift hours within the day', () => {
    const shift = {
      ...request,
      workShift: 'afternoon',
      shiftStartMinute: 840,
      shiftEndMinute: 1440,
    };
    expect(CheckinUpsertRequestSchema.safeParse(shift).success).toBe(false);
  });

  it('needs the device time and the local date', () => {
    for (const key of ['recordedAt', 'today'] as const) {
      const missing: Partial<CheckinUpsertRequest> = { ...request };
      delete missing[key];
      expect(CheckinUpsertRequestSchema.safeParse(missing).success).toBe(false);
    }
  });
});

describe('DailyCheckinSchema', () => {
  it('applies the same shift rule to a stored check-in', () => {
    const stored = {
      localDate: '2026-11-23',
      sleepMinutes: null,
      stress: null,
      workShift: 'morning',
      shiftStartMinute: null,
      shiftEndMinute: null,
      source: 'manual',
      recordedAt: request.recordedAt,
    };
    expect(DailyCheckinSchema.safeParse(stored).success).toBe(false);
    expect(
      DailyCheckinSchema.safeParse({ ...stored, shiftStartMinute: 360, shiftEndMinute: 840 })
        .success,
    ).toBe(true);
  });
});

describe('CheckinDeleteQuerySchema', () => {
  it('needs the device time and the local date', () => {
    expect(CheckinDeleteQuerySchema.safeParse({ recordedAt: request.recordedAt }).success).toBe(
      false,
    );
    expect(
      CheckinDeleteQuerySchema.safeParse({ recordedAt: request.recordedAt, today: '2026-11-23' })
        .success,
    ).toBe(true);
  });
});

describe('isWorkingShift', () => {
  it('is true for morning, afternoon and night only', () => {
    expect(
      ['morning', 'afternoon', 'night', 'off', null].map((s) => isWorkingShift(s as never)),
    ).toEqual([true, true, true, false, false]);
  });
});

describe('ReadinessSchema', () => {
  it('has a level and the reasons that fired', () => {
    const readiness = { level: 'low', reasons: ['short_sleep', 'high_stress'] };
    expect(ReadinessSchema.parse(readiness)).toEqual(readiness);
    expect(ReadinessSchema.safeParse({ level: 'great', reasons: [] }).success).toBe(false);
  });
});
