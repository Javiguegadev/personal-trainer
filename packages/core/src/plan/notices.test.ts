import { describe, expect, it } from 'vitest';
import { planNotices } from './notices';
import {
  FOOTBALL,
  GYM_MWF,
  OFFICE,
  TODAY,
  plannedActivity,
  plannedSession,
  uuid,
} from './test-fixtures';

const week = { workBlocks: OFFICE, plannedActivities: [GYM_MWF, FOOTBALL] };

describe('planNotices: work overlap (spec 013 AC13)', () => {
  it('notes a planned session whose time overlaps the work block of its day', () => {
    const early = plannedSession({ id: uuid(301), localDate: '2026-11-27', startMinute: 960 });
    const evening = plannedSession({ id: uuid(302), localDate: '2026-11-27', startMinute: 1110 });
    const untimed = plannedSession({ id: uuid(303), localDate: '2026-11-27', startMinute: null });
    expect(
      planNotices({ date: '2026-11-27', planned: [early, evening, untimed], week, checkins: [] }),
    ).toEqual([{ type: 'work_overlap', plannedId: early.id, shift: null }]);
  });

  it('uses the gym minutes of the strength activity when the session has none', () => {
    const noMinutes = plannedSession({ localDate: '2026-11-27', startMinute: 975, minutes: null });
    expect(planNotices({ date: '2026-11-27', planned: [noMinutes], week })).toHaveLength(1);
    const after = plannedSession({ localDate: '2026-11-27', startMinute: 1020, minutes: null });
    expect(planNotices({ date: '2026-11-27', planned: [after], week })).toEqual([]);
  });

  it('uses the shift of the check-in, also a night shift into the next morning', () => {
    const shiftWeek = { workBlocks: [], plannedActivities: [GYM_MWF] };
    const checkins = [
      {
        localDate: TODAY,
        workShift: 'night' as const,
        shiftStartMinute: 1320,
        shiftEndMinute: 360,
      },
    ];
    const tonight = plannedSession({ id: uuid(304), localDate: TODAY, startMinute: 1380 });
    expect(planNotices({ date: TODAY, planned: [tonight], week: shiftWeek, checkins })).toEqual([
      { type: 'work_overlap', plannedId: tonight.id, shift: 'night' },
    ]);
    const dawn = plannedActivity({ id: uuid(353), localDate: '2026-11-26', startMinute: 300 });
    expect(planNotices({ date: '2026-11-26', planned: [dawn], week: shiftWeek, checkins })).toEqual(
      [{ type: 'work_overlap', plannedId: dawn.id, shift: 'night' }],
    );
  });
});

describe('planNotices: the day before a match (AC13)', () => {
  it('notes a strength session or a hard activity the day before a typical-week match', () => {
    const gym = plannedSession({ id: uuid(301), localDate: '2026-11-28', startMinute: 600 });
    const football = plannedActivity({ id: uuid(351), localDate: '2026-11-28' });
    const walk = plannedActivity({
      id: uuid(352),
      localDate: '2026-11-28',
      kind: 'cardio',
      activity: 'walking',
      name: null,
    });
    expect(planNotices({ date: '2026-11-28', planned: [gym, football, walk], week })).toEqual([
      { type: 'hard_before_match', plannedId: gym.id, matchDate: '2026-11-29' },
      { type: 'hard_before_match', plannedId: football.id, matchDate: '2026-11-29' },
    ]);
  });

  it('notes the day before a planned match, not the match itself', () => {
    const match = plannedActivity({ id: uuid(351), localDate: '2026-11-26', isMatch: true });
    const gym = plannedSession({ id: uuid(301), localDate: TODAY, startMinute: 1110 });
    const otherMatch = plannedActivity({ id: uuid(352), localDate: TODAY, isMatch: true });
    expect(planNotices({ date: TODAY, planned: [gym, otherMatch, match], week })).toEqual([
      { type: 'hard_before_match', plannedId: gym.id, matchDate: '2026-11-26' },
    ]);
  });

  it('reads the planned sessions of the next day instead of the typical week when it has some', () => {
    const gym = plannedSession({ id: uuid(301), localDate: '2026-11-28', startMinute: 600 });
    const sundayRun = plannedActivity({
      id: uuid(352),
      localDate: '2026-11-29',
      kind: 'cardio',
      activity: 'running',
      name: null,
    });
    expect(planNotices({ date: '2026-11-28', planned: [gym, sundayRun], week })).toEqual([]);
  });
});
