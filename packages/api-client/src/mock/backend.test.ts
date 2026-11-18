import { CONSENT_VERSION, type ProfileInput } from '@pt/contracts';
import { describe, expect, it, vi } from 'vitest';
import { isApiError } from '../client';
import { profileInput } from '../test/fixtures';
import { createMockApiClient, MOCK_DB_KEY, type KeyValueStorage } from './backend';
import { MOCK_EXERCISES } from './exercises';
import { MOCK_CATALOG } from './foods';
import { mockAccessToken, mockUserFromEmail } from './identity';

const NOW = new Date('2026-11-11T10:00:00.000Z');
const user = mockUserFromEmail('ana@example.com');

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function setup(opts: { token?: string | null; storage?: KeyValueStorage; now?: () => Date } = {}) {
  const onUnauthorized = vi.fn();
  const token = opts.token === undefined ? mockAccessToken(user) : opts.token;
  const api = createMockApiClient({
    getAccessToken: async () => token,
    onUnauthorized,
    now: opts.now ?? (() => NOW),
    ...(opts.storage ? { storage: opts.storage } : {}),
  });
  return { api, onUnauthorized };
}

const input = (overrides: Partial<ProfileInput> = {}): ProfileInput => ({
  ...profileInput,
  ...overrides,
});

describe('mock backend: auth and consent', () => {
  it('returns 401 and calls onUnauthorized without a mock token (AC5)', async () => {
    const { api, onUnauthorized } = setup({ token: null });
    const error = await api.me().catch((e: unknown) => e);
    expect(isApiError(error, 'unauthorized')).toBe(true);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('starts a new user without consent or onboarding', async () => {
    const { api } = setup();
    await expect(api.me()).resolves.toMatchObject({
      userId: user.userId,
      consent: { healthData: false, version: null },
      onboardingCompleted: false,
      profile: null,
      targets: null,
    });
  });

  it('requires consent for health-data routes (AC7)', async () => {
    const { api } = setup();
    for (const call of [() => api.targetsPreview(input()), () => api.updateProfile(input())]) {
      const error = await call().catch((e: unknown) => e);
      expect(isApiError(error, 'consent_required')).toBe(true);
    }
  });

  it('records consent and reports it in /me (AC6)', async () => {
    const { api } = setup();
    await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    await expect(api.me()).resolves.toMatchObject({
      consent: { healthData: true, version: CONSENT_VERSION },
    });
  });
});

describe('mock backend: consent version (spec 002 AC14)', () => {
  it('rejects a consent for an older version of the text', async () => {
    const { api } = setup();
    const error = await api
      .grantConsent({ kind: 'health_data', version: '2026-11' } as never)
      .catch((e: unknown) => e);
    expect(isApiError(error, 'validation_error')).toBe(true);
    await expect(api.me()).resolves.toMatchObject({ consent: { healthData: false } });
  });

  it('asks again when the stored consent is for an older version, keeping the data', async () => {
    const storage = memoryStorage();
    const { api } = setup({ storage });
    await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    await api.updateProfile(input());
    // Rewrite the stored consent as if it had been given to the previous text.
    storage.setItem(
      MOCK_DB_KEY,
      (storage.getItem(MOCK_DB_KEY) ?? '').replaceAll(CONSENT_VERSION, '2026-11'),
    );

    const reloaded = setup({ storage }).api;
    await expect(reloaded.me()).resolves.toMatchObject({
      consent: { healthData: false, version: '2026-11' },
      onboardingCompleted: true,
    });
    const error = await reloaded.updateProfile(input()).catch((e: unknown) => e);
    expect(isApiError(error, 'consent_required')).toBe(true);

    await reloaded.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    await expect(reloaded.me()).resolves.toMatchObject({ consent: { healthData: true } });
  });
});

describe('mock backend: profile and targets', () => {
  async function consented(opts: Parameters<typeof setup>[0] = {}) {
    const s = setup(opts);
    await s.api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    return s;
  }

  it('previews targets without storing anything (AC10)', async () => {
    const { api } = await consented();
    const preview = await api.targetsPreview(input());
    expect(preview.targets?.formulaVersion).toBe('targets-v3');
    expect((await api.me()).onboardingCompleted).toBe(false);
  });

  it('uses, stores and exports what the user trains for (spec 004 AC6, AC10, AC14)', async () => {
    const { api } = await consented();
    const preview = await api.targetsPreview(input({ trainingFocus: 'strength' }));
    expect(preview.breakdown).toMatchObject({ trainingFocus: 'strength', proteinGPerKg: 1.8 });
    const me = await api.updateProfile(input({ trainingFocus: 'strength' }));
    expect(me.profile?.trainingFocus).toBe('strength');
    expect(me.targets).toMatchObject({ proteinG: 108, formulaVersion: 'targets-v3' }); // 1.8 × 60
    expect((await api.exportData()).profile?.trainingFocus).toBe('strength');
  });

  it('needs a named sport for sport performance, with the API fields (spec 004 AC3)', async () => {
    const { api } = await consented();
    const sport = {
      kind: 'sport' as const,
      label: null,
      sessionsPerWeek: 3,
      minutesPerSession: 90,
      intensity: 'moderate' as const,
    };
    const noSport = await api
      .updateProfile(input({ trainingFocus: 'sport_performance' }))
      .catch((e: unknown) => e);
    expect(isApiError(noSport, 'validation_error') && noSport.fields).toEqual({
      plannedActivities: 'too_small',
    });
    const unnamed = await api
      .targetsPreview(input({ trainingFocus: 'sport_performance', plannedActivities: [sport] }))
      .catch((e: unknown) => e);
    expect(isApiError(unnamed, 'validation_error') && unnamed.fields).toEqual({
      'plannedActivities.0.label': 'too_small',
    });
    const named = await api.targetsPreview(
      input({
        trainingFocus: 'sport_performance',
        plannedActivities: [{ ...sport, label: 'pádel' }],
      }),
    );
    expect(named.breakdown?.carbsMinGPerKg).toBe(3);
  });

  it('counts the job and the weekly training in the preview (spec 002 AC6, AC7)', async () => {
    const { api } = await consented();
    const seated = await api.targetsPreview(input());
    const active = await api.targetsPreview(
      input({
        jobActivity: 'physical',
        plannedActivities: [
          {
            kind: 'sport',
            label: 'fútbol',
            sessionsPerWeek: 2,
            minutesPerSession: 90,
            intensity: 'moderate',
          },
        ],
      }),
    );
    expect(seated.breakdown).toMatchObject({ jobFactor: 1.4, trainingFactor: 0 });
    expect(active.breakdown?.jobFactor).toBe(1.8);
    expect(active.targets?.kcal).toBeGreaterThan(seated.targets?.kcal ?? Infinity);
  });

  it('stores the job and the training list and returns them in /me and the export (spec 002 AC5, AC16)', async () => {
    const { api } = await consented();
    const plannedActivities = [
      {
        kind: 'strength' as const,
        label: null,
        sessionsPerWeek: 3,
        minutesPerSession: 60,
        intensity: 'moderate' as const,
      },
    ];
    const me = await api.updateProfile(input({ jobActivity: 'standing', plannedActivities }));
    expect(me.profile).toMatchObject({ jobActivity: 'standing', plannedActivities });
    expect((await api.exportData()).profile).toMatchObject({
      jobActivity: 'standing',
      plannedActivities,
    });
  });

  it('returns 400 for a training list above the weekly limit (spec 002 AC4)', async () => {
    const { api } = await consented();
    const error = await api
      .targetsPreview(
        input({
          plannedActivities: [
            {
              kind: 'cardio',
              label: null,
              sessionsPerWeek: 6,
              minutesPerSession: 240,
              intensity: 'light',
            },
          ],
        }),
      )
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 400, fields: { plannedActivities: 'too_big' } });
  });

  it('returns 400 with field errors for implausible values (AC22)', async () => {
    const { api } = await consented();
    const error = await api.targetsPreview(input({ heightCm: 250 })).catch((e: unknown) => e);
    expect(isApiError(error, 'validation_error')).toBe(true);
    expect(error).toMatchObject({ status: 400, fields: { heightCm: 'too_big' } });
  });

  it('returns 422 age_blocked under 16 and stores nothing (AC17)', async () => {
    const { api } = await consented();
    const error = await api
      .updateProfile(input({ birthDate: '2012-01-01' }))
      .catch((e: unknown) => e);
    expect(isApiError(error, 'age_blocked')).toBe(true);
    expect((await api.me()).profile).toBeNull();
  });

  it('saves the profile, completes onboarding and keeps the targets history (AC16)', async () => {
    let now = NOW;
    const { api } = await consented({ now: () => now });
    const first = await api.updateProfile(input());
    expect(first.onboardingCompleted).toBe(true);
    expect(first.targets?.validFrom).toBe(NOW.toISOString());

    now = new Date('2026-11-12T10:00:00.000Z');
    const second = await api.updateProfile(input({ weightKg: 70, today: '2026-11-12' }));
    expect(second.targets?.kcal).not.toBe(first.targets?.kcal);
    expect(second.profile?.onboardingCompletedAt).toBe(NOW.toISOString());

    const exported = await api.exportData();
    expect(exported.targets).toHaveLength(2);
    expect(exported.targets[0]?.validTo).toBe(now.toISOString());
    expect(exported.targets[1]?.validTo).toBeNull();
  });

  it('stores no numeric targets for pregnancy (AC19)', async () => {
    const { api } = await consented();
    const me = await api.updateProfile(input({ healthFlags: ['pregnancy'] }));
    expect(me.targets).toBeNull();
    expect(me.profile?.safetyFlags).toContain('pregnancy');
  });

  it('exports every row and deletes the account (AC23, AC24)', async () => {
    const storage = memoryStorage();
    const { api } = await consented({ storage });
    await api.updateProfile(input());
    const exported = await api.exportData();
    expect(exported).toMatchObject({ userId: user.userId, email: user.email });
    expect(exported.consents).toHaveLength(1);

    await api.deleteAccount();
    expect(storage.data.get(MOCK_DB_KEY)).not.toContain(user.userId);
    await expect(api.me()).resolves.toMatchObject({
      consent: { healthData: false },
      profile: null,
    });
  });

  it('persists the database in the given storage', async () => {
    const storage = memoryStorage();
    const { api } = await consented({ storage });
    await api.updateProfile(input());
    const reloaded = setup({ storage }).api;
    await expect(reloaded.me()).resolves.toMatchObject({ onboardingCompleted: true });
  });
});

