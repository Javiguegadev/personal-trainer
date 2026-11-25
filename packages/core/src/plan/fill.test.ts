import { describe, expect, it } from 'vitest';
import { applyDaysToActivity } from '../week/typical';
import { fillWeekWithRoutine, type FillWeekInput } from './fill';
import {
  FOOTBALL,
  GYM_MWF,
  OLD_SESSION_ID,
  PROGRAM,
  RECORDED,
  SESSION_A,
  SESSION_B,
  SESSION_C,
  TODAY,
  idSequence,
  plannedActivity,
  plannedSession,
  uuid,
  workout,
} from './test-fixtures';

const CURRENT = '2026-11-23';
const NEXT = '2026-11-30';

/** Monday's workout was Rutina A, so the rotation's next session is B. */
const input = (over: Partial<FillWeekInput> = {}): FillWeekInput => ({
  weekStart: CURRENT,
  today: TODAY,
  program: PROGRAM,
  activities: [GYM_MWF, FOOTBALL],
  workouts: [workout()],
  planned: [],
  newId: idSequence(),
  recordedAt: RECORDED,
  ...over,
});

const summary = (result: ReturnType<typeof fillWeekWithRoutine>) =>
  result.type === 'ok' ? result.placed.map((p) => [p.localDate, p.name]) : result.type;

describe('fillWeekWithRoutine (spec 013 AC11)', () => {
  it('places the rotation on the gym days of the current week, from today', () => {
    const result = fillWeekWithRoutine(input());
    expect(summary(result)).toEqual([
      ['2026-11-25', 'Rutina B'],
      ['2026-11-27', 'Rutina C'],
    ]);
    if (result.type !== 'ok') throw new Error('unexpected');
    expect(result.placed[0]).toEqual({
      id: uuid(9000),
      localDate: '2026-11-25',
      startMinute: 1110,
      kind: 'gym',
      activity: null,
      name: 'Rutina B',
      minutes: 60,
      isMatch: false,
      programSessionId: SESSION_B.id,
      repeatWorkoutId: null,
      recordedAt: RECORDED,
    });
    expect(result.changes.workouts).toEqual({ upserts: result.placed, deletes: [] });
    expect(result.changes.mealItems).toEqual({ upserts: [], deletes: [] });
    // The undo removes what it placed.
    expect(result.undo.workouts).toEqual({
      upserts: [],
      deletes: result.placed.map((p) => ({ id: p.id, recordedAt: RECORDED })),
    });
  });

  it('continues a later week after the last routine session planned before it', () => {
    const planned = [
      plannedSession({ id: uuid(301), localDate: '2026-11-25', programSessionId: SESSION_B.id }),
      plannedSession({ id: uuid(302), localDate: '2026-11-27', programSessionId: SESSION_C.id }),
    ];
    expect(summary(fillWeekWithRoutine(input({ weekStart: NEXT, planned })))).toEqual([
      ['2026-11-30', 'Rutina A'],
      ['2026-12-02', 'Rutina B'],
      ['2026-12-04', 'Rutina C'],
    ]);
    // Nothing planned before it: the rotation starts at the next session.
    expect(summary(fillWeekWithRoutine(input({ weekStart: NEXT })))).toEqual([
      ['2026-11-30', 'Rutina B'],
      ['2026-12-02', 'Rutina C'],
      ['2026-12-04', 'Rutina A'],
    ]);
  });

  it('keeps the days with a planned gym session and follows a routine session planned by hand', () => {
    const planned = [
      plannedSession({ id: uuid(301), localDate: '2026-12-02', programSessionId: SESSION_A.id }),
      plannedSession({
        id: uuid(302),
        localDate: '2026-11-30',
        programSessionId: null,
        name: 'Gimnasio libre',
      }),
    ];
    // Monday has a free gym session; Wednesday's A moves the rotation, so Friday gets B.
    expect(summary(fillWeekWithRoutine(input({ weekStart: NEXT, planned })))).toEqual([
      ['2026-12-04', 'Rutina B'],
    ]);
  });

  it('replaces a session of a deleted routine, and the undo brings it back', () => {
    const stale = plannedSession({
      id: uuid(303),
      localDate: '2026-11-27',
      programSessionId: OLD_SESSION_ID,
      name: 'Pierna',
    });
    const result = fillWeekWithRoutine(input({ planned: [stale] }));
    expect(summary(result)).toEqual([
      ['2026-11-25', 'Rutina B'],
      ['2026-11-27', 'Rutina C'],
    ]);
    if (result.type !== 'ok') throw new Error('unexpected');
    expect(result.changes.workouts.deletes).toEqual([{ id: stale.id, recordedAt: RECORDED }]);
    expect(result.undo.workouts.upserts).toEqual([{ ...stale, recordedAt: RECORDED }]);
  });

  it('never adds a fifth session to a day', () => {
    const full = Array.from({ length: 4 }, (_, i) =>
      plannedActivity({ id: uuid(360 + i), localDate: '2026-11-25', startMinute: 420 + i * 60 }),
    );
    expect(summary(fillWeekWithRoutine(input({ planned: full })))).toEqual([
      ['2026-11-27', 'Rutina B'],
    ]);
  });

  it('needs a routine with sessions and a strength activity with days', () => {
    expect(fillWeekWithRoutine(input({ program: null }))).toEqual({ type: 'no_routine' });
    expect(fillWeekWithRoutine(input({ program: { ...PROGRAM, sessions: [] } }))).toEqual({
      type: 'no_routine',
    });
    expect(fillWeekWithRoutine(input({ activities: [FOOTBALL] }))).toEqual({
      type: 'no_gym_days',
    });
    const undated = applyDaysToActivity(GYM_MWF, []);
    expect(fillWeekWithRoutine(input({ activities: [undated] }))).toEqual({
      type: 'no_gym_days',
    });
  });

  it('places nothing on a past week or beyond the horizon', () => {
    expect(summary(fillWeekWithRoutine(input({ weekStart: '2026-11-16' })))).toEqual([]);
    expect(summary(fillWeekWithRoutine(input({ weekStart: '2026-12-21' })))).toEqual([]);
  });
});
