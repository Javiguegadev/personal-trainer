import { describe, expect, it } from 'vitest';
import {
  PlannedActivitySchema,
  TrainingProfileUpdateSchema,
  WeekRequestSchema,
  type PlannedActivity,
  type WeekRequest,
} from './profile';

const football: PlannedActivity = {
  kind: 'sport',
  label: 'fútbol',
  sessionsPerWeek: 3,
  minutesPerSession: 90,
  intensity: 'moderate',
  days: [
    { weekday: 2, startMinute: 1200, isMatch: false },
    { weekday: 4, startMinute: 1200, isMatch: false },
    { weekday: 6, startMinute: 660, isMatch: true },
  ],
};

const week: WeekRequest = {
  workPattern: 'fixed',
  workBlocks: [
    { weekday: 1, startMinute: 480, endMinute: 960 },
    { weekday: 5, startMinute: 1320, endMinute: 360 },
  ],
  dayStartMinute: 0,
  plannedActivities: [football],
  today: '2026-11-19',
};

describe('PlannedActivitySchema days (spec 010 AC2)', () => {
  it('accepts days whose count equals the sessions per week', () => {
    expect(PlannedActivitySchema.parse(football)).toEqual(football);
  });

  it('defaults to no days, so an activity of spec 002 still parses', () => {
    const withoutDays: Partial<PlannedActivity> = { ...football };
    delete withoutDays.days;
    expect(PlannedActivitySchema.parse(withoutDays).days).toEqual([]);
  });

  it('rejects a day count different from the sessions per week', () => {
    const result = PlannedActivitySchema.safeParse({ ...football, sessionsPerWeek: 2 });
    expect(result.error?.issues[0]?.path).toEqual(['days']);
  });

  it('rejects a repeated weekday', () => {
    const days = [football.days[0], football.days[0], football.days[2]];
    expect(PlannedActivitySchema.safeParse({ ...football, days }).success).toBe(false);
  });

  it('allows match days only for a sport', () => {
    const gym = { ...football, kind: 'strength', label: null };
    expect(PlannedActivitySchema.safeParse(gym).success).toBe(false);
    const noMatch = football.days.map((day) => ({ ...day, isMatch: false }));
    expect(PlannedActivitySchema.safeParse({ ...gym, days: noMatch }).success).toBe(true);
  });

  it('rejects a start time outside the day', () => {
    const days = football.days.map((day) => ({ ...day, startMinute: 1440 }));
    expect(PlannedActivitySchema.safeParse({ ...football, days }).success).toBe(false);
  });
});

describe('WeekRequestSchema (spec 010 AC3, AC4, AC6)', () => {
  it('accepts fixed hours, a block that ends the next day and a day start', () => {
    expect(WeekRequestSchema.parse(week)).toEqual(week);
  });

  it('rejects a block whose end equals its start', () => {
    const workBlocks = [{ weekday: 1, startMinute: 480, endMinute: 480 }];
    expect(WeekRequestSchema.safeParse({ ...week, workBlocks }).success).toBe(false);
  });

  it('rejects two blocks on the same weekday', () => {
    const workBlocks = [week.workBlocks[0], week.workBlocks[0]];
    expect(WeekRequestSchema.safeParse({ ...week, workBlocks }).success).toBe(false);
  });

  it.each(['shifts', 'irregular', 'none'] as const)('stores no blocks with %s', (workPattern) => {
    expect(WeekRequestSchema.safeParse({ ...week, workPattern }).success).toBe(false);
    expect(WeekRequestSchema.safeParse({ ...week, workPattern, workBlocks: [] }).success).toBe(
      true,
    );
  });

  it.each([30, 360, 0])('accepts a day start of %d minutes', (dayStartMinute) => {
    expect(WeekRequestSchema.safeParse({ ...week, dayStartMinute }).success).toBe(true);
  });

  it.each([15, 390, -30])('rejects a day start of %d minutes', (dayStartMinute) => {
    expect(WeekRequestSchema.safeParse({ ...week, dayStartMinute }).success).toBe(false);
  });
});

describe('TrainingProfileUpdateSchema (spec 010 AC14)', () => {
  it('needs both answers of the wizard', () => {
    expect(
      TrainingProfileUpdateSchema.safeParse({ experience: 'beginner', equipment: 'full_gym' })
        .success,
    ).toBe(true);
    expect(TrainingProfileUpdateSchema.safeParse({ experience: 'beginner' }).success).toBe(false);
  });
});