describe('mock backend: weight log (spec 003)', () => {
  const TODAY = '2026-11-11';
  const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
  const all = { from: '2026-01-01', to: TODAY };
  async function consented() {
    const s = setup();
    await s.api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    return s;
  }

  it('needs consent', async () => {
    const { api } = setup();
    await expect(api.listWeights(all)).rejects.toMatchObject({ status: 403 });
    await expect(
      api.saveWeight(TODAY, { weightKg: 60, recordedAt: at(0), today: TODAY }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(api.deleteWeight(TODAY, { today: TODAY })).rejects.toMatchObject({ status: 403 });
  });

  it('stores the profile weight as the entry of that day (AC13)', async () => {
    const { api } = await consented();
    await api.updateProfile(input());
    expect((await api.listWeights(all)).entries).toEqual([
      { localDate: TODAY, weightKg: 60, recordedAt: NOW.toISOString() },
    ]);
  });

  it('copies the latest weight to the profile and recomputes the targets (AC10)', async () => {
    const { api } = await consented();
    const before = await api.updateProfile(input());
    const saved = await api.saveWeight(TODAY, { weightKg: 64, recordedAt: at(60), today: TODAY });
    const after = await api.me();
    expect(after.profile?.weightKg).toBe(64);
    expect(saved.targetsChange?.previous?.kcal).toBe(before.targets?.kcal);
    expect(saved.targetsChange?.current?.kcal).toBe(after.targets?.kcal);
    expect((await api.exportData()).weights).toHaveLength(1);

    // An older day changes nothing (AC13).
    const older = await api.saveWeight('2026-11-09', {
      weightKg: 80,
      recordedAt: at(90),
      today: TODAY,
    });
    expect(older.targetsChange).toBeNull();
    expect((await api.me()).profile?.weightKg).toBe(64);
  });

  it('keeps the write recorded later and deletes idempotently (AC9, AC20)', async () => {
    const { api } = await consented();
    await api.updateProfile(input());
    await api.saveWeight(TODAY, { weightKg: 61, recordedAt: at(300), today: TODAY });
    const late = await api.saveWeight(TODAY, { weightKg: 75, recordedAt: at(100), today: TODAY });
    expect(late.entry?.weightKg).toBe(61);

    expect(await api.deleteWeight(TODAY, { today: TODAY })).toEqual({
      entry: null,
      targetsChange: null,
    });
    await expect(api.deleteWeight(TODAY, { today: TODAY })).resolves.toMatchObject({ entry: null });
    expect((await api.me()).profile?.weightKg).toBe(61);
  });

  it('rejects a future day and an implausible weight with field errors', async () => {
    const { api } = await consented();
    await api.updateProfile(input());
    await expect(
      api.saveWeight('2026-11-12', { weightKg: 60, recordedAt: at(0), today: TODAY }),
    ).rejects.toMatchObject({ status: 400, fields: { localDate: 'in_future' } });
    await expect(
      api.saveWeight(TODAY, { weightKg: 301, recordedAt: at(0), today: TODAY }),
    ).rejects.toMatchObject({ status: 400, fields: { weightKg: 'too_big' } });
  });
});

describe('mock backend: food log (spec 005)', () => {
  const TODAY = '2026-11-11';
  const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
  const ID = '50000000-0000-4000-8000-000000000001';
  const byKey = (key: string) => MOCK_CATALOG.find((f) => f.key === key)!;
  const egg = byKey('d-huevo');
  const milk = byKey('c-leche-semidesnatada');
  const eggs = (over: Record<string, unknown> = {}) => ({
    kind: 'food' as const,
    foodId: egg.id,
    portion: { kind: 'serving' as const, servingId: egg.servings[0]!.id, servings: 2 },
    inputMethod: 'search' as const,
    localDate: TODAY,
    mealType: 'breakfast' as const,
    recordedAt: at(60),
    today: TODAY,
    locale: 'es' as const,
    ...over,
  });
  async function consented() {
    const s = setup();
    await s.api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    return s;
  }
  const log = async (api: ReturnType<typeof setup>['api']) =>
    (await api.listFoodLog({ from: '2026-11-01', to: TODAY })).items;

  it('has a catalog of about 60 foods with valid ids and servings', () => {
    expect(MOCK_CATALOG.length).toBeGreaterThanOrEqual(60);
    expect(new Set(MOCK_CATALOG.map((f) => f.id)).size).toBe(MOCK_CATALOG.length);
    for (const f of MOCK_CATALOG) expect(f.servings.length).toBeGreaterThan(0);
  });

  it('needs consent for search and the log, not for the sources', async () => {
    const { api } = setup();
    await expect(api.searchFoods('leche', 'es')).rejects.toMatchObject({ status: 403 });
    await expect(api.listFoodLog({ from: TODAY, to: TODAY })).rejects.toMatchObject({
      status: 403,
    });
    expect((await api.foodSources('es')).sources[0]!.attribution).toMatch(/Ciqual/);
  });

  it('searches like the API, ignoring accents and one typo (AC4)', async () => {
    const { api } = await consented();
    expect((await api.searchFoods('leche', 'es')).foods[0]!.key).toBe('c-leche-semidesnatada');
    expect((await api.searchFoods('platno', 'es')).foods[0]!.key).toBe('b-platano');
    await expect(api.searchFoods('l', 'es')).rejects.toMatchObject({ status: 400 });
  });

  it('returns one food, and 404 for an unknown one', async () => {
    const { api } = await consented();
    expect((await api.getFood(milk.id, 'en')).name).toBe('Semi-skimmed milk');
    await expect(api.getFood('f9999999-0000-4000-8000-000000000000', 'es')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('stores the snapshot computed from the catalog and keeps the later write (AC9, AC20)', async () => {
    const { api } = await consented();
    const { item } = await api.saveMealItem(ID, eggs());
    const grams = 2 * egg.servings[0]!.grams;
    expect(item).toMatchObject({ grams, label: 'Huevo', servings: 2 });
    expect(item!.nutrients.kcal).toBeCloseTo((egg.per100g.kcal * grams) / 100, 1);
    // An older write from another device does not win; the same write twice keeps one item.
    await api.saveMealItem(ID, eggs({ recordedAt: at(30), mealType: 'lunch' }));
    await api.saveMealItem(ID, eggs());
    expect((await log(api)).map((i) => [i.id, i.mealType])).toEqual([[ID, 'breakfast']]);
  });

  it('deletes with a tombstone that an older write cannot undo (AC20)', async () => {
    const { api } = await consented();
    await api.saveMealItem(ID, eggs());
    await api.deleteMealItem(ID, { recordedAt: at(120) });
    await api.deleteMealItem(ID, { recordedAt: at(121) });
    expect(await log(api)).toEqual([]);
    expect((await api.saveMealItem(ID, eggs({ recordedAt: at(90) }))).item).toBeNull();
    expect(await log(api)).toEqual([]);
    expect((await api.saveMealItem(ID, eggs({ recordedAt: at(130) }))).item).not.toBeNull();
  });

  it('rejects a future day and a serving of another food', async () => {
    const { api } = await consented();
    await expect(api.saveMealItem(ID, eggs({ localDate: '2026-11-12' }))).rejects.toMatchObject({
      status: 400,
      fields: { localDate: 'in_future' },
    });
    await expect(api.saveMealItem(ID, eggs({ foodId: milk.id }))).rejects.toMatchObject({
      status: 400,
      fields: { 'portion.servingId': 'not_found' },
    });
  });

  it('lists recents with the last portion, and favourites newest first (AC7, AC14)', async () => {
    let now = NOW;
    const { api } = setup({ now: () => now });
    await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    await api.saveMealItem(ID, eggs());
    await api.saveMealItem(
      '50000000-0000-4000-8000-000000000002',
      eggs({ foodId: milk.id, portion: { kind: 'grams', grams: 250 }, recordedAt: at(90) }),
    );
    const { recents } = await api.recentFoods('es');
    expect(recents.map((r) => [r.food.key, r.lastPortion])).toEqual([
      ['c-leche-semidesnatada', { kind: 'grams', grams: 250 }],
      ['d-huevo', { kind: 'serving', servingId: egg.servings[0]!.id, servings: 2 }],
    ]);

    await api.setFavouriteFood(egg.id, true);
    now = new Date(NOW.getTime() + 1000);
    await api.setFavouriteFood(milk.id, true);
    await api.setFavouriteFood(milk.id, true);
    expect((await api.favouriteFoods('es')).foods.map((f) => f.key)).toEqual([
      'c-leche-semidesnatada',
      'd-huevo',
    ]);
    await api.setFavouriteFood(egg.id, false);
    expect((await api.favouriteFoods('es')).foods).toHaveLength(1);
  });

  it('exports the food log and the favourites, and deletes them with the account (AC23)', async () => {
    const { api } = await consented();
    await api.saveMealItem(ID, eggs());
    await api.setFavouriteFood(egg.id, true);
    const data = await api.exportData();
    expect(data.mealItems.map((i) => i.id)).toEqual([ID]);
    expect(data.favouriteFoods).toEqual([
      { foodId: egg.id, key: 'd-huevo', createdAt: NOW.toISOString() },
    ]);
    await api.deleteAccount();
    await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    expect(await log(api)).toEqual([]);
    expect((await api.favouriteFoods('es')).foods).toEqual([]);
  });
});

describe('mock backend: exercises and workouts (spec 009)', () => {
  const TODAY = '2026-11-11';
  const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
  const W1 = '70000000-0000-4000-8000-000000000001';
  const OWN = 'e1000000-0000-4000-8000-000000000001';
  const byKey = (key: string) => MOCK_EXERCISES.find((e) => e.key === key)!;
  const bench = byKey('press-banca');
  const plank = byKey('plancha');
  const benchSet = (weightKg: number) => ({
    reps: 8,
    weightKg,
    durationS: null,
    distanceM: null,
    restS: 90,
  });
  const session = (over: Record<string, unknown> = {}) => ({
    kind: 'gym' as const,
    name: 'Pecho',
    minutes: 50,
    exercises: [{ exerciseId: bench.id, sets: [benchSet(60), benchSet(60)] }],
    inputMethod: 'live' as const,
    localDate: TODAY,
    startedAt: '2026-11-11T08:00:00.000Z',
    sessionRpe: 7,
    recordedAt: at(60),
    today: TODAY,
    locale: 'es' as const,
    ...over,
  });
  const own = (over: Record<string, unknown> = {}) => ({
    name: 'Remo Hammer',
    tracking: 'weight_reps' as const,
    primaryMuscle: 'back' as const,
    recordedAt: at(0),
    ...over,
  });
  async function consented(opts: Parameters<typeof setup>[0] = {}) {
    const s = setup(opts);
    await s.api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    return s;
  }
  const list = async (api: ReturnType<typeof setup>['api']) =>
    (await api.listWorkouts({ from: '2026-11-01', to: TODAY })).workouts;

  it('has 40 catalog exercises with unique ids and every way of tracking', () => {
    expect(MOCK_EXERCISES).toHaveLength(40);
    expect(new Set(MOCK_EXERCISES.map((e) => e.id)).size).toBe(40);
    expect(new Set(MOCK_EXERCISES.map((e) => e.tracking))).toEqual(
      new Set(['weight_reps', 'reps', 'duration', 'distance_duration']),
    );
  });

  it('needs consent on every training route (403)', async () => {
    const { api } = setup();
    for (const call of [
      () => api.exerciseCatalog(),
      () => api.listWorkouts({ from: TODAY, to: TODAY }),
      () => api.saveWorkout(W1, session()),
      () => api.exerciseStats(),
      () => api.saveCustomExercise(OWN, own()),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 403 });
    }
  });

  it('lists free-exercise-db among the data sources (AC2)', async () => {
    const { api } = setup();
    const { sources } = await api.foodSources('es');
    expect(sources.map((s) => s.id)).toContain('free-exercise-db');
  });

  it('stores a session with label snapshots and only the tracked values', async () => {
    const { api } = await consented();
    const plankSet = { reps: 3, weightKg: null, durationS: 45, distanceM: null, restS: 60 };
    const { workout } = await api.saveWorkout(
      W1,
      session({
        exercises: [
          { exerciseId: bench.id, sets: [benchSet(60)] },
          { exerciseId: plank.id, sets: [plankSet] },
        ],
      }),
    );
    expect(workout!.exercises.map((e) => [e.label, e.tracking])).toEqual([
      ['Press de banca', 'weight_reps'],
      [plank.nameEs, 'duration'],
    ]);
    expect(workout!.exercises[1]!.sets[0]).toMatchObject({ durationS: 45, reps: null });
    expect(await list(api)).toEqual([workout]);
  });

  it('rejects a future day, a set without its values and an unknown exercise', async () => {
    const { api } = await consented();
    await expect(api.saveWorkout(W1, session({ localDate: '2026-11-12' }))).rejects.toMatchObject({
      status: 400,
      fields: { localDate: 'in_future' },
    });
    const noReps = { ...benchSet(60), reps: null };
    await expect(
      api.saveWorkout(W1, session({ exercises: [{ exerciseId: bench.id, sets: [noReps] }] })),
    ).rejects.toMatchObject({ status: 400, fields: { 'exercises.0.sets.0': 'set_mismatch' } });
    await expect(
      api.saveWorkout(W1, session({ exercises: [{ exerciseId: OWN, sets: [benchSet(60)] }] })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('keeps the later write, and a delete against an older write (AC23)', async () => {
    const { api } = await consented();
    await api.saveWorkout(W1, session({ recordedAt: at(100) }));
    const late = await api.saveWorkout(W1, session({ name: 'Viejo', recordedAt: at(50) }));
    expect(late.workout!.name).toBe('Pecho');
    await api.deleteWorkout(W1, { recordedAt: at(200) });
    await api.saveWorkout(W1, session({ recordedAt: at(150) }));
    expect(await list(api)).toEqual([]);
  });

  it('computes stats and history from the stored sets (AC14, AC15)', async () => {
    const { api } = await consented();
    await api.saveWorkout(W1, session());
    const { stats } = await api.exerciseStats();
    expect(stats).toMatchObject([
      { exerciseId: bench.id, bests: { heaviestKg: { value: 60, localDate: TODAY } } },
    ]);
    const history = await api.exerciseHistory(bench.id);
    expect(history.sessions.map((s) => s.workoutId)).toEqual([W1]);
    await expect(api.exerciseHistory(OWN)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps custom exercises private, refuses taken ids, keeps past labels after a delete', async () => {
    const { api } = await consented();
    await expect(api.saveCustomExercise(bench.id, own())).rejects.toMatchObject({
      status: 409,
      code: 'id_taken',
    });
    await api.saveCustomExercise(OWN, own());
    await api.saveWorkout(W1, session({ exercises: [{ exerciseId: OWN, sets: [benchSet(40)] }] }));
    expect((await api.exerciseCatalog()).exercises.at(-1)).toMatchObject({
      id: OWN,
      origin: 'user',
    });

    const other = setup({ token: mockAccessToken(mockUserFromEmail('bea@example.com')) });
    await other.api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    expect((await other.api.exerciseCatalog()).exercises).toHaveLength(40);

    await api.deleteCustomExercise(OWN, { recordedAt: at(10) });
    expect((await api.exerciseCatalog()).exercises).toHaveLength(40);
    expect((await list(api))[0]!.exercises[0]!.label).toBe('Remo Hammer');
    // An old session that used it can still be edited by its owner.
    const edit = session({
      exercises: [{ exerciseId: OWN, sets: [benchSet(42.5)] }],
      recordedAt: at(120),
    });
    await expect(api.saveWorkout(W1, edit)).resolves.toMatchObject({ workout: { id: W1 } });
  });

  it('exports workouts and custom exercises, and deletes them with the account (AC25)', async () => {
    const storage = memoryStorage();
    const { api } = await consented({ storage });
    await api.saveCustomExercise(OWN, own());
    await api.deleteCustomExercise(OWN, { recordedAt: at(10) });
    await api.saveWorkout(W1, session());
    // The mock database survives a reload.
    const reloaded = setup({ storage }).api;
    const data = await reloaded.exportData();
    expect(data.workouts.map((w) => w.id)).toEqual([W1]);
    expect(data.customExercises).toMatchObject([{ id: OWN, deletedAt: NOW.toISOString() }]);

    await reloaded.deleteAccount();
    await reloaded.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
    expect(await list(reloaded)).toEqual([]);
    expect((await reloaded.exportData()).customExercises).toEqual([]);
  });
});
