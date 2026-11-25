import type { MealType, PlannedActivity } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { applyDaysToActivity } from './typical';
import { dayAccess, dayMeals, dayPlanMeals, moveWeek, weekNavigation, weekRows } from './view';

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

describe('weekNavigation and moveWeek (spec 010 AC10, spec 013 AC1)', () => {
  it('goes back 12 weeks and forward to the end of the plan horizon (3 weeks)', () => {
    expect(weekNavigation(MONDAY, TODAY)).toEqual({
      canGoBack: true,
      canGoForward: true,
      isCurrent: true,
    });
    expect(weekNavigation('2026-11-30', TODAY)).toMatchObject({ canGoForward: true });
    expect(weekNavigation('2026-12-07', TODAY)).toMatchObject({ canGoForward: false });
    expect(weekNavigation('2026-08-24', TODAY)).toMatchObject({ canGoBack: false }); // 12 weeks
    expect(weekNavigation('2026-08-31', TODAY)).toMatchObject({ canGoBack: true });
  });

  it('moves by weeks and stays inside the range; "Hoy" is 0 weeks from any week', () => {
    expect(moveWeek(MONDAY, -1, TODAY)).toBe('2026-11-09');
    expect(moveWeek(MONDAY, 1, TODAY)).toBe('2026-11-23');
    expect(moveWeek('2026-12-07', 1, TODAY)).toBe('2026-12-07');
    expect(moveWeek(MONDAY, 5, TODAY)).toBe('2026-12-07');
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
      { mealType: 'breakfast', items: [items[1]], kcal: 301, pending: [], pendingKcal: null },
      { mealType: 'dinner', items: [items[0]], kcal: 600, pending: [], pendingKcal: null },
    ]);
  });

  it('hides the kcal with ed_soft_stop', () => {
    expect(dayMeals(items, MONDAY, ['ed_soft_stop']).map((m) => m.kcal)).toEqual([null, null]);
  });
});

// ── The plan on the week view and the day screen (spec 013) ──────────────────────────────────────

const planned = (id: string, localDate: string, mealType: MealType, kcal: number) => ({
  id,
  ...item(localDate, mealType, kcal),
});
const plannedSession = (id: string, localDate: string, startMinute: number | null) => ({
  id,
  localDate,
  startMinute,
});

describe('weekRows with the plan (spec 013 AC2, AC3, AC7)', () => {
  const plan = {
    mealItems: [
      planned('p-lunch', TODAY, 'lunch', 700),
      planned('p-dinner', TODAY, 'dinner', 800),
      planned('p-fri', '2026-11-20', 'dinner', 600),
      planned('p-mon', MONDAY, 'dinner', 500),
    ],
    workouts: [
      plannedSession('s-today-done', TODAY, 1110),
      plannedSession('s-today', TODAY, 1200),
      plannedSession('s-fri', '2026-11-20', 1110),
      plannedSession('s-mon', MONDAY, 1110),
    ],
  };
  const input = {
    weekStart: MONDAY,
    today: TODAY,
    week,
    // Today's dinner was logged from the plan, with a bigger portion.
    items: [{ ...item(TODAY, 'dinner', 850), plannedItemId: 'p-dinner' }],
    workouts: [
      { ...workout('w', TODAY, '2026-11-18T18:30:00+01:00'), plannedWorkoutId: 's-today-done' },
    ],
    flags: [],
    plan,
    targetKcal: 2200,
  };

  it('shows planned meals as outlined dots, the planned energy and the pending sessions', () => {
    const rows = weekRows(input);
    const today = rows[2]!;
    expect(today).toMatchObject({
      meals: ['dinner'],
      plannedMeals: ['lunch'],
      kcal: 850,
      planKcal: { kcal: 1550, targetKcal: 2200 },
      planned: [],
    });
    expect(today.plannedSessions.map((s) => s.id)).toEqual(['s-today']);
    expect(today.workouts.map((w) => w.id)).toEqual(['w']);

    const friday = rows[4]!;
    expect(friday).toMatchObject({
      meals: [],
      plannedMeals: ['dinner'],
      kcal: null,
      planKcal: { kcal: 600, targetKcal: 2200 },
      planned: [],
      isEmpty: false,
    });
    expect(friday.plannedSessions.map((s) => s.id)).toEqual(['s-fri']);
  });

  it('shows only what was logged on a past day, and the typical week on a day without a plan', () => {
    const monday = weekRows(input)[0]!;
    expect(monday).toMatchObject({ plannedMeals: [], planKcal: null, plannedSessions: [] });
    expect(monday.planned).toHaveLength(1);
    const thursday = weekRows({ ...input, week: { ...week, plannedActivities: [] } })[3]!;
    expect(thursday).toMatchObject({ plannedSessions: [], planned: [], isEmpty: false });
  });

  it('hides every planned number with ed_soft_stop and the target without numeric targets', () => {
    const today = weekRows({ ...input, flags: ['ed_soft_stop'] })[2]!;
    expect(today).toMatchObject({ plannedMeals: ['lunch'], planKcal: null, kcal: null });
    const pregnant = weekRows({ ...input, flags: ['pregnancy'], targetKcal: null })[4]!;
    expect(pregnant.planKcal).toEqual({ kcal: 600, targetKcal: null });
  });

  it('never counts a planned item as eaten (AC7)', () => {
    const withoutPlan = weekRows({ ...input, plan: undefined });
    expect(weekRows(input).map((r) => r.kcal)).toEqual(withoutPlan.map((r) => r.kcal));
    expect(weekRows(input).map((r) => r.meals)).toEqual(withoutPlan.map((r) => r.meals));
  });
});

describe('dayMeals and dayPlanMeals with the plan (AC4, AC8)', () => {
  const logged = [{ ...item(TODAY, 'lunch', 400), plannedItemId: 'p-lunch-1' }];
  const plan = [
    planned('p-lunch-1', TODAY, 'lunch', 380),
    planned('p-lunch-2', TODAY, 'lunch', 120.4),
    planned('p-dinner', TODAY, 'dinner', 800),
    planned('p-other-day', MONDAY, 'dinner', 500),
  ];

  it('lists the pending planned items under each meal, also a meal with only a plan', () => {
    expect(dayMeals(logged, TODAY, [], plan)).toEqual([
      {
        mealType: 'lunch',
        items: logged,
        kcal: 400,
        pending: [plan[1]],
        pendingKcal: 120,
      },
      { mealType: 'dinner', items: [], kcal: null, pending: [plan[2]], pendingKcal: 800 },
    ]);
    expect(dayMeals(logged, TODAY, ['ed_soft_stop'], plan)[1]!.pendingKcal).toBeNull();
  });

  it('gives "Plan del día" the six meals with their pending planned items', () => {
    const meals = dayPlanMeals(plan, logged, TODAY, []);
    expect(meals.map((m) => m.mealType)).toEqual([
      'breakfast',
      'mid_morning',
      'lunch',
      'afternoon_snack',
      'dinner',
      'other',
    ]);
    expect(meals[2]).toEqual({ mealType: 'lunch', items: [plan[1]], kcal: 120 });
    expect(meals[4]).toEqual({ mealType: 'dinner', items: [plan[2]], kcal: 800 });
    expect(meals[0]).toEqual({ mealType: 'breakfast', items: [], kcal: null });
    expect(dayPlanMeals(plan, logged, TODAY, ['ed_soft_stop'])[4]!.kcal).toBeNull();
  });
});
