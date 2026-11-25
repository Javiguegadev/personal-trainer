import {
  CONSENT_VERSION,
  PLAN_LIMITS,
  type Food,
  type MealItemSaveResponse,
  type PlanMealChangesResponse,
  type PlannedMealItem,
  type PlanResponse,
  type PlanWorkoutChangesResponse,
  type WorkoutSaveResponse,
} from '@pt/contracts';
import {
  EMPTY_PLAN_CHANGES,
  addDays,
  logPlannedItems,
  plannedMealItemFromUpsert,
  plannedSessionFor,
  stampChanges,
  type PlanChanges,
} from '@pt/core';
import {
  MutationObserver,
  QueryClient,
  dehydrate,
  hydrate,
  onlineManager,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isApiError } from './client';
import { foodKeys, registerFoodMutations, type SaveMealItemVariables } from './foods';
import { createMockApiClient } from './mock/backend';
import { MOCK_CATALOG, toMockFood } from './mock/foods';
import { mockAccessToken, mockUserFromEmail } from './mock/identity';
import {
  planKeys,
  planQueryOptions,
  planWriteVariables,
  registerPlanMutations,
  withPlanRows,
  type SavePlanMealsVariables,
  type SavePlanWorkoutsVariables,
} from './plan';
import {
  registerTrainingMutations,
  saveWorkoutVariables,
  trainingKeys,
  type SaveWorkoutVariables,
} from './training';

