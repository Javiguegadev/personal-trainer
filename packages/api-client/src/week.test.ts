import {
  CONSENT_VERSION,
  type Food,
  type MeResponse,
  type PlannedActivity,
  type WeekRequest,
} from '@pt/contracts';
import { addDays } from '@pt/core';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  foodKeys,
  registerFoodMutations,
  saveItemVariables,
  type DeleteMealItemVariables,
  type SaveMealItemVariables,
} from './foods';
import { createMockApiClient } from './mock/backend';
import { MOCK_EXERCISES } from './mock/exercises';
import { MOCK_CATALOG, toMockFood } from './mock/foods';
import { mockAccessToken, mockUserFromEmail } from './mock/identity';
import { profileInput } from './test/fixtures';
import {
  registerTrainingMutations,
  saveWorkoutVariables,
  trainingKeys,
  type DeleteWorkoutVariables,
  type SaveWorkoutVariables,
} from './training';
import {
  weekKeys,
  weekLogQueryOptions,
  weekTargetsChange,
  withWeekMealItem,
  type WeekLog,
} from './week';

// Friday 20 November 2026: its week starts on Monday the 16th.
const NOW = new Date('2026-11-20T10:00:00.000Z');
const TODAY = '2026-11-20';
const MONDAY = '2026-11-16';
const TEN_DAYS_AGO = addDays(TODAY, -10); // Tuesday of the week before
const LAST_MONDAY = '2026-11-09';
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const itemId = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const workoutId = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const egg: Food = toMockFood(
  MOCK_CATALOG.find((f) => f.key === 'd-huevo')!,
  'es',
);
const bench = MOCK_EXERCISES.find((e) => e.key === 'press-banca')!;

const eggs = (id: string, localDate: string, recordedAt = at(60)) =>
  saveItemVariables(
    id,
    {
      kind: 'food',
      foodId: egg.id,
      portion: { kind: 'serving', servingId: egg.servings[0]!.id, servings: 2 },
      inputMethod: 'search',
      localDate,
      mealType: 'breakfast',
      recordedAt,
      today: TODAY,
      locale: 'es',
    },
    egg,
  );

const football = (id: string, localDate: string) =>
  saveWorkoutVariables(
    id,
    {
      kind: 'sport',
      activity: 'football',
      name: null,
      minutes: 90,
      inputMethod: 'activity',
      localDate,
      startedAt: `${localDate}T18:00:00.000Z`,
      sessionRpe: null,
      recordedAt: at(60),
      today: TODAY,
      locale: 'es',
    },
    MOCK_EXERCISES,
  );

