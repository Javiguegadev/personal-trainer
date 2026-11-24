import type { PlannedActivity } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import {
  SHIFT_DEFAULT_HOURS,
  SLEEP_CHIPS,
  asksShift,
  checkCheckinWrite,
  checkinDue,
  checkinPrefill,
  checkinToRequest,
  latestPerDay,
  selectShift,
  setShiftHours,
  sleepChipOf,
  trainingPlannedOn,
  usualSleep,
  type CheckinPoint,
} from './checkin';

const TODAY = '2026-11-23'; // Monday

const point = (daysAgo: number, fields: Partial<CheckinPoint> = {}): CheckinPoint => ({
  localDate: addDays(TODAY, -daysAgo),
  sleepMinutes: null,
  stress: null,
  workShift: null,
  shiftStartMinute: null,
  shiftEndMinute: null,
  ...fields,
});

const gym: Pick<PlannedActivity, 'kind' | 'days'> = {
  kind: 'strength',
  days: [1, 3, 5].map((weekday) => ({ weekday, startMinute: 1110, isMatch: false })),
};
const football: Pick<PlannedActivity, 'kind' | 'days'> = {
  kind: 'sport',
  days: [
    { weekday: 2, startMinute: 1200, isMatch: false },
    { weekday: 6, startMinute: 660, isMatch: true },
  ],
};
const runningWithoutDays: Pick<PlannedActivity, 'kind' | 'days'> = { kind: 'cardio', days: [] };

describe('sleep chips (spec 011 Assumptions, AC6)', () => {
  it('stores the middle value of each of the five chips', () => {
    expect(SLEEP_CHIPS.map((c) => [c.key, c.minutes])).toEqual([
      ['under_5', 270],
      ['5_6', 330],
      ['6_7', 390],
      ['7_8', 450],
      ['over_8', 510],
    ]);
  });

  it('puts sleep exactly on a threshold in the higher chip', () => {
    expect(sleepChipOf(299)).toBe('under_5');
    expect(sleepChipOf(300)).toBe('5_6');
    expect(sleepChipOf(359)).toBe('5_6');
    expect(sleepChipOf(360)).toBe('6_7');
    expect(sleepChipOf(420)).toBe('7_8');
    expect(sleepChipOf(480)).toBe('over_8');
    expect(sleepChipOf(0)).toBe('under_5');
    expect(sleepChipOf(960)).toBe('over_8');
  });

  it('gives back the chip of its own stored value', () => {
    for (const chip of SLEEP_CHIPS) expect(sleepChipOf(chip.minutes)).toBe(chip.key);
  });
});

describe('usualSleep (spec 011 Assumptions)', () => {
  it('is null with fewer than 5 nights in the last 14 days', () => {
    const nights = [1, 2, 3, 4].map((d) => point(d, { sleepMinutes: 450 }));
    expect(usualSleep(nights, TODAY)).toBeNull();
  });

  it('is the median of the nights of the 14 days before today', () => {
    const nights = [330, 450, 390, 510, 450].map((sleepMinutes, i) =>
      point(i + 1, { sleepMinutes }),
    );
    expect(usualSleep(nights, TODAY)).toBe(450);
  });

  it('averages the two middle nights of an even count, rounded', () => {
    const nights = [330, 390, 450, 450, 510, 270].map((sleepMinutes, i) =>
      point(i + 1, { sleepMinutes }),
    );
    expect(usualSleep(nights, TODAY)).toBe(420);
  });

  it('ignores today, nights older than 14 days, deleted answers and stress-only check-ins', () => {
    const nights = [
      point(0, { sleepMinutes: 120 }),
      point(15, { sleepMinutes: 120 }),
      point(3, { stress: 'high' }),
      ...[1, 2, 4, 5, 14].map((d) => point(d, { sleepMinutes: 450 })),
    ];
    expect(usualSleep(nights, TODAY)).toBe(450);
    expect(usualSleep(nights.slice(0, 7), TODAY)).toBeNull();
  });

  it('does not depend on the order of the check-ins', () => {
    const nights = [510, 270, 450, 390, 330].map((sleepMinutes, i) =>
      point(i + 1, { sleepMinutes }),
    );
    expect(usualSleep([...nights].reverse(), TODAY)).toBe(usualSleep(nights, TODAY));
  });
});

