import {
  ApiErrorSchema,
  CONSENT_VERSION,
  EMPTY_WEEK,
  ExportResponseSchema,
  MeResponseSchema,
  type PlannedActivity,
  type WeekRequest,
} from '@pt/contracts';
import { addDays } from '@pt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { TODAY, USER_ID, createTestApp, profileInput } from '../../test/fakes';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

const errorOf = async (res: Response) => ApiErrorSchema.parse(await res.json());
const consent = () =>
  t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });

const gym = (over: Partial<PlannedActivity> = {}): PlannedActivity => ({
  kind: 'strength',
  label: null,
  sessionsPerWeek: 3,
  minutesPerSession: 60,
  intensity: 'moderate',
  days: [],
  ...over,
});
const football: PlannedActivity = {
  kind: 'sport',
  label: 'Fútbol',
  sessionsPerWeek: 1,
  minutesPerSession: 90,
  intensity: 'hard',
  days: [{ weekday: 6, startMinute: 660, isMatch: true }],
};
const gymDays = [1, 3, 5].map((weekday) => ({ weekday, startMinute: 1110, isMatch: false }));

const week = (over: Partial<WeekRequest> = {}): WeekRequest => ({
  workPattern: 'fixed',
  workBlocks: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 480, endMinute: 960 })),
  dayStartMinute: 0,
  plannedActivities: [gym({ days: gymDays }), football],
  today: TODAY,
  ...over,
});

/** A user with consent and a profile training at the gym 3 times a week, without days. */
async function withProfile(activities: PlannedActivity[] = [gym(), { ...football, days: [] }]) {
  await consent();
  const res = await t.call('PUT', '/me/profile', profileInput({ plannedActivities: activities }));
  expect(res.status).toBe(200);
  return MeResponseSchema.parse(await res.json());
}

async function putWeek(body: unknown, status = 200) {
  const res = await t.call('PUT', '/me/week', body);
  expect(res.status).toBe(status);
  return res;
}

describe('auth and consent (spec 010 AC23)', () => {
  it.each([
    ['PUT', '/me/week'],
    ['PUT', '/me/training-profile'],
  ])('%s %s without a token → 401', async (method, path) => {
    const res = await t.call(method, path, undefined, null);
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('unauthorized');
  });

  it.each([
    ['/me/week', week()],
    ['/me/training-profile', { experience: 'beginner', equipment: 'full_gym' }],
  ])('PUT %s without the current consent → 403', async (path, body) => {
    const res = await t.call('PUT', path, body);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('consent_required');
  });
});

