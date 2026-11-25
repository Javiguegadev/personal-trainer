import { describe, expect, it } from 'vitest';
import {
  isStaleRoutineLink,
  pendingPlannedItems,
  pendingPlannedWorkouts,
  plannedWorkoutStatus,
  resolvePlannedSession,
  sortPlannedSessions,
  todayPlannedSessions,
} from './status';
import {
  OLD_SESSION_ID,
  PROGRAM,
  SESSION_B,
  TODAY,
  loggedItem,
  plannedActivity,
  plannedItem,
  plannedSession,
  uuid,
  workout,
} from './test-fixtures';

describe('pendingPlannedItems (spec 013 AC9)', () => {
  const rice = plannedItem({ id: uuid(1) });
  const salad = plannedItem({ id: uuid(2), label: 'Ensalada' });

  it('is every planned item no live log item points at', () => {
    expect(pendingPlannedItems([rice, salad], [])).toEqual([rice, salad]);
    const logged = loggedItem({ plannedItemId: rice.id });
    expect(pendingPlannedItems([rice, salad], [logged])).toEqual([salad]);
  });

  it('is pending again once that log item is deleted (it leaves the list)', () => {
    expect(pendingPlannedItems([rice], [loggedItem({ plannedItemId: null })])).toEqual([rice]);
  });
});

describe('plannedWorkoutStatus and pendingPlannedWorkouts (AC17)', () => {
  const planned = plannedSession({ id: uuid(300) });

  it('is done while a live workout points at it, pending when that workout is deleted', () => {
    const done = workout({ localDate: TODAY, plannedWorkoutId: planned.id });
    expect(plannedWorkoutStatus([planned], [done])).toEqual([{ planned, done }]);
    expect(plannedWorkoutStatus([planned], [])).toEqual([{ planned, done: null }]);
    expect(pendingPlannedWorkouts([planned], [done])).toEqual([]);
    expect(pendingPlannedWorkouts([planned], [workout()])).toEqual([planned]);
  });
});

describe('sortPlannedSessions and todayPlannedSessions (AC14)', () => {
  it('lists today’s pending planned sessions by start time, untimed ones last', () => {
    const untimed = plannedActivity({ id: uuid(351), startMinute: null });
    const evening = plannedSession({ id: uuid(301), startMinute: 1110 });
    const morning = plannedActivity({ id: uuid(352), startMinute: 420 });
    const tomorrow = plannedSession({ id: uuid(302), localDate: '2026-11-26' });
    const done = plannedSession({ id: uuid(303), startMinute: 600 });
    const log = [workout({ localDate: TODAY, plannedWorkoutId: done.id })];

    expect(sortPlannedSessions([untimed, evening, morning])).toEqual([morning, evening, untimed]);
    expect(todayPlannedSessions([untimed, evening, morning, tomorrow, done], log, TODAY)).toEqual([
      morning,
      evening,
      untimed,
    ]);
    expect(todayPlannedSessions([tomorrow], [], TODAY)).toEqual([]);
  });
});

describe('resolvePlannedSession and isStaleRoutineLink (AC15, Stale links)', () => {
  it('starts a session of the current routine', () => {
    const planned = plannedSession({ programSessionId: SESSION_B.id, name: SESSION_B.name });
    expect(resolvePlannedSession(planned, PROGRAM)).toEqual({
      type: 'program',
      session: SESSION_B,
    });
    expect(isStaleRoutineLink(planned, PROGRAM)).toBe(false);
  });

  it('turns a session of a deleted routine into a free gym session with its name', () => {
    const planned = plannedSession({ programSessionId: OLD_SESSION_ID, name: 'Pierna' });
    expect(isStaleRoutineLink(planned, PROGRAM)).toBe(true);
    expect(isStaleRoutineLink(planned, null)).toBe(true);
    expect(resolvePlannedSession(planned, PROGRAM)).toEqual({ type: 'free', name: 'Pierna' });
    expect(resolvePlannedSession(planned, null)).toEqual({ type: 'free', name: 'Pierna' });
  });

  it('repeats a past workout, starts a free gym session, or logs an activity', () => {
    const repeat = plannedSession({
      programSessionId: null,
      repeatWorkoutId: uuid(400),
      name: 'Torso',
    });
    expect(resolvePlannedSession(repeat, PROGRAM)).toEqual({
      type: 'repeat',
      workoutId: uuid(400),
      name: 'Torso',
    });
    const free = plannedSession({ programSessionId: null, name: null });
    expect(resolvePlannedSession(free, PROGRAM)).toEqual({ type: 'free', name: null });
    expect(isStaleRoutineLink(free, PROGRAM)).toBe(false);
    expect(resolvePlannedSession(plannedActivity(), PROGRAM)).toEqual({ type: 'activity' });
  });
});