// Wednesday 25 November 2026: the horizon ends on Sunday 20 December.
const NOW = new Date('2026-11-25T10:00:00.000Z');
const TODAY = '2026-11-25';
const THURSDAY = '2026-11-26';
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const id = (n: number) => `13000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const egg: Food = toMockFood(
  MOCK_CATALOG.find((f) => f.key === 'd-huevo')!,
  'es',
);

function plannedEggs(n: number, localDate = THURSDAY, recordedAt = at(60)): PlannedMealItem {
  const row = plannedMealItemFromUpsert(
    {
      kind: 'food',
      id: id(n),
      foodId: egg.id,
      portion: { kind: 'serving', servingId: egg.servings[0]!.id, servings: 2 },
      localDate,
      mealType: 'dinner',
      recordedAt,
    },
    egg,
  );
  if ('error' in row) throw new Error(row.error);
  return row;
}

function plannedSnack(n: number, localDate: string): PlannedMealItem {
  const row = plannedMealItemFromUpsert(
    {
      kind: 'quick_add',
      id: id(n),
      label: 'Fruta',
      kcal: 80,
      proteinG: null,
      carbsG: 20,
      fatG: null,
      localDate,
      mealType: 'afternoon_snack',
      recordedAt: at(60),
    },
    null,
  );
  if ('error' in row) throw new Error(row.error);
  return row;
}

const plannedRun = (n: number, localDate = THURSDAY, recordedAt = at(60)) =>
  plannedSessionFor(
    {
      type: 'activity',
      choice: { kind: 'cardio', activity: 'running', name: null },
      minutes: 30,
      isMatch: false,
    },
    { id: id(n), localDate, startMinute: 420, recordedAt },
  );

const meals = (upserts: PlannedMealItem[], deletes: PlanChanges['mealItems']['deletes'] = []) => ({
  ...EMPTY_PLAN_CHANGES,
  mealItems: { upserts, deletes },
});

async function setup() {
  let token = mockAccessToken(mockUserFromEmail('ana@example.com'));
  const api = createMockApiClient({ getAccessToken: async () => token, now: () => NOW });
  await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
  /** Acts as another user of the same backend. */
  const asOther = async () => {
    const mine = token;
    token = mockAccessToken(mockUserFromEmail('bea@example.com'));
    await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    return () => {
      token = mine;
    };
  };
  return { api, asOther, ...client(api) };
}

function client(api: ReturnType<typeof createMockApiClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  registerFoodMutations(queryClient, api);
  registerTrainingMutations(queryClient, api);
  registerPlanMutations(queryClient, api);
  const observe =
    <V, R>(key: readonly string[]) =>
    (variables: V) =>
      new MutationObserver<R, unknown, V>(queryClient, { mutationKey: key }).mutate(variables);
  const saveMeals = observe<SavePlanMealsVariables, PlanMealChangesResponse>(planKeys.saveMeals);
  const saveWorkouts = observe<SavePlanWorkoutsVariables, PlanWorkoutChangesResponse>(
    planKeys.saveWorkouts,
  );
  return {
    queryClient,
    /** What `useSavePlanChanges` does. */
    save: (changes: PlanChanges) => {
      const writes = planWriteVariables(changes, 'es');
      return Promise.all([
        ...writes.mealItems.map(saveMeals),
        ...writes.workouts.map(saveWorkouts),
      ]);
    },
    saveItem: observe<SaveMealItemVariables, MealItemSaveResponse>(foodKeys.saveItem),
    saveWorkout: observe<SaveWorkoutVariables, WorkoutSaveResponse>(trainingKeys.saveWorkout),
    cached: () => queryClient.getQueryData<PlanResponse>(planKeys.plan),
    load: () => queryClient.fetchQuery(planQueryOptions(api, TODAY)),
  };
}

const stored = async (api: ReturnType<typeof createMockApiClient>) =>
  api.getPlan({ from: addDays(TODAY, -1), to: '2026-12-20' });

/** Lets the optimistic update (which awaits a cancel) reach the cache. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => onlineManager.setOnline(true));

describe('withPlanRows', () => {
  it('puts rows in the API order and removes the ones of the ids', () => {
    const plan = { mealItems: [plannedEggs(1, '2026-11-28')], workouts: [plannedRun(2)] };
    const next = withPlanRows(plan, 'mealItems', new Set([id(3)]), [plannedEggs(3)]);
    expect(next.mealItems.map((i) => i.id)).toEqual([id(3), id(1)]);
    const untimed = { ...plannedRun(4), startMinute: null };
    const sessions = withPlanRows(plan, 'workouts', new Set([id(2), id(4)]), [untimed]);
    expect(sessions.workouts.map((w) => w.id)).toEqual([id(4)]);
    expect(withPlanRows(plan, 'workouts', new Set(), [untimed]).workouts.map((w) => w.id)).toEqual([
      id(2),
      id(4),
    ]);
  });
});

describe('plan query (spec 013 AC22)', () => {
  it('loads the plan from 27 days back to the end of the horizon', async () => {
    const { api, load } = await setup();
    const spy = vi.spyOn(api, 'getPlan');
    await load();
    expect(spy).toHaveBeenCalledWith({ from: '2026-10-29', to: '2026-12-20' });
  });
});

describe('plan mutations (AC5, AC6, AC20, AC22, AC23)', () => {
  it('shows the planned rows at once, then the stored ones', async () => {
    const { api, save, cached, load } = await setup();
    await load();
    const pending = save({
      mealItems: { upserts: [plannedEggs(1)], deletes: [] },
      workouts: { upserts: [plannedRun(2)], deletes: [] },
    });
    await tick();
    expect(cached()).toEqual({ mealItems: [plannedEggs(1)], workouts: [plannedRun(2)] });
    await pending;
    expect(cached()).toEqual(await stored(api));
    expect((await stored(api)).mealItems).toEqual([plannedEggs(1)]);
  });

  it('removes at once, and an undo stamped later brings the rows back (AC20)', async () => {
    const { api, save, cached, load } = await setup();
    await save(meals([plannedEggs(1)]));
    await load();
    const removal = meals([], [{ id: id(1), recordedAt: at(120) }]);
    const pending = save(removal);
    await tick();
    expect(cached()?.mealItems).toEqual([]);
    await pending;
    expect((await stored(api)).mealItems).toEqual([]);

    await save(stampChanges(meals([plannedEggs(1)]), at(125)));
    expect((await stored(api)).mealItems.map((i) => i.id)).toEqual([id(1)]);
    expect(cached()?.mealItems.map((i) => i.id)).toEqual([id(1)]);
  });

  it('shows the newer row when a later write from another device won (AC23)', async () => {
    const { save, cached, load } = await setup();
    await save(meals([plannedEggs(1, THURSDAY, at(120))]));
    await load();
    await save(meals([plannedEggs(1, '2026-11-28', at(60))]));
    expect(cached()?.mealItems.map((i) => i.localDate)).toEqual([THURSDAY]);
  });

  it('cuts a big change into writes of at most 300 changes, all stored', async () => {
    const { api, save, queryClient, load } = await setup();
    await load();
    const rows = Array.from({ length: PLAN_LIMITS.changesMax + 1 }, (_, i) =>
      plannedSnack(1000 + i, addDays(THURSDAY, i % 3)),
    );
    expect(planWriteVariables(meals(rows), 'es').mealItems).toHaveLength(2);
    await save(meals(rows));
    expect((await stored(api)).mealItems).toHaveLength(rows.length);
    expect(queryClient.isMutating()).toBe(0);
  });

  it('undoes a write the API rejects, puts back the edited row and says why', async () => {
    const { api, save, cached, load, queryClient } = await setup();
    await save(meals([plannedEggs(1)]));
    await load();
    // Beyond today + 28 days (server UTC): the whole write is refused.
    const far = addDays(TODAY, 40);
    await expect(
      save(meals([plannedEggs(1, far, at(120)), plannedEggs(2, far)])),
    ).rejects.toSatisfy((error: unknown) => isApiError(error, 'validation_error'));
    expect(cached()?.mealItems).toEqual([plannedEggs(1)]);
    expect(queryClient.getQueryData(planKeys.rejected)).toEqual({
      kind: 'meals',
      code: 'validation_error',
      fields: { 'upserts.0.localDate': 'too_far' },
    });
    expect((await stored(api)).mealItems).toEqual([plannedEggs(1)]);
  });

  it('queues plan and logs offline, in order, and sends them once after a restart', async () => {
    const { api, queryClient, save, saveItem, saveWorkout, cached, load } = await setup();
    await load();
    onlineManager.setOnline(false);

    // Plan today's dinner and run, then log both from the plan, all without a connection.
    const dinner = plannedEggs(1, TODAY);
    const run = plannedRun(2, TODAY);
    void save({
      mealItems: { upserts: [dinner], deletes: [] },
      workouts: { upserts: [run], deletes: [] },
    });
    const [logged] = logPlannedItems([dinner], {
      recordedAt: at(120),
      today: TODAY,
      locale: 'es',
      newId: () => id(50),
    });
    void saveItem(logged!);
    void saveWorkout(
      saveWorkoutVariables(
        id(60),
        {
          kind: 'cardio',
          activity: 'running',
          name: null,
          minutes: 32,
          inputMethod: 'activity',
          localDate: TODAY,
          startedAt: '2026-11-25T07:00:00.000Z',
          sessionRpe: null,
          recordedAt: at(120),
          today: TODAY,
          locale: 'es',
          plannedWorkoutId: run.id,
        },
        [],
      ),
    );
    await tick();
    expect(cached()).toEqual({ mealItems: [dinner], workouts: [run] });
    expect(queryClient.isMutating()).toBe(4);
    expect((await stored(api)).mealItems).toEqual([]);

    // The app is closed: only the dehydrated state survives.
    const saved = JSON.parse(JSON.stringify(dehydrate(queryClient))) as ReturnType<
      typeof dehydrate
    >;
    expect(saved.mutations).toHaveLength(4);
    const restarted = client(api);
    hydrate(restarted.queryClient, saved);
    expect(restarted.cached()).toEqual({ mealItems: [dinner], workouts: [run] });

    onlineManager.setOnline(true);
    await restarted.queryClient.resumePausedMutations();
    expect(restarted.queryClient.isMutating()).toBe(0);
    // The plan reached the API first: the logs keep their link (an unknown one would be dropped).
    const { items } = await api.listFoodLog({ from: TODAY, to: TODAY });
    expect(items.map((i) => [i.id, i.plannedItemId, i.inputMethod])).toEqual([
      [id(50), dinner.id, 'plan'],
    ]);
    const { workouts } = await api.listWorkouts({ from: TODAY, to: TODAY });
    expect(workouts.map((w) => w.plannedWorkoutId)).toEqual([run.id]);
  });
});

describe('mock backend: the plan (AC22–AC25)', () => {
  it('needs the current consent', async () => {
    const api = createMockApiClient({
      getAccessToken: async () => mockAccessToken(mockUserFromEmail('eva@example.com')),
      now: () => NOW,
    });
    const error = await api.getPlan({ from: TODAY, to: TODAY }).catch((e: unknown) => e);
    expect(isApiError(error, 'consent_required')).toBe(true);
  });

  it('refuses a fifth session on a day and another user’s ids, links and rows', async () => {
    const { api, save, asOther } = await setup();
    const back = await asOther();
    await save(meals([plannedEggs(1)]));
    await save({ ...EMPTY_PLAN_CHANGES, workouts: { upserts: [plannedRun(2)], deletes: [] } });
    back();

    // 409 for an id of another user; 404 for a log pointing at their planned row.
    const taken = await save(meals([plannedEggs(1)])).catch((e: unknown) => e);
    expect(isApiError(taken, 'id_taken')).toBe(true);
    const [log] = logPlannedItems([plannedEggs(1, TODAY)], {
      recordedAt: at(120),
      today: TODAY,
      locale: 'es',
      newId: () => id(50),
    });
    const linked = await api.saveMealItem(log!.id, log!.request).catch((e: unknown) => e);
    expect(isApiError(linked, 'not_found') && linked.fields).toEqual({
      plannedItemId: 'not_found',
    });
    // An unknown planned item: the item is stored without the link.
    const [unknown] = logPlannedItems([plannedEggs(9, TODAY)], {
      recordedAt: at(120),
      today: TODAY,
      locale: 'es',
      newId: () => id(51),
    });
    expect((await api.saveMealItem(unknown!.id, unknown!.request)).item?.plannedItemId).toBeNull();

    const four = [10, 11, 12, 13].map((n) => plannedRun(n));
    await api.savePlanWorkoutChanges({
      upserts: four.map((r) => ({ ...r, kind: 'cardio' as const, minutes: 30, isMatch: false })),
    });
    const fifth = await api
      .savePlanWorkoutChanges({
        upserts: [{ ...plannedRun(14), kind: 'cardio', minutes: 30, isMatch: false }],
      })
      .catch((e: unknown) => e);
    expect(isApiError(fifth) && fifth.fields).toEqual({
      'upserts.0.localDate': 'too_many_sessions',
    });
  });

  it('exports the plan, deleted rows included with their date', async () => {
    const { api, save } = await setup();
    await save(meals([plannedEggs(1), plannedEggs(2)]));
    await save(meals([], [{ id: id(2), recordedAt: at(120) }]));
    const { plan } = await api.exportData();
    expect(plan.mealItems.map((i) => [i.id, i.deletedAt !== null])).toEqual([
      [id(1), false],
      [id(2), true],
    ]);
  });
});
