import { describe, expect, it } from 'vitest';
import {
  canPlan,
  checkPlanRange,
  checkPlanWrite,
  copyWeekTargets,
  planCacheRange,
  planHorizon,
  planTargetWeeks,
} from './horizon';

describe('planHorizon and canPlan (spec 013 AC1)', () => {
  it('goes from today to the Sunday three weeks after the current week', () => {
    expect(planHorizon('2026-11-25')).toEqual({ from: '2026-11-25', to: '2026-12-20' }); // Wednesday
    expect(planHorizon('2026-11-23')).toEqual({ from: '2026-11-23', to: '2026-12-20' }); // Monday: 27 days
    expect(planHorizon('2026-11-29')).toEqual({ from: '2026-11-29', to: '2026-12-20' }); // Sunday: 21 days
    expect(planHorizon('2026-11-30').to).toBe('2026-12-27'); // the horizon grows a week on Monday
  });

  it('plans only inside the horizon: never before today nor after its Sunday', () => {
    expect(canPlan('2026-11-25', '2026-11-25')).toBe(true);
    expect(canPlan('2026-12-20', '2026-11-25')).toBe(true);
    expect(canPlan('2026-11-24', '2026-11-25')).toBe(false);
    expect(canPlan('2026-12-21', '2026-11-25')).toBe(false);
  });
});

describe('planTargetWeeks and copyWeekTargets (AC19, AC21)', () => {
  it('groups the days from today to the horizon by week', () => {
    const weeks = planTargetWeeks('2026-11-25');
    expect(weeks.map((w) => w.weekStart)).toEqual([
      '2026-11-23',
      '2026-11-30',
      '2026-12-07',
      '2026-12-14',
    ]);
    expect(weeks[0]!.days).toEqual([
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
    ]);
    expect(weeks[3]!.days).toHaveLength(7);
    expect(weeks[3]!.days.at(-1)).toBe('2026-12-20');
  });

  it('offers the weeks after the shown one inside the horizon', () => {
    expect(copyWeekTargets('2026-11-23', '2026-11-25')).toEqual([
      '2026-11-30',
      '2026-12-07',
      '2026-12-14',
    ]);
    expect(copyWeekTargets('2026-11-16', '2026-11-25')).toEqual([
      '2026-11-23',
      '2026-11-30',
      '2026-12-07',
      '2026-12-14',
    ]);
    expect(copyWeekTargets('2026-12-14', '2026-11-25')).toEqual([]);
  });
});

describe('planCacheRange (AC22)', () => {
  it('keeps the plan from 27 days back to the horizon, inside one plan read', () => {
    expect(planCacheRange('2026-11-25')).toEqual({ from: '2026-10-29', to: '2026-12-20' });
    const { from, to } = planCacheRange('2026-11-23');
    expect(checkPlanRange(from, to)).toBeNull();
  });
});

describe('checkPlanWrite and checkPlanRange (AC23)', () => {
  const now = new Date('2026-11-25T10:00:00.000Z');
  const recordedAt = '2026-11-25T09:59:00.000Z';

  it('accepts a date from yesterday to today + 28 days, server UTC', () => {
    expect(checkPlanWrite({ localDate: '2026-11-24', recordedAt }, now)).toBeNull();
    expect(checkPlanWrite({ localDate: '2026-12-23', recordedAt }, now)).toBeNull();
  });

  it('rejects older or farther dates and a device clock more than a day ahead', () => {
    expect(checkPlanWrite({ localDate: '2026-11-23', recordedAt }, now)).toEqual({
      localDate: 'too_old',
    });
    expect(checkPlanWrite({ localDate: '2026-12-24', recordedAt }, now)).toEqual({
      localDate: 'too_far',
    });
    expect(
      checkPlanWrite({ localDate: '2026-11-25', recordedAt: '2026-11-26T10:00:01.000Z' }, now),
    ).toEqual({ recordedAt: 'in_future' });
  });

  it('reads at most 63 days, in order', () => {
    expect(checkPlanRange('2026-10-29', '2026-12-31')).toBeNull();
    expect(checkPlanRange('2026-10-29', '2027-01-01')).toEqual({ to: 'too_big' });
    expect(checkPlanRange('2026-11-26', '2026-11-25')).toEqual({ from: 'after_to' });
  });
});
