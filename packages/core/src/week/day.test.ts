import type { PlannedActivity, WorkShift } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { localToday } from '../dates';
import { dayNotices, dayWorkBlock, type ShiftCheckin } from './day';
import { applyDaysToActivity } from './typical';
import { weekRows } from './view';

const TODAY = '2026-11-23'; // Monday
const YESTERDAY = '2026-11-22';

const shift = (
  localDate: string,
  workShift: WorkShift | null,
  start: number | null = null,
  end: number | null = null,
): ShiftCheckin => ({ localDate, workShift, shiftStartMinute: start, shiftEndMinute: end });

const gym: PlannedActivity = applyDaysToActivity(
  {
    kind: 'strength',
    label: null,
    sessionsPerWeek: 2,
    minutesPerSession: 60,
    intensity: 'moderate',
    days: [],
  },
  [
    { weekday: 1, startMinute: 1110, isMatch: false }, // Monday 18:30
    { weekday: 2, startMinute: 420, isMatch: false }, // Tuesday 07:00
  ],
);
const running: PlannedActivity = applyDaysToActivity(
  {
    kind: 'cardio',
    label: null,
    sessionsPerWeek: 1,
    minutesPerSession: 30,
    intensity: 'light',
    days: [],
  },
  [{ weekday: 1, startMinute: null, isMatch: false }],
);

describe('dayWorkBlock (spec 011 AC11)', () => {
  const fixed = { workBlocks: [{ weekday: 1, startMinute: 480, endMinute: 960 }] };
  const none = { workBlocks: [] };

  it("shows the day's working shift where the typical week has no work block", () => {
    expect(dayWorkBlock(none, shift(TODAY, 'night', 1320, 360), TODAY)).toEqual({
      weekday: 1,
      startMinute: 1320,
      endMinute: 360,
      shift: 'night',
    });
  });

  it('keeps the typical block of a fixed schedule', () => {
    expect(dayWorkBlock(fixed, shift(TODAY, 'night', 1320, 360), TODAY)).toEqual({
      weekday: 1,
      startMinute: 480,
      endMinute: 960,
      shift: null,
    });
  });

  it('shows nothing for a day off, no shift answer or a check-in of another day', () => {
    expect(dayWorkBlock(none, shift(TODAY, 'off'), TODAY)).toBeNull();
    expect(dayWorkBlock(none, shift(TODAY, null), TODAY)).toBeNull();
    expect(dayWorkBlock(none, null, TODAY)).toBeNull();
    expect(dayWorkBlock(none, shift(YESTERDAY, 'morning', 360, 840), TODAY)).toBeNull();
  });
});

describe('weekRows with shifts (spec 011 AC11)', () => {
  it("puts each day's shift in the work slot of the week view", () => {
    const rows = weekRows({
      weekStart: '2026-11-23',
      today: '2026-11-25',
      week: { workBlocks: [], plannedActivities: [] },
      items: [],
      workouts: [],
      flags: [],
      checkins: [shift('2026-11-23', 'night', 1320, 360), shift('2026-11-24', 'off')],
    });
    expect(rows[0]).toMatchObject({
      work: { weekday: 1, startMinute: 1320, endMinute: 360 },
      shift: 'night',
      isEmpty: false,
    });
    expect(rows[1]).toMatchObject({ work: null, shift: null, isEmpty: true });
  });

  it('works without check-ins, as in spec 010', () => {
    const rows = weekRows({
      weekStart: '2026-11-23',
      today: '2026-11-25',
      week: {
        workBlocks: [{ weekday: 1, startMinute: 480, endMinute: 960 }],
        plannedActivities: [],
      },
      items: [],
      workouts: [],
      flags: [],
    });
    expect(rows[0]).toMatchObject({ work: { startMinute: 480 }, shift: null });
  });
});

describe('dayNotices (spec 011 AC12)', () => {
  const activities = [gym, running];

  it("warns when today's training falls inside today's shift", () => {
    const afternoon = shift(TODAY, 'afternoon', 840, 1320);
    expect(
      dayNotices({ date: TODAY, plannedActivities: activities, checkins: [afternoon] }),
    ).toEqual([{ type: 'shift_overlap', activityIndex: 0, startMinute: 1110, shift: 'afternoon' }]);
  });

  it('says nothing when the training is outside the shift, or without a shift', () => {
    const morning = shift(TODAY, 'morning', 360, 840);
    expect(dayNotices({ date: TODAY, plannedActivities: activities, checkins: [morning] })).toEqual(
      [],
    );
    expect(dayNotices({ date: TODAY, plannedActivities: activities, checkins: [] })).toEqual([]);
    const off = shift(TODAY, 'off');
    expect(dayNotices({ date: TODAY, plannedActivities: activities, checkins: [off] })).toEqual([]);
  });

  it('counts a training that starts before the shift and runs into it', () => {
    const fromSeven = shift(TODAY, 'night', 1140, 420); // 19:00–07:00, gym 18:30–19:30
    expect(
      dayNotices({ date: TODAY, plannedActivities: activities, checkins: [fromSeven] }),
    ).toHaveLength(1);
  });

  it("covers the early hours of the next day with yesterday's night shift", () => {
    const tuesday = '2026-11-24';
    const night = shift(TODAY, 'night', 1320, 480); // Monday 22:00 – Tuesday 08:00
    expect(dayNotices({ date: tuesday, plannedActivities: activities, checkins: [night] })).toEqual(
      [{ type: 'shift_overlap', activityIndex: 0, startMinute: 420, shift: 'night' }],
    );
  });

  it('ignores a shift of yesterday that ended the same day', () => {
    const tuesday = '2026-11-24';
    const afternoon = shift(TODAY, 'afternoon', 840, 1320);
    expect(
      dayNotices({ date: tuesday, plannedActivities: activities, checkins: [afternoon] }),
    ).toEqual([]);
  });
});

describe('the day of a check-in (spec 011 Safety "Dates")', () => {
  const MADRID = 'Europe/Madrid';
  const day = (iso: string) => localToday(new Date(iso), 240, MADRID);

  it('writes a check-in at 02:30 with a 04:00 day start on the previous day, on both DST nights', () => {
    // 29 Mar 2026: 02:00 CET jumps to 03:00 CEST, so 02:30 does not exist; 01:30 and 03:30 do.
    expect(day('2026-03-29T00:30:00Z')).toBe('2026-03-28'); // 01:30 CET
    expect(day('2026-03-29T01:30:00Z')).toBe('2026-03-28'); // 03:30 CEST
    // 25 Oct 2026: 02:30 happens twice.
    expect(day('2026-10-25T00:30:00Z')).toBe('2026-10-24'); // 02:30 CEST
    expect(day('2026-10-25T01:30:00Z')).toBe('2026-10-24'); // 02:30 CET
  });
});