describe('PUT /me/week (spec 010 AC1–AC4)', () => {
  it('starts with the empty week', async () => {
    const me = await withProfile();
    expect(me.profile?.week).toEqual(EMPTY_WEEK);
    expect(me.profile?.plannedActivities.every((a) => a.days.length === 0)).toBe(true);
  });

  it('stores the work pattern, work blocks, day start and the days in one write (AC4)', async () => {
    await withProfile();
    const me = MeResponseSchema.parse(await (await putWeek(week({ dayStartMinute: 240 }))).json());
    expect(me.profile?.week).toEqual({
      workPattern: 'fixed',
      workBlocks: week().workBlocks,
      dayStartMinute: 240,
    });
    expect(me.profile?.plannedActivities).toEqual([gym({ days: gymDays }), football]);
    const reread = MeResponseSchema.parse(await (await t.call('GET', '/me')).json());
    expect(reread.profile?.week.dayStartMinute).toBe(240);
  });

  it('stores a night block that ends the next day (AC3)', async () => {
    await withProfile();
    const night = [{ weekday: 1, startMinute: 1320, endMinute: 360 }];
    const me = MeResponseSchema.parse(await (await putWeek(week({ workBlocks: night }))).json());
    expect(me.profile?.week.workBlocks).toEqual(night);
  });

  it('leaves the targets untouched when the training load is the same (AC4)', async () => {
    const before = await withProfile();
    const me = MeResponseSchema.parse(await (await putWeek(week())).json());
    expect(me.targets).toEqual(before.targets);
    expect(t.store.rows(USER_ID).targets).toHaveLength(1);
  });

  it('computes the targets again when the number of days changes (AC4)', async () => {
    const before = await withProfile();
    const fiveDays = [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      startMinute: null,
      isMatch: false,
    }));
    const me = MeResponseSchema.parse(
      await (
        await putWeek(
          week({ plannedActivities: [gym({ sessionsPerWeek: 5, days: fiveDays }), football] }),
        )
      ).json(),
    );
    expect(me.profile?.plannedActivities[0]?.sessionsPerWeek).toBe(5);
    expect(me.targets?.kcal).toBeGreaterThan(before.targets!.kcal);
    const history = t.store.rows(USER_ID).targets;
    expect(history).toHaveLength(2);
    expect(history.filter((row) => row.validTo === null)).toHaveLength(1);
  });

  it('stores no work blocks for shifts, irregular hours or no schedule (AC3)', async () => {
    await withProfile();
    for (const workPattern of ['shifts', 'irregular', 'none'] as const) {
      const me = MeResponseSchema.parse(
        await (await putWeek(week({ workPattern, workBlocks: [] }))).json(),
      );
      expect(me.profile?.week).toMatchObject({ workPattern, workBlocks: [] });
    }
    const res = await putWeek(week({ workPattern: 'shifts' }), 400);
    expect((await errorOf(res)).code).toBe('validation_error');
  });

  it.each([
    [
      'a block that ends when it starts',
      { workBlocks: [{ weekday: 1, startMinute: 480, endMinute: 480 }] },
    ],
    [
      'a repeated weekday',
      { workBlocks: [1, 1].map((weekday) => ({ weekday, startMinute: 480, endMinute: 960 })) },
    ],
    ['a day start that is not a step of 30 min', { dayStartMinute: 45 }],
    ['a day start after 06:00', { dayStartMinute: 390 }],
    [
      'days that do not match the sessions',
      { plannedActivities: [gym({ sessionsPerWeek: 2, days: gymDays })] },
    ],
    [
      'a match day outside a sport',
      {
        plannedActivities: [
          gym({ sessionsPerWeek: 1, days: [{ weekday: 1, startMinute: null, isMatch: true }] }),
        ],
      },
    ],
  ])('rejects %s with 400', async (_, over) => {
    await withProfile();
    const res = await putWeek(week(over as Partial<WeekRequest>), 400);
    expect((await errorOf(res)).code).toBe('validation_error');
  });

  it('rejects an implausible today', async () => {
    await withProfile();
    const res = await putWeek(week({ today: addDays(TODAY, 3) }), 400);
    expect((await errorOf(res)).fields).toEqual({ today: 'implausible' });
  });

  it('needs a profile first', async () => {
    await consent();
    const res = await putWeek(week(), 400);
    expect((await errorOf(res)).fields).toEqual({ profile: 'required' });
  });

  it('keeps the days when the profile form saves the activities (AC4)', async () => {
    await withProfile([gym({ days: gymDays })]);
    const me = MeResponseSchema.parse(await (await t.call('GET', '/me')).json());
    expect(me.profile?.plannedActivities[0]?.days).toEqual(gymDays);
  });

  it('keeps the week when the profile form is saved again', async () => {
    await withProfile();
    await putWeek(week({ dayStartMinute: 120 }));
    await t.call('PUT', '/me/profile', profileInput({ heightCm: 166 }));
    const me = MeResponseSchema.parse(await (await t.call('GET', '/me')).json());
    expect(me.profile?.week).toMatchObject({ workPattern: 'fixed', dayStartMinute: 120 });
  });
});

describe('PUT /me/training-profile (spec 010 AC14)', () => {
  it('stores experience and equipment', async () => {
    await withProfile();
    const res = await t.call('PUT', '/me/training-profile', {
      experience: 'intermediate',
      equipment: 'home_dumbbells',
    });
    expect(res.status).toBe(200);
    const me = MeResponseSchema.parse(await res.json());
    expect(me.profile).toMatchObject({
      trainingExperience: 'intermediate',
      equipmentAccess: 'home_dumbbells',
      trainingFocus: 'general_fitness',
    });
  });

  it('rejects an unknown answer with 400', async () => {
    await withProfile();
    const res = await t.call('PUT', '/me/training-profile', {
      experience: 'expert',
      equipment: 'full_gym',
    });
    expect(res.status).toBe(400);
  });

  it('needs a profile first', async () => {
    await consent();
    const res = await t.call('PUT', '/me/training-profile', {
      experience: 'beginner',
      equipment: 'bodyweight',
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ profile: 'required' });
  });
});

describe('GET /me/export (spec 010 AC24)', () => {
  it('includes the week, the activity days and the wizard answers', async () => {
    await withProfile();
    await putWeek(week({ dayStartMinute: 60 }));
    await t.call('PUT', '/me/training-profile', { experience: 'beginner', equipment: 'full_gym' });
    const data = ExportResponseSchema.parse(await (await t.call('GET', '/me/export')).json());
    expect(data.profile).toMatchObject({
      week: { workPattern: 'fixed', dayStartMinute: 60 },
      trainingExperience: 'beginner',
      equipmentAccess: 'full_gym',
    });
    expect(data.profile?.week.workBlocks).toHaveLength(5);
    expect(data.profile?.plannedActivities[0]?.days).toEqual(gymDays);
  });
});
