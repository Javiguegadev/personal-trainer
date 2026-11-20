import { PlannedActivitySchema, WeekRequestSchema, type PlannedActivity } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import {
  activityStartMinute,
  applyDaysToActivity,
  blockEndsNextDay,
  copyWorkHours,
  isValidWorkBlock,
  sameTrainingLoad,
  setActivityStartMinute,
  setMatchDay,
  setWorkHours,
  toggleActivityDay,
  toggleWorkDay,
  typicalDay,
  weekNotices,
  weekToRequest,
} from './typical';

const day = (weekday: number, startMinute: number | null = null, isMatch = false) => ({
  weekday,
  startMinute,
  isMatch,
});

const gym: PlannedActivity = {
  kind: 'strength',
  label: null,
  sessionsPerWeek: 3,
  minutesPerSession: 60,
  intensity: 'moderate',
  days: [],
};
const football: PlannedActivity = {
  kind: 'sport',
  label: 'fútbol',
  sessionsPerWeek: 2,
  minutesPerSession: 90,
  intensity: 'moderate',
  days: [],
};
const work = (weekday: number, startMinute = 480, endMinute = 960) => ({
  weekday,
  startMinute,
  endMinute,
});
const weekdaysWork = [1, 2, 3, 4, 5].map((w) => work(w));

describe('applyDaysToActivity and the day chips (spec 010 AC2)', () => {
  it('makes sessionsPerWeek the number of days, sorted by weekday', () => {
    const next = applyDaysToActivity(gym, [day(5), day(1), day(3)]);
    expect(next.sessionsPerWeek).toBe(3);
    expect(next.days.map((d) => d.weekday)).toEqual([1, 3, 5]);
    expect(PlannedActivitySchema.safeParse(next).success).toBe(true);
  });

  it('keeps the last count when every chip is cleared', () => {
    const withDays = applyDaysToActivity({ ...gym, sessionsPerWeek: 4 }, [day(1), day(2)]);
    expect(withDays.sessionsPerWeek).toBe(2);
    const cleared = applyDaysToActivity(withDays, []);
    expect(cleared).toMatchObject({ days: [], sessionsPerWeek: 2 });
  });

  it('allows a match only on a sport', () => {
    expect(applyDaysToActivity(gym, [day(6, 660, true)]).days[0]!.isMatch).toBe(false);
    expect(applyDaysToActivity(football, [day(6, 660, true)]).days[0]!.isMatch).toBe(true);
  });

  it('toggles a weekday with the shared start time', () => {
    let next = toggleActivityDay(gym, 1);
    next = setActivityStartMinute(next, 1110); // 18:30
    next = toggleActivityDay(next, 3);
    expect(next.days).toEqual([day(1, 1110), day(3, 1110)]);
    expect(activityStartMinute(next)).toBe(1110);
    next = toggleActivityDay(next, 1);
    expect(next).toMatchObject({ days: [day(3, 1110)], sessionsPerWeek: 1 });
  });

  it('gives a match day its own start time and leaves it out of the shared one', () => {
    let next = applyDaysToActivity(football, [day(2, 1200), day(6, 1200)]);
    next = setMatchDay(next, 6, { isMatch: true, startMinute: 660 });
    next = setActivityStartMinute(next, 1230);
    expect(next.days).toEqual([day(2, 1230), day(6, 660, true)]);
    next = setMatchDay(next, 6, { isMatch: false, startMinute: null });
    expect(next.days).toEqual([day(2, 1230), day(6, 1230)]);
  });
});

describe('work blocks (spec 010 AC3)', () => {
  it('says a block ends the next day when its end is earlier, and rejects equal times', () => {
    expect(blockEndsNextDay(work(1, 1320, 360))).toBe(true);
    expect(blockEndsNextDay(work(1, 480, 960))).toBe(false);
    expect(isValidWorkBlock(work(1, 480, 480))).toBe(false);
  });

  it('adds and removes days, changes one alone and copies one to the others', () => {
    let blocks = toggleWorkDay([], 3, { startMinute: 480, endMinute: 960 });
    blocks = toggleWorkDay(blocks, 1, { startMinute: 480, endMinute: 960 });
    expect(blocks.map((b) => b.weekday)).toEqual([1, 3]);
    blocks = setWorkHours(blocks, 3, { startMinute: 540, endMinute: 1020 });
    expect(blocks).toEqual([work(1), work(3, 540, 1020)]);
    expect(copyWorkHours(blocks, 3)).toEqual([work(1, 540, 1020), work(3, 540, 1020)]);
    expect(toggleWorkDay(blocks, 1, { startMinute: 0, endMinute: 1 })).toEqual([
      work(3, 540, 1020),
    ]);
  });

  it('stores work blocks only with fixed hours', () => {
    const input = {
      workBlocks: weekdaysWork,
      dayStartMinute: 0,
      plannedActivities: [gym],
      today: '2026-11-20',
    };
    const fixed = weekToRequest({ ...input, workPattern: 'fixed' });
    expect(fixed.workBlocks).toHaveLength(5);
    expect(WeekRequestSchema.safeParse(fixed).success).toBe(true);
    for (const workPattern of ['shifts', 'irregular', 'none'] as const) {
      const request = weekToRequest({ ...input, workPattern });
      expect(request.workBlocks).toEqual([]);
      expect(WeekRequestSchema.safeParse(request).success).toBe(true);
    }
  });
});