describe('checkinPrefill (spec 011 AC2, AC3)', () => {
  const usualNights = [1, 2, 3, 4, 5].map((d) => point(d, { sleepMinutes: 440 }));

  it('prefills the chip of the usual sleep and "Normal" stress', () => {
    expect(checkinPrefill({ checkins: usualNights, today: TODAY, asksShift: false })).toEqual({
      sleepMinutes: 450,
      stress: 'normal',
      workShift: null,
      shiftStartMinute: null,
      shiftEndMinute: null,
    });
  });

  it("falls back to the latest check-in's chip, then to nothing", () => {
    const two = [point(3, { sleepMinutes: 300 }), point(2, { sleepMinutes: 380 }), point(1)];
    expect(checkinPrefill({ checkins: two, today: TODAY, asksShift: false }).sleepMinutes).toBe(
      390,
    );
    expect(
      checkinPrefill({ checkins: [], today: TODAY, asksShift: false }).sleepMinutes,
    ).toBeNull();
  });

  it("prefills yesterday's working shift with its hours", () => {
    const night = point(1, { workShift: 'night', shiftStartMinute: 1380, shiftEndMinute: 420 });
    expect(checkinPrefill({ checkins: [night], today: TODAY, asksShift: true })).toMatchObject({
      workShift: 'night',
      shiftStartMinute: 1380,
      shiftEndMinute: 420,
    });
  });

  it('prefills no shift after a day off, an older shift or for a fixed schedule', () => {
    const off = point(1, { workShift: 'off' });
    const older = point(2, { workShift: 'morning', shiftStartMinute: 360, shiftEndMinute: 840 });
    const shiftOf = (checkins: CheckinPoint[], ask: boolean) =>
      checkinPrefill({ checkins, today: TODAY, asksShift: ask }).workShift;
    expect(shiftOf([off], true)).toBeNull();
    expect(shiftOf([older], true)).toBeNull();
    expect(shiftOf([point(1, { ...older, localDate: addDays(TODAY, -1) })], false)).toBeNull();
  });

  it("returns today's own answers when today already has a check-in (editing)", () => {
    const own = point(0, { sleepMinutes: 270, stress: null });
    expect(
      checkinPrefill({ checkins: [...usualNights, own], today: TODAY, asksShift: false }),
    ).toEqual({
      sleepMinutes: 270,
      stress: null,
      workShift: null,
      shiftStartMinute: null,
      shiftEndMinute: null,
    });
  });
});

describe('shift hours (spec 011 AC3)', () => {
  it('has provisional default hours for each working shift', () => {
    expect(SHIFT_DEFAULT_HOURS).toEqual({
      morning: { startMinute: 360, endMinute: 840 },
      afternoon: { startMinute: 840, endMinute: 1320 },
      night: { startMinute: 1320, endMinute: 360 },
    });
  });

  it('selects a shift with the hours last chosen for that kind, or the defaults', () => {
    const empty = checkinPrefill({ checkins: [], today: TODAY, asksShift: true });
    expect(selectShift(empty, 'night', {})).toMatchObject({
      workShift: 'night',
      shiftStartMinute: 1320,
      shiftEndMinute: 360,
    });
    const preferred = { night: { startMinute: 1380, endMinute: 420 } };
    expect(selectShift(empty, 'night', preferred)).toMatchObject({
      shiftStartMinute: 1380,
      shiftEndMinute: 420,
    });
  });

  it('clears the hours for "Libre" and toggles a shift off when tapped again', () => {
    const night = selectShift(
      checkinPrefill({ checkins: [], today: TODAY, asksShift: true }),
      'night',
      {},
    );
    expect(selectShift(night, 'off', {})).toMatchObject({
      workShift: 'off',
      shiftStartMinute: null,
      shiftEndMinute: null,
    });
    expect(selectShift(night, 'night', {})).toMatchObject({
      workShift: null,
      shiftStartMinute: null,
      shiftEndMinute: null,
    });
  });

  it('changes the hours of a working shift, never to the same start and end', () => {
    const night = selectShift(
      checkinPrefill({ checkins: [], today: TODAY, asksShift: true }),
      'night',
      {},
    );
    expect(setShiftHours(night, { startMinute: 1380, endMinute: 420 })).toMatchObject({
      shiftStartMinute: 1380,
      shiftEndMinute: 420,
    });
    expect(setShiftHours(night, { startMinute: 600, endMinute: 600 })).toBe(night);
  });
});

describe('checkinToRequest', () => {
  it('adds the device time and the local date to the answers', () => {
    const answers = checkinPrefill({ checkins: [], today: TODAY, asksShift: false });
    expect(
      checkinToRequest(answers, { recordedAt: '2026-11-23T07:00:00.000Z', today: TODAY }),
    ).toEqual({ ...answers, recordedAt: '2026-11-23T07:00:00.000Z', today: TODAY });
  });
});