async function setup() {
  const token = mockAccessToken(mockUserFromEmail('ana@example.com'));
  const api = createMockApiClient({ getAccessToken: async () => token, now: () => NOW });
  await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  registerFoodMutations(queryClient, api);
  registerTrainingMutations(queryClient, api);
  const observe =
    <V>(key: readonly string[]) =>
    (variables: V) =>
      new MutationObserver<unknown, unknown, V>(queryClient, { mutationKey: key }).mutate(
        variables,
      );
  return {
    api,
    queryClient,
    saveItem: observe<SaveMealItemVariables>(foodKeys.saveItem),
    deleteItem: observe<DeleteMealItemVariables>(foodKeys.deleteItem),
    saveWorkout: observe<SaveWorkoutVariables>(trainingKeys.saveWorkout),
    deleteWorkout: observe<DeleteWorkoutVariables>(trainingKeys.deleteWorkout),
    week: (monday: string) => queryClient.getQueryData<WeekLog>(weekKeys.week(monday)),
    loadWeek: (monday: string) => queryClient.fetchQuery(weekLogQueryOptions(api, monday)),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('withWeekMealItem', () => {
  it('adds an item only to the week of its day, and removes it from any week', () => {
    const item = eggs(itemId(1), TODAY).preview;
    const empty: WeekLog = { mealItems: [], workouts: [] };
    expect(withWeekMealItem(empty, MONDAY, item.id, item).mealItems).toEqual([item]);
    expect(withWeekMealItem(empty, LAST_MONDAY, item.id, item).mealItems).toEqual([]);
    // Moved to another week: it leaves this one.
    const moved = { ...item, localDate: TEN_DAYS_AGO };
    expect(withWeekMealItem({ ...empty, mealItems: [item] }, MONDAY, item.id, moved)).toEqual(
      empty,
    );
  });
});

describe('week log (spec 010 AC8, AC10–AC12)', () => {
  it('loads the meals and workouts of one week, Monday to Sunday', async () => {
    const { api, loadWeek } = await setup();
    await api.saveMealItem(itemId(1), eggs(itemId(1), MONDAY).request);
    await api.saveMealItem(itemId(2), eggs(itemId(2), addDays(MONDAY, -1)).request);
    await api.saveWorkout(workoutId(1), football(workoutId(1), TODAY).request);
    const log = await loadWeek(MONDAY);
    expect(log.mealItems.map((i) => i.id)).toEqual([itemId(1)]);
    expect(log.workouts.map((w) => w.id)).toEqual([workoutId(1)]);
  });

  it('a meal added on a day of an older week shows in that cached week at once (AC12)', async () => {
    const { api, saveItem, week, loadWeek } = await setup();
    await Promise.all([loadWeek(MONDAY), loadWeek(LAST_MONDAY)]);
    const pending = saveItem(eggs(itemId(1), TEN_DAYS_AGO));
    await tick();
    expect(week(LAST_MONDAY)?.mealItems.map((i) => i.id)).toEqual([itemId(1)]);
    expect(week(MONDAY)?.mealItems).toEqual([]);
    await pending;
    const stored = await api.listFoodLog({ from: LAST_MONDAY, to: addDays(LAST_MONDAY, 6) });
    expect(stored.items.map((i) => i.localDate)).toEqual([TEN_DAYS_AGO]);
  });

  it('undoes an edit of an old meal the API rejects, back to the cached version', async () => {
    const { api, saveItem, week, loadWeek } = await setup();
    await api.saveMealItem(itemId(1), eggs(itemId(1), TEN_DAYS_AGO).request);
    await loadWeek(LAST_MONDAY);
    const original = week(LAST_MONDAY)!.mealItems[0]!;
    // Moved into the future: refused, and the week shows the meal as it was.
    const refused = eggs(itemId(1), addDays(TODAY, 1), at(120));
    await expect(saveItem(refused)).rejects.toMatchObject({ status: 400 });
    expect(week(LAST_MONDAY)?.mealItems).toEqual([original]);
  });

  it('a workout deleted from a day screen leaves its cached week (AC11)', async () => {
    const { api, deleteWorkout, week, loadWeek } = await setup();
    await api.saveWorkout(workoutId(1), football(workoutId(1), TEN_DAYS_AGO).request);
    await loadWeek(LAST_MONDAY);
    expect(week(LAST_MONDAY)?.workouts).toHaveLength(1);
    const pending = deleteWorkout({ id: workoutId(1), recordedAt: at(120) });
    await tick();
    expect(week(LAST_MONDAY)?.workouts).toEqual([]);
    await pending;
  });

  it('a new gym workout of today shows in the current week', async () => {
    const { saveWorkout, week, loadWeek } = await setup();
    await loadWeek(MONDAY);
    const variables = saveWorkoutVariables(
      workoutId(2),
      {
        kind: 'gym',
        name: null,
        minutes: 45,
        exercises: [
          {
            exerciseId: bench.id,
            sets: [{ reps: 8, weightKg: 50, durationS: null, distanceM: null, restS: 90 }],
          },
        ],
        inputMethod: 'live',
        programSessionId: null,
        localDate: TODAY,
        startedAt: at(-3600),
        sessionRpe: null,
        recordedAt: at(60),
        today: TODAY,
        locale: 'es',
      },
      MOCK_EXERCISES,
    );
    const pending = saveWorkout(variables);
    await tick();
    expect(week(MONDAY)?.workouts.map((w) => w.id)).toEqual([workoutId(2)]);
    await pending;
  });
});

describe('PUT /me/week in the mock and the targets notice (spec 010 AC4)', () => {
  const gym = (over: Partial<PlannedActivity> = {}): PlannedActivity => ({
    kind: 'strength',
    label: null,
    sessionsPerWeek: 3,
    minutesPerSession: 60,
    intensity: 'moderate',
    days: [],
    ...over,
  });
  const days = (weekdays: number[]) =>
    weekdays.map((weekday) => ({ weekday, startMinute: 1110, isMatch: false }));
  const week = (activities: PlannedActivity[]): WeekRequest => ({
    workPattern: 'fixed',
    workBlocks: [{ weekday: 1, startMinute: 480, endMinute: 960 }],
    dayStartMinute: 0,
    plannedActivities: activities,
    today: TODAY,
  });

  async function withProfile() {
    const { api } = await setup();
    const before = await api.updateProfile({
      ...profileInput,
      plannedActivities: [gym()],
      today: TODAY,
    });
    return { api, before };
  }

  it('stores the week and leaves the targets when the load is the same', async () => {
    const { api, before } = await withProfile();
    const me = await api.saveWeek(week([gym({ days: days([1, 3, 5]) })]));
    expect(me.profile?.week.workBlocks).toHaveLength(1);
    expect(me.profile?.plannedActivities[0]?.days).toEqual(days([1, 3, 5]));
    expect(weekTargetsChange({ me, previousTargets: before.targets })).toBeNull();
  });

  it('recomputes the targets when the number of days changes, and the notice shows both', async () => {
    const { api, before } = await withProfile();
    const me = await api.saveWeek(week([gym({ sessionsPerWeek: 5, days: days([1, 2, 3, 4, 5]) })]));
    const change = weekTargetsChange({ me, previousTargets: before.targets });
    expect(change?.previous?.kcal).toBe(before.targets?.kcal);
    expect(change?.current?.kcal).toBeGreaterThan(before.targets!.kcal);
  });

  it('refuses a week without a profile, and blocks with other patterns', async () => {
    const { api } = await setup();
    await expect(api.saveWeek(week([]))).rejects.toMatchObject({
      status: 400,
      fields: { profile: 'required' },
    });
    const { api: withOne } = await withProfile();
    await expect(withOne.saveWeek({ ...week([]), workPattern: 'shifts' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('keeps the week when the profile form is saved again', async () => {
    const { api } = await withProfile();
    await api.saveWeek({ ...week([gym()]), dayStartMinute: 120 });
    const me: MeResponse = await api.updateProfile({
      ...profileInput,
      plannedActivities: [gym()],
      heightCm: 166,
      today: TODAY,
    });
    expect(me.profile?.week.dayStartMinute).toBe(120);
  });
});