describe('sameTrainingLoad (spec 010 AC4)', () => {
  it('ignores days, times and names', () => {
    const withDays = applyDaysToActivity(gym, [day(1, 1110), day(3), day(5)]);
    expect(sameTrainingLoad([gym], [{ ...withDays, label: 'gimnasio' }])).toBe(true);
  });

  it('sees a change in the number of days, minutes, intensity or activities', () => {
    expect(sameTrainingLoad([gym], [applyDaysToActivity(gym, [day(1), day(3)])])).toBe(false);
    expect(sameTrainingLoad([gym], [{ ...gym, minutesPerSession: 45 }])).toBe(false);
    expect(sameTrainingLoad([gym], [{ ...gym, intensity: 'hard' }])).toBe(false);
    expect(sameTrainingLoad([gym], [gym, football])).toBe(false);
  });
});

describe('typicalDay (spec 010 AC8)', () => {
  it('returns the work block and the activities of the weekday by start time', () => {
    const week = {
      workBlocks: weekdaysWork,
      plannedActivities: [
        applyDaysToActivity(gym, [day(1, 1110), day(3, 1110), day(6)]),
        applyDaysToActivity(football, [day(3, 1200), day(6, 660, true)]),
      ],
    };
    expect(typicalDay(week, 3)).toEqual({
      weekday: 3,
      work: work(3),
      training: [
        expect.objectContaining({ activityIndex: 0, startMinute: 1110, kind: 'strength' }),
        expect.objectContaining({ activityIndex: 1, startMinute: 1200, isMatch: false }),
      ],
    });
    const saturday = typicalDay(week, 6);
    expect(saturday.work).toBeNull();
    expect(saturday.training.map((s) => [s.activityIndex, s.isMatch])).toEqual([
      [1, true],
      [0, false], // no time: last
    ]);
    expect(typicalDay({ workBlocks: [], plannedActivities: [gym] }, 1).training).toEqual([]);
  });
});

describe('weekNotices (spec 010 AC5)', () => {
  it('flags a session that overlaps the work block of its day', () => {
    const notices = weekNotices({
      workBlocks: weekdaysWork,
      plannedActivities: [applyDaysToActivity(gym, [day(1, 900), day(3, 960), day(5)])],
    });
    // Monday 15:00–16:00 overlaps 08:00–16:00; Wednesday starts at 16:00; Friday has no time.
    expect(notices).toEqual([{ type: 'work_overlap', weekday: 1, activityIndex: 0 }]);
  });

  it('counts a night block on the next day too', () => {
    const notices = weekNotices({
      workBlocks: [work(1, 1320, 360)], // Monday 22:00 – Tuesday 06:00
      plannedActivities: [applyDaysToActivity(gym, [day(2, 300), day(3, 300)])],
    });
    expect(notices).toEqual([{ type: 'work_overlap', weekday: 2, activityIndex: 0 }]);
  });

  it('flags strength or a hard session the day before a match', () => {
    const notices = weekNotices({
      workBlocks: [],
      plannedActivities: [
        applyDaysToActivity(gym, [day(1), day(5)]),
        applyDaysToActivity({ ...football, intensity: 'hard' }, [day(3), day(6, 660, true)]),
        applyDaysToActivity({ ...gym, kind: 'cardio', intensity: 'light', sessionsPerWeek: 1 }, [
          day(5),
        ]),
      ],
    });
    expect(notices).toEqual([
      { type: 'hard_before_match', weekday: 5, activityIndex: 0, matchWeekday: 6 },
    ]);
  });

  it('wraps from Monday to the Sunday before', () => {
    const notices = weekNotices({
      workBlocks: [],
      plannedActivities: [
        applyDaysToActivity({ ...gym, sessionsPerWeek: 1 }, [day(7)]),
        applyDaysToActivity({ ...football, sessionsPerWeek: 1 }, [day(1, 1200, true)]),
      ],
    });
    expect(notices).toEqual([
      { type: 'hard_before_match', weekday: 7, activityIndex: 0, matchWeekday: 1 },
    ]);
  });

  it('flags a week with no rest day, and nothing for activities without days', () => {
    const everyDay = [1, 2, 3, 4, 5, 6, 7].map((w) => day(w));
    expect(
      weekNotices({ workBlocks: [], plannedActivities: [applyDaysToActivity(gym, everyDay)] }),
    ).toEqual([{ type: 'no_rest_day' }]);
    expect(
      weekNotices({ workBlocks: [], plannedActivities: [{ ...gym, sessionsPerWeek: 7 }] }),
    ).toEqual([]);
  });
});
