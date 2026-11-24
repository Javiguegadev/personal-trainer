import type { MealType, PlannedActivity } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { applyDaysToActivity } from './typical';
import { dayAccess, dayMeals, moveWeek, weekNavigation, weekRows } from './view';

const TODAY = '2026-11-18'; // Wednesday
const MONDAY = '2026-11-16';

const gym: PlannedActivity = applyDaysToActivity(
  {
    kind: 'strength',
    label: null,
    sessionsPerWeek: 3,
    minutesPerSession: 60,
    intensity: 'moderate',
    days: [],
  },
  [1, 3, 5].map((weekday) => ({ weekday, startMinute: 1110, isMatch: false })),
);
const week = {
  workBlocks: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 480, endMinute: 960 })),
  plannedActivities: [gym],
};

const item = (localDate: string, mealType: MealType, kcal: number) => ({
  localDate,
  mealType,
  nutrients: { kcal, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null },
});
const workout = (id: string, localDate: string, startedAt: string) => ({
  id,
  localDate,
  startedAt,
});

describe('weekNavigation and moveWeek (spec 010 AC10)', () => {
  it('goes back 12 weeks and forward to next week', () => {
    expect(weekNavigation(MONDAY, TODAY)).toEqual({
      canGoBack: true,
      canGoForward: true,
      isCurrent: true,
    });
    expect(weekNavigation('2026-11-23', TODAY)).toMatchObject({ canGoForward: false });
    expect(weekNavigation('2026-08-24', TODAY)).toMatchObject({ canGoBack: false }); // 12 weeks
    expect(weekNavigation('2026-08-31', TODAY)).toMatchObject({ canGoBack: true });
  });

  it('moves by weeks and stays inside the range; "Hoy" is 0 weeks from any week', () => {
    expect(moveWeek(MONDAY, -1, TODAY)).toBe('2026-11-09');
    expect(moveWeek(MONDAY, 1, TODAY)).toBe('2026-11-23');
    expect(moveWeek('2026-11-23', 1, TODAY)).toBe('2026-11-23');
    expect(moveWeek('2026-08-24', -1, TODAY)).toBe('2026-08-24');
  });
});

describe('dayAccess (spec 010 AC12)', () => {
  it('adds for today and the 27 days before, reads older days and shows future days', () => {
    expect(dayAccess(TODAY, TODAY)).toBe('add');
    expect(dayAccess('2026-10-22', TODAY)).toBe('add'); // 27 days before
    expect(dayAccess('2026-10-21', TODAY)).toBe('read_only');
    expect(dayAccess('2026-11-19', TODAY)).toBe('future');
  });
});

describe('weekRows (spec 010 AC8–AC10)', () => {
  const input = {
    weekStart: MONDAY,
    today: TODAY,
    week,
    items: [
      item(MONDAY, 'lunch', 700.4),
      item(MONDAY, 'breakfast', 400.3),
      item(MONDAY, 'lunch', 99.6),
      item('2026-11-09', 'dinner', 500), // previous week
    ],
    workouts: [
      workout('b', MONDAY, '2026-11-16T19:00:00+01:00'),
      workout('a', MONDAY, '2026-11-16T07:00:00+01:00'),
    ],
    flags: [],
  };

  it('gives one row per day, Monday to Sunday, with work, plan, workouts, meal dots and kcal', () => {
    const rows = weekRows(input);
    expect(rows.map((r) => r.date)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    const monday = rows[0]!;
    expect(monday).toMatchObject({
      weekday: 1,
      isToday: false,
      isFuture: false,
      work: { startMinute: 480, endMinute: 960 },
      meals: ['breakfast', 'lunch'],
      kcal: 1200,
      isEmpty: false,
    });
    expect(monday.planned).toEqual([
      expect.objectContaining({ kind: 'strength', startMinute: 1110 }),
    ]);
    expect(monday.workouts.map((w) => w.id)).toEqual(['a', 'b']);
    expect(rows[2]).toMatchObject({ isToday: true, kcal: null, meals: [] });
  });

  it('shows only the date on a day with nothing', () => {
    expect(weekRows(input)[6]).toMatchObject({ isEmpty: true, planned: [], work: null });
  });

  it('shows only the typical week on future days', () => {
    const rows = weekRows({
      ...input,
      items: [...input.items, item('2026-11-19', 'lunch', 500)],
      workouts: [workout('c', '2026-11-20', '2026-11-20T19:00:00+01:00')],
    });
    expect(rows[3]).toMatchObject({ isFuture: true, meals: [], kcal: null, workouts: [] });
    expect(rows[4]).toMatchObject({ isFuture: true, workouts: [] });
    expect(rows[4]!.planned).toHaveLength(1);
  });

  it('shows the meal dots and no kcal with ed_soft_stop (AC9)', () => {
    const monday = weekRows({ ...input, flags: ['ed_soft_stop'] })[0]!;
    expect(monday).toMatchObject({ meals: ['breakfast', 'lunch'], kcal: null });
  });
});

describe('dayMeals (spec 010 AC11)', () => {
  const items = [
    item(MONDAY, 'dinner', 600),
    item(MONDAY, 'breakfast', 300.6),
    item(TODAY, 'lunch', 1),
  ];

  it('groups the items of the day by meal, in the order of the day, with their kcal', () => {
    expect(dayMeals(items, MONDAY, [])).toEqual([
      { mealType: 'breakfast', items: [items[1]], kcal: 301 },
      { mealType: 'dinner', items: [items[0]], kcal: 600 },
    ]);
  });

  it('hides the kcal with ed_soft_stop', () => {
    expect(dayMeals(items, MONDAY, ['ed_soft_stop']).map((m) => m.kcal)).toEqual([null, null]);
  });
});