describe('checkinDue (spec 011 AC1)', () => {
  const base = {
    today: TODAY,
    activities: [gym, football],
    workPattern: 'fixed' as const,
    hasCheckin: false,
    skippedOn: null,
  };

  it('is due on a day with training planned', () => {
    expect(checkinDue(base)).toBe(true); // Monday: gym
    expect(checkinDue({ ...base, today: '2026-11-24' })).toBe(true); // Tuesday: football
  });

  it('is not due on a rest day with a fixed schedule', () => {
    expect(checkinDue({ ...base, today: '2026-11-27' })).toBe(true); // Friday: gym
    expect(checkinDue({ ...base, today: '2026-11-26' })).toBe(false); // Thursday: nothing
    expect(checkinDue({ ...base, activities: [runningWithoutDays] })).toBe(false);
  });

  it('is due every day for shift and irregular workers', () => {
    const thursday = { ...base, today: '2026-11-26', activities: [] };
    expect(checkinDue({ ...thursday, workPattern: 'shifts' })).toBe(true);
    expect(checkinDue({ ...thursday, workPattern: 'irregular' })).toBe(true);
    expect(checkinDue({ ...thursday, workPattern: 'none' })).toBe(false);
    expect(checkinDue({ ...thursday, workPattern: null })).toBe(false);
  });

  it('is due every day for a gym activity without days (routineDueOn)', () => {
    const gymWithoutDays = { kind: 'strength' as const, days: [] };
    expect(checkinDue({ ...base, today: '2026-11-26', activities: [gymWithoutDays] })).toBe(true);
  });

  it('is not due once today has a check-in or "Hoy no" was tapped today', () => {
    expect(checkinDue({ ...base, hasCheckin: true })).toBe(false);
    expect(checkinDue({ ...base, skippedOn: TODAY })).toBe(false);
    expect(checkinDue({ ...base, skippedOn: addDays(TODAY, -1) })).toBe(true);
  });
});

describe('trainingPlannedOn and asksShift', () => {
  it('finds training on a weekday from the routine rule or an activity day', () => {
    expect(trainingPlannedOn([gym, football], 1)).toBe(true);
    expect(trainingPlannedOn([gym, football], 6)).toBe(true);
    expect(trainingPlannedOn([gym, football], 7)).toBe(false);
  });

  it('asks the shift only for shift and irregular workers', () => {
    expect(
      ['fixed', 'shifts', 'irregular', 'none', null].map((p) => asksShift(p as never)),
    ).toEqual([false, true, true, false, false]);
  });
});

describe('checkCheckinWrite (spec 011 AC15)', () => {
  const now = new Date('2026-11-23T10:00:00Z');
  const write = { localDate: TODAY, today: TODAY, recordedAt: '2026-11-23T09:00:00.000Z' };

  it('accepts today and up to a year back', () => {
    expect(checkCheckinWrite(write, now)).toBeNull();
    expect(checkCheckinWrite({ ...write, localDate: addDays(TODAY, -366) }, now)).toBeNull();
  });

  it('rejects a day in the future or more than a year back', () => {
    expect(checkCheckinWrite({ ...write, localDate: addDays(TODAY, 1) }, now)).toEqual({
      localDate: 'in_future',
    });
    expect(checkCheckinWrite({ ...write, localDate: addDays(TODAY, -367) }, now)).toEqual({
      localDate: 'too_old',
    });
  });

  it('rejects a device clock more than a day ahead, and an implausible local date', () => {
    expect(checkCheckinWrite({ ...write, recordedAt: '2026-11-24T10:00:01.000Z' }, now)).toEqual({
      recordedAt: 'in_future',
    });
    expect(checkCheckinWrite({ ...write, recordedAt: '2026-11-24T10:00:00.000Z' }, now)).toBeNull();
    expect(
      checkCheckinWrite({ ...write, today: '2026-11-26', localDate: '2026-11-26' }, now),
    ).toEqual({ today: 'implausible' });
  });
});

describe('latestPerDay (spec 011 AC15)', () => {
  it('keeps one check-in per day, the later recordedAt winning in any order', () => {
    const a = { ...point(1, { sleepMinutes: 330 }), recordedAt: '2026-11-22T07:00:00Z' };
    const b = { ...point(1, { sleepMinutes: 450 }), recordedAt: '2026-11-22T08:00:00Z' };
    const c = point(2, { sleepMinutes: 390 });
    expect(latestPerDay([a, b, c])).toEqual([b, c]);
    expect(latestPerDay([b, a, c])).toEqual([b, c]);
  });

  it('keeps the later row of a day without recordedAt', () => {
    const a = point(1, { sleepMinutes: 330 });
    const b = point(1, { sleepMinutes: 450 });
    expect(latestPerDay([a, b])).toEqual([b]);
  });

  it('makes the usual sleep count each night once', () => {
    const nights = [1, 2, 3, 4].map((d) => point(d, { sleepMinutes: 450 }));
    const duplicate = { ...point(4, { sleepMinutes: 450 }), recordedAt: '2026-11-19T09:00:00Z' };
    expect(usualSleep([...nights, duplicate], TODAY)).toBeNull();
  });
});
