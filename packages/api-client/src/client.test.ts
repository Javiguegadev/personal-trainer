import {
  CATALOG_FOOD_FIELDS,
  CONSENT_VERSION,
  type CustomExerciseUpsertRequest,
  type MealItemUpsertRequest,
  type PlanMealChangesRequest,
  type PlanWorkoutChangesRequest,
  type ProgramUpsertRequest,
  type CheckinUpsertRequest,
  type WeekRequest,
  type WorkoutUpsertRequest,
} from '@pt/contracts';
import { NO_BESTS } from '@pt/core';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, isApiError } from './client';
import { meBody, profileInput } from './test/fixtures';

const BASE = 'http://api.test';
const EXERCISE_ID = 'e1000000-0000-4000-8000-000000000001';
const WORKOUT_ID = '70000000-0000-4000-8000-000000000001';
const customExerciseBody: CustomExerciseUpsertRequest = {
  name: 'Remo en máquina Hammer',
  tracking: 'weight_reps',
  primaryMuscle: 'back',
  recordedAt: '2026-11-18T10:00:00.000Z',
};
const activityBody: WorkoutUpsertRequest = {
  kind: 'sport',
  activity: 'football',
  name: null,
  minutes: 60,
  inputMethod: 'activity',
  localDate: '2026-11-17',
  startedAt: '2026-11-17T19:00:00.000Z',
  sessionRpe: 7,
  recordedAt: '2026-11-18T10:00:00.000Z',
  today: '2026-11-18',
  locale: 'es',
};
const FOOD_ID = 'f1000000-0000-4000-8000-000000000001';
const ITEM_ID = '50000000-0000-4000-8000-000000000001';
const quickAdd: MealItemUpsertRequest = {
  kind: 'quick_add',
  label: 'Bollo',
  kcal: 220,
  proteinG: null,
  carbsG: null,
  fatG: null,
  inputMethod: 'quick_add',
  localDate: '2026-11-16',
  mealType: 'breakfast',
  recordedAt: '2026-11-16T08:00:00.000Z',
  today: '2026-11-16',
  locale: 'es',
};
const checkinAnswers = {
  sleepMinutes: 390,
  stress: 'normal',
  workShift: 'night',
  shiftStartMinute: 1320,
  shiftEndMinute: 360,
  recordedAt: '2026-11-11T07:00:00.000Z',
} as const;
const checkinBody: CheckinUpsertRequest = { ...checkinAnswers, today: '2026-11-11' };
const weekBody: WeekRequest = {
  workPattern: 'fixed',
  workBlocks: [{ weekday: 1, startMinute: 480, endMinute: 960 }],
  dayStartMinute: 0,
  plannedActivities: [],
  today: '2026-11-11',
};
const PROGRAM_ID = '90000000-0000-4000-8000-000000000001';
const programBody: ProgramUpsertRequest = {
  name: 'Rutina',
  origin: 'user',
  templateKey: null,
  sessions: [{ id: '91000000-0000-4000-8000-00000000000a', name: 'Rutina A', exercises: [] }],
  recordedAt: '2026-11-11T10:00:00.000Z',
  locale: 'es',
};
const planMealBody: PlanMealChangesRequest = {
  locale: 'es',
  upserts: [
    {
      kind: 'quick_add',
      id: '13000000-0000-4000-8000-000000000001',
      localDate: '2026-11-13',
      mealType: 'dinner',
      label: 'Cena fuera',
      kcal: 800,
      proteinG: null,
      carbsG: null,
      fatG: null,
      recordedAt: '2026-11-11T10:00:00.000Z',
    },
  ],
  deletes: [{ id: '13000000-0000-4000-8000-000000000002', recordedAt: '2026-11-11T10:00:00.000Z' }],
};
const planWorkoutBody: PlanWorkoutChangesRequest = {
  locale: 'es',
  upserts: [
    {
      kind: 'gym',
      id: '13000000-0000-4000-8000-000000000003',
      localDate: '2026-11-13',
      startMinute: 1110,
      name: 'Rutina A',
      minutes: 60,
      programSessionId: '91000000-0000-4000-8000-00000000000a',
      repeatWorkoutId: null,
      recordedAt: '2026-11-11T10:00:00.000Z',
    },
  ],
  deletes: [],
};
const healthBody = {
  status: 'ok',
  service: 'api',
  version: '0.0.0',
  time: '2026-01-01T00:00:00.000Z',
};

