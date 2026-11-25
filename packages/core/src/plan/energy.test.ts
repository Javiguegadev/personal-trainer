import { describe, expect, it } from 'vitest';
import { plannedDayEnergy } from './energy';
import { TODAY, loggedItem, plannedItem, uuid } from './test-fixtures';

const kcal = (value: number) => ({ kcal: value, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null });

describe('plannedDayEnergy (spec 013 AC2, AC3, AC4)', () => {
  const thursday = '2026-11-27';
  const plan = [
    plannedItem({ id: uuid(1), localDate: thursday, nutrients: kcal(600.4) }),
    plannedItem({ id: uuid(2), localDate: thursday, nutrients: kcal(1549.8) }),
  ];

  it('adds up the plan of a future day, with the day target', () => {
    expect(
      plannedDayEnergy({
        date: thursday,
        today: TODAY,
        planned: plan,
        logged: [],
        flags: [],
        targetKcal: 2199.6,
      }),
    ).toEqual({ kcal: 2150, targetKcal: 2200 });
  });

  it('counts each item once today: the logged items plus the pending planned ones', () => {
    const lunch = plannedItem({ id: uuid(3), localDate: TODAY, nutrients: kcal(700) });
    const dinner = plannedItem({ id: uuid(4), localDate: TODAY, nutrients: kcal(800) });
    const logged = [
      // Lunch was logged from the plan, with a bigger portion.
      loggedItem({ id: uuid(101), plannedItemId: lunch.id, nutrients: kcal(750) }),
      // Breakfast was not planned.
      loggedItem({ id: uuid(102), mealType: 'breakfast', nutrients: kcal(400) }),
      // Another day does not count.
      loggedItem({ id: uuid(103), localDate: '2026-11-24', nutrients: kcal(999) }),
    ];
    expect(
      plannedDayEnergy({
        date: TODAY,
        today: TODAY,
        planned: [lunch, dinner],
        logged,
        flags: [],
        targetKcal: 2200,
      }),
    ).toEqual({ kcal: 1950, targetKcal: 2200 });
  });

  it('is null on a past day, on a day without a plan and with ed_soft_stop', () => {
    const base = { today: TODAY, planned: plan, logged: [], targetKcal: 2200 };
    expect(plannedDayEnergy({ ...base, date: '2026-11-24', flags: [] })).toBeNull();
    expect(plannedDayEnergy({ ...base, date: '2026-11-28', flags: [] })).toBeNull();
    expect(plannedDayEnergy({ ...base, date: thursday, flags: ['ed_soft_stop'] })).toBeNull();
  });

  it('has no target without numeric targets (pregnancy)', () => {
    expect(
      plannedDayEnergy({
        date: thursday,
        today: TODAY,
        planned: plan,
        logged: [],
        flags: ['pregnancy'],
        targetKcal: null,
      }),
    ).toEqual({ kcal: 2150, targetKcal: null });
  });
});