function setup(
  respond: () => Response,
  opts: { token?: string; onUnauthorized?: () => void } = {},
) {
  const fetchImpl = vi.fn(async (_url: URL, _init?: RequestInit) => respond());
  const api = createApiClient({
    baseUrl: BASE,
    getAccessToken: async () => opts.token ?? null,
    ...(opts.onUnauthorized ? { onUnauthorized: opts.onUnauthorized } : {}),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const call = (i = 0) => {
    const [url, init] = fetchImpl.mock.calls[i] ?? [];
    return { url: String(url), init: init ?? {}, headers: new Headers(init?.headers) };
  };
  return { api, fetchImpl, call };
}

describe('createApiClient', () => {
  it('parses a valid health response and sends the bearer token', async () => {
    const { api, call } = setup(() => Response.json(healthBody), { token: 'tok' });
    await expect(api.health()).resolves.toEqual(healthBody);
    expect(call().headers.get('authorization')).toBe('Bearer tok');
  });

  it('sends no authorization header without a session', async () => {
    const { api, call } = setup(() => Response.json(healthBody));
    await api.health();
    expect(call().headers.has('authorization')).toBe(false);
  });

  it('rejects responses that do not match the contract', async () => {
    const { api } = setup(() => Response.json({ status: 'down' }));
    await expect(api.health()).rejects.toThrow();
  });

  it('maps each method to its route, verb and JSON body', async () => {
    const cases = [
      { run: (a: Api) => a.me(), method: 'GET', path: '/me', res: () => Response.json(meBody) },
      {
        run: (a: Api) => a.grantConsent({ kind: 'health_data', version: CONSENT_VERSION }),
        method: 'POST',
        path: '/me/consent',
        body: { kind: 'health_data', version: CONSENT_VERSION },
        res: () => new Response(null, { status: 204 }),
      },
      {
        run: (a: Api) => a.updateProfile(profileInput),
        method: 'PUT',
        path: '/me/profile',
        body: profileInput,
        res: () => Response.json(meBody),
      },
      {
        run: (a: Api) => a.targetsPreview(profileInput),
        method: 'POST',
        path: '/onboarding/targets-preview',
        body: profileInput,
        res: () =>
          Response.json({
            targets: null,
            breakdown: null,
            safety: {
              status: 'ok',
              requestedGoal: 'maintain',
              appliedGoal: 'maintain',
              flags: ['pregnancy'],
              maxSurplusRatio: null,
              targetsAllowed: false,
            },
          }),
      },
      {
        run: (a: Api) => a.exportData(),
        method: 'GET',
        path: '/me/export',
        res: () =>
          Response.json({
            exportedAt: '2026-11-11T10:00:00.000Z',
            userId: meBody.userId,
            email: 'a@b.c',
            profile: null,
            dietaryPrefs: null,
            targets: [],
            weights: [],
            mealItems: [],
            favouriteFoods: [],
            customFoods: [],
            workouts: [],
            customExercises: [],
            programs: [],
            checkins: [],
            plan: { mealItems: [], workouts: [] },
            consents: [],
            aiUsage: [],
          }),
      },
      {
        run: (a: Api) => a.listWeights({ from: '2026-11-01', to: '2026-11-11' }),
        method: 'GET',
        path: '/me/weights?from=2026-11-01&to=2026-11-11',
        res: () => Response.json({ entries: [] }),
      },
      {
        run: (a: Api) =>
          a.saveWeight('2026-11-11', {
            weightKg: 70,
            recordedAt: '2026-11-11T10:00:00.000Z',
            today: '2026-11-11',
          }),
        method: 'PUT',
        path: '/me/weights/2026-11-11',
        body: { weightKg: 70, recordedAt: '2026-11-11T10:00:00.000Z', today: '2026-11-11' },
        res: () =>
          Response.json({
            entry: {
              localDate: '2026-11-11',
              weightKg: 70,
              recordedAt: '2026-11-11T10:00:00.000Z',
            },
            targetsChange: null,
          }),
      },
      {
        run: (a: Api) => a.deleteWeight('2026-11-11', { today: '2026-11-11' }),
        method: 'DELETE',
        path: '/me/weights/2026-11-11?today=2026-11-11',
        res: () => Response.json({ entry: null, targetsChange: null }),
      },
      {
        run: (a: Api) => a.listCheckins({ from: '2026-08-17', to: '2026-11-11' }),
        method: 'GET',
        path: '/me/checkins?from=2026-08-17&to=2026-11-11',
        res: () => Response.json({ checkins: [] }),
      },
      {
        run: (a: Api) => a.saveCheckin('2026-11-11', checkinBody),
        method: 'PUT',
        path: '/me/checkins/2026-11-11',
        body: checkinBody,
        res: () =>
          Response.json({
            checkin: { localDate: '2026-11-11', ...checkinAnswers, source: 'manual' },
          }),
      },
      {
        run: (a: Api) =>
          a.deleteCheckin('2026-11-11', {
            recordedAt: '2026-11-11T10:00:00.000+01:00',
            today: '2026-11-11',
          }),
        method: 'DELETE',
        path: '/me/checkins/2026-11-11?recordedAt=2026-11-11T10%3A00%3A00.000%2B01%3A00&today=2026-11-11',
        res: () => Response.json({ checkin: null }),
      },
      {
        run: (a: Api) => a.saveWeek(weekBody),
        method: 'PUT',
        path: '/me/week',
        body: weekBody,
        res: () => Response.json(meBody),
      },
      {
        run: (a: Api) => a.saveTrainingProfile({ experience: 'beginner', equipment: 'full_gym' }),
        method: 'PUT',
        path: '/me/training-profile',
        body: { experience: 'beginner', equipment: 'full_gym' },
        res: () => Response.json(meBody),
      },
      {
        run: (a: Api) => a.program(),
        method: 'GET',
        path: '/me/program',
        res: () => Response.json({ program: null }),
      },
      {
        run: (a: Api) => a.saveProgram(PROGRAM_ID, programBody),
        method: 'PUT',
        path: `/me/program/${PROGRAM_ID}`,
        body: programBody,
        res: () => Response.json({ program: null }),
      },
      {
        run: (a: Api) => a.deleteProgram(PROGRAM_ID, { recordedAt: '2026-11-11T10:00:00.000Z' }),
        method: 'DELETE',
        path: `/me/program/${PROGRAM_ID}?recordedAt=2026-11-11T10%3A00%3A00.000Z`,
        res: () => Response.json({ program: null }),
      },
      {
        run: (a: Api) => a.searchFoods('pan con tomate', 'es'),
        method: 'GET',
        path: '/foods/search?q=pan%20con%20tomate&locale=es',
        res: () => Response.json({ foods: [] }),
      },
      {
        run: (a: Api) => a.getFood(FOOD_ID, 'en'),
        method: 'GET',
        path: `/foods/${FOOD_ID}?locale=en`,
        res: () =>
          Response.json({
            id: FOOD_ID,
            key: 'd-huevo',
            name: 'Egg',
            per100g: { kcal: 140, proteinG: 12.6, carbsG: 0.3, fatG: 9.8, fiberG: 0 },
            servings: [],
            source: 'ciqual-2025',
            ...CATALOG_FOOD_FIELDS,
          }),
      },
      {
        run: (a: Api) => a.foodSources('es'),
        method: 'GET',
        path: '/foods/sources?locale=es',
        res: () => Response.json({ sources: [] }),
      },
      {
        run: (a: Api) => a.listFoodLog({ from: '2026-11-09', to: '2026-11-16' }),
        method: 'GET',
        path: '/me/food-log?from=2026-11-09&to=2026-11-16',
        res: () => Response.json({ items: [] }),
      },
      {
        run: (a: Api) => a.saveMealItem(ITEM_ID, quickAdd),
        method: 'PUT',
        path: `/me/food-log/items/${ITEM_ID}`,
        body: quickAdd,
        res: () => Response.json({ item: null }),
      },
      {
        run: (a: Api) => a.deleteMealItem(ITEM_ID, { recordedAt: '2026-11-16T08:00:00.000+01:00' }),
        method: 'DELETE',
        path: `/me/food-log/items/${ITEM_ID}?recordedAt=2026-11-16T08%3A00%3A00.000%2B01%3A00`,
        res: () => Response.json({ item: null }),
      },
      {
        run: (a: Api) => a.recentFoods('es'),
        method: 'GET',
        path: '/me/foods/recent?locale=es',
        res: () => Response.json({ recents: [] }),
      },
      {
        run: (a: Api) => a.favouriteFoods('es'),
        method: 'GET',
        path: '/me/foods/favourites?locale=es',
        res: () => Response.json({ foods: [] }),
      },
      {
        run: (a: Api) => a.setFavouriteFood(FOOD_ID, true),
        method: 'PUT',
        path: `/me/foods/favourites/${FOOD_ID}`,
        res: () => new Response(null, { status: 204 }),
      },
      {
        run: (a: Api) => a.setFavouriteFood(FOOD_ID, false),
        method: 'DELETE',
        path: `/me/foods/favourites/${FOOD_ID}`,
        res: () => new Response(null, { status: 204 }),
      },
      {
        run: (a: Api) => a.deleteAccount(),
        method: 'DELETE',
        path: '/me',
        res: () => new Response(null, { status: 204 }),
      },
      // Spec 009: exercise catalog, custom exercises, workouts and stats.
      {
        run: (a: Api) => a.exerciseCatalog(),
        method: 'GET',
        path: '/exercises',
        res: () => Response.json({ version: 'v1', exercises: [] }),
      },
      {
        run: (a: Api) => a.saveCustomExercise(EXERCISE_ID, customExerciseBody),
        method: 'PUT',
        path: `/me/exercises/${EXERCISE_ID}`,
        body: customExerciseBody,
        res: () => Response.json({ exercise: null }),
      },
      {
        run: (a: Api) =>
          a.deleteCustomExercise(EXERCISE_ID, { recordedAt: '2026-11-18T10:00:00.000+01:00' }),
        method: 'DELETE',
        path: `/me/exercises/${EXERCISE_ID}?recordedAt=2026-11-18T10%3A00%3A00.000%2B01%3A00`,
        res: () => Response.json({ exercise: null }),
      },
      {
        run: (a: Api) => a.listWorkouts({ from: '2026-09-20', to: '2026-11-18' }),
        method: 'GET',
        path: '/me/workouts?from=2026-09-20&to=2026-11-18',
        res: () => Response.json({ workouts: [] }),
      },
      {
        run: (a: Api) => a.saveWorkout(WORKOUT_ID, activityBody),
        method: 'PUT',
        path: `/me/workouts/${WORKOUT_ID}`,
        body: activityBody,
        res: () => Response.json({ workout: null }),
      },
      {
        run: (a: Api) => a.deleteWorkout(WORKOUT_ID, { recordedAt: '2026-11-18T10:00:00.000Z' }),
        method: 'DELETE',
        path: `/me/workouts/${WORKOUT_ID}?recordedAt=2026-11-18T10%3A00%3A00.000Z`,
        res: () => Response.json({ workout: null }),
      },
      {
        run: (a: Api) => a.exerciseStats(),
        method: 'GET',
        path: '/me/exercises/stats',
        res: () => Response.json({ stats: [] }),
      },
      {
        run: (a: Api) => a.exerciseHistory(EXERCISE_ID, 20),
        method: 'GET',
        path: `/me/exercises/${EXERCISE_ID}/history?limit=20`,
        res: () => Response.json({ exerciseId: EXERCISE_ID, sessions: [], bests: NO_BESTS }),
      },
      {
        run: (a: Api) => a.exerciseHistory(EXERCISE_ID),
        method: 'GET',
        path: `/me/exercises/${EXERCISE_ID}/history`,
        res: () => Response.json({ exerciseId: EXERCISE_ID, sessions: [], bests: NO_BESTS }),
      },
      {
        run: (a: Api) => a.getPlan({ from: '2026-10-15', to: '2026-12-06' }),
        method: 'GET',
        path: '/me/plan?from=2026-10-15&to=2026-12-06',
        res: () => Response.json({ mealItems: [], workouts: [] }),
      },
      {
        run: (a: Api) => a.savePlanMealChanges(planMealBody),
        method: 'POST',
        path: '/me/plan/meal-items',
        body: planMealBody,
        res: () => Response.json({ mealItems: [] }),
      },
      {
        run: (a: Api) => a.savePlanWorkoutChanges(planWorkoutBody),
        method: 'POST',
        path: '/me/plan/workouts',
        body: planWorkoutBody,
        res: () => Response.json({ workouts: [] }),
      },
    ];

    for (const c of cases) {
      const { api, call } = setup(c.res);
      await expect(c.run(api)).resolves.not.toThrow();
      const { url, init, headers } = call();
      expect(url, c.path).toBe(`${BASE}${c.path}`);
      expect(init.method ?? 'GET', c.path).toBe(c.method);
      if ('body' in c) {
        expect(JSON.parse(String(init.body)), c.path).toEqual(c.body);
        expect(headers.get('content-type')).toBe('application/json');
      } else {
        expect(init.body, c.path).toBeUndefined();
      }
    }
  });
});

type Api = ReturnType<typeof createApiClient>;

describe('ApiError', () => {
  it('carries the code and field errors of the API error body (AC22)', async () => {
    const { api } = setup(() =>
      Response.json(
        { code: 'validation_error', message: 'Invalid request', fields: { heightCm: 'too_big' } },
        { status: 400 },
      ),
    );
    const error = await api.updateProfile(profileInput).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'validation_error',
      fields: { heightCm: 'too_big' },
    });
  });

  it.each([
    [403, 'consent_required'],
    [422, 'age_blocked'],
    [429, 'rate_limited'],
    [503, 'ai_unavailable'],
  ] as const)('exposes %i %s so the UI can react (AC7, AC12, AC17)', async (status, code) => {
    const { api } = setup(() => Response.json({ code, message: 'x' }, { status }));
    const error = await api.me().catch((e: unknown) => e);
    expect(isApiError(error, code)).toBe(true);
    expect(isApiError(error, 'not_found')).toBe(false);
  });

  it('falls back to a status-based code when the body is not an API error', async () => {
    const { api } = setup(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api.me()).rejects.toMatchObject({
      status: 502,
      code: 'internal_error',
      fields: {},
    });

    const { api: api429 } = setup(() => new Response('slow down', { status: 429 }));
    await expect(api429.me()).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('calls onUnauthorized on 401 only (AC4, AC5)', async () => {
    const onUnauthorized = vi.fn();
    const { api } = setup(
      () => Response.json({ code: 'unauthorized', message: 'x' }, { status: 401 }),
      { onUnauthorized },
    );
    await expect(api.me()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledOnce();

    const other = vi.fn();
    const { api: api403 } = setup(
      () => Response.json({ code: 'consent_required', message: 'x' }, { status: 403 }),
      { onUnauthorized: other },
    );
    await expect(api403.me()).rejects.toBeInstanceOf(ApiError);
    expect(other).not.toHaveBeenCalled();
  });
});
