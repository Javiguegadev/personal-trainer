import {
  ApiErrorSchema,
  CONSENT_VERSION,
  ExportResponseSchema,
  MeResponseSchema,
  WeightListResponseSchema,
  WeightSaveResponseSchema,
  type ProfileInput,
} from '@pt/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { NOW, TODAY, createTestApp, profileInput } from '../../test/fakes';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

/** Device time `seconds` after the server clock of the tests. */
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();

const errorOf = async (res: Response) => ApiErrorSchema.parse(await res.json());
const me = async () => MeResponseSchema.parse(await (await t.call('GET', '/me')).json());
const list = async (from = '2026-01-01', to = TODAY) =>
  WeightListResponseSchema.parse(
    await (await t.call('GET', `/me/weights?from=${from}&to=${to}`)).json(),
  ).entries;

/** Consent + a stored profile: 35-year-old woman, 165 cm, 70 kg, goal "lose". */
async function onboard(overrides: Partial<ProfileInput> = {}) {
  await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });
  const res = await t.call('PUT', '/me/profile', profileInput(overrides));
  expect(res.status).toBe(200);
}

async function put(localDate: string, weightKg: number, recordedAt = at(60), today = TODAY) {
  const res = await t.call('PUT', `/me/weights/${localDate}`, { weightKg, recordedAt, today });
  expect(res.status).toBe(200);
  return WeightSaveResponseSchema.parse(await res.json());
}

async function remove(localDate: string) {
  const res = await t.call('DELETE', `/me/weights/${localDate}?today=${TODAY}`);
  expect(res.status).toBe(200);
  return WeightSaveResponseSchema.parse(await res.json());
}

const ROUTES = [
  ['GET', `/me/weights?from=2026-11-01&to=${TODAY}`, undefined],
  ['PUT', `/me/weights/${TODAY}`, { weightKg: 70, recordedAt: at(0), today: TODAY }],
  ['DELETE', `/me/weights/${TODAY}?today=${TODAY}`, undefined],
] as const;

describe('weights: auth and consent', () => {
  it.each(ROUTES)('%s %s without a token → 401', async (method, path, body) => {
    const res = await t.call(method, path, body, null);
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('unauthorized');
  });

  it.each(ROUTES)('%s %s without consent → 403', async (method, path, body) => {
    const res = await t.call(method, path, body);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('consent_required');
  });

  it('rejects a write before there is a profile', async () => {
    await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });
    const res = await t.call('PUT', `/me/weights/${TODAY}`, {
      weightKg: 70,
      recordedAt: at(0),
      today: TODAY,
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ profile: 'required' });
  });
});

describe('PUT /me/weights/{localDate} (spec 003 AC7, AC8, AC10, AC11)', () => {
  beforeEach(() => onboard());

  it('the profile save stored the weight as the entry of that day (AC13)', async () => {
    expect(await list()).toEqual([
      { localDate: TODAY, weightKg: 70, recordedAt: NOW.toISOString() },
    ]);
  });

  it('stores the most recent weight on the profile and recomputes the targets', async () => {
    const before = await me();
    const saved = await put(TODAY, 66);
    expect(saved.entry).toEqual({ localDate: TODAY, weightKg: 66, recordedAt: at(60) });

    const after = await me();
    expect(after.profile?.weightKg).toBe(66);
    const withoutValidity = ({ validFrom: _, ...rest }: NonNullable<typeof before.targets>) => rest;
    const previous = withoutValidity(before.targets!);
    const current = withoutValidity(after.targets!);
    expect(saved.targetsChange).toMatchObject({ previous, current });
    // Less weight, lower BMR: fewer calories.
    expect(current.kcal).toBeLessThan(previous.kcal);
    expect(saved.targetsChange?.safety).toMatchObject({
      appliedGoal: 'lose',
      targetsAllowed: true,
    });

    // The old row is closed, not overwritten.
    const exported = ExportResponseSchema.parse(await (await t.call('GET', '/me/export')).json());
    expect(exported.targets).toHaveLength(2);
    expect(exported.targets.filter((row) => row.validTo === null)).toHaveLength(1);
    expect(exported.weights).toEqual([{ localDate: TODAY, weightKg: 66, recordedAt: at(60) }]);
  });

  it('replaces the entry of the same day (AC8)', async () => {
    await put(TODAY, 69.6, at(60));
    await put(TODAY, 69.2, at(120));
    expect((await list()).map((e) => e.weightKg)).toEqual([69.2]);
  });

  it('is idempotent: sending the same write again changes nothing (AC19)', async () => {
    const first = await put(TODAY, 66);
    const again = await put(TODAY, 66);
    expect(again.entry).toEqual(first.entry);
    expect(again.targetsChange).toBeNull();
    expect(await list()).toHaveLength(1);
    const exported = ExportResponseSchema.parse(await (await t.call('GET', '/me/export')).json());
    expect(exported.targets).toHaveLength(2);
  });

  it('keeps the write recorded later on its device, whatever the order of arrival (AC20)', async () => {
    await put(TODAY, 69, at(300));
    const late = await put(TODAY, 75, at(100));
    expect(late.entry).toEqual({ localDate: TODAY, weightKg: 69, recordedAt: at(300) });
    expect(late.targetsChange).toBeNull();
    expect((await me()).profile?.weightKg).toBe(69);
  });

  it('does not change the targets with an entry before the most recent one (AC13)', async () => {
    const before = await me();
    const saved = await put('2026-11-08', 90);
    expect(saved.entry?.weightKg).toBe(90);
    expect(saved.targetsChange).toBeNull();
    expect(await me()).toEqual(before);
    expect((await list()).map((e) => e.localDate)).toEqual(['2026-11-08', TODAY]);
  });

  it('says nothing about targets when the latest weight is the same', async () => {
    const saved = await put(TODAY, 70);
    expect(saved.targetsChange).toBeNull();
  });

  it.each([
    ['a day after today', '2026-11-12', {}, { localDate: 'in_future' }],
    ['a day more than 5 years ago', '2021-11-01', {}, { localDate: 'too_old' }],
    ['a weight below 30 kg', TODAY, { weightKg: 29.9 }, { weightKg: 'too_small' }],
    ['a weight above 300 kg', TODAY, { weightKg: 300.1 }, { weightKg: 'too_big' }],
    ['an implausible today', TODAY, { today: '2026-11-20' }, { today: 'implausible' }],
    [
      'a device clock more than a day ahead',
      TODAY,
      { recordedAt: at(90_000) },
      { recordedAt: 'in_future' },
    ],
  ])('rejects %s with 400 and stores nothing', async (_name, localDate, overrides, fields) => {
    const res = await t.call('PUT', `/me/weights/${localDate}`, {
      weightKg: 68,
      recordedAt: at(60),
      today: TODAY,
      ...overrides,
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual(fields);
    expect((await list()).map((e) => e.weightKg)).toEqual([70]);
  });

  it('rejects a path that is not a date', async () => {
    const res = await t.call('PUT', '/me/weights/today', {
      weightKg: 68,
      recordedAt: at(60),
      today: TODAY,
    });
    expect(res.status).toBe(400);
  });
});

describe('safety rules on a logged weight (AC12)', () => {
  it('removes the deficit on one reading below BMI 20 and restores it on the 7-day average', async () => {
    await onboard();
    // 165 cm: BMI 20 is 54.45 kg (54 kg → BMI 19.8); BMI 20.5 is 55.81 kg.
    const low = await put(TODAY, 54, at(60));
    expect(low.targetsChange?.safety.appliedGoal).toBe('maintain');
    expect(low.targetsChange?.safety.flags).toContain('low_bmi');
    expect((await me()).profile).toMatchObject({
      weightKg: 54,
      requestedGoal: 'lose',
      goal: 'maintain',
    });
    expect((await me()).profile?.safetyFlags).toContain('low_bmi');

    // One reading well above the threshold (60 kg, BMI 22.0) is not enough.
    await put(TODAY, 60, at(120));
    expect((await me()).profile).toMatchObject({ weightKg: 60, goal: 'maintain' });

    // Earlier days change nothing on their own (AC13); then today's entry completes a 7-day average of
    // 56 kg (BMI 20.57) and the deficit comes back.
    await put('2026-11-09', 56, at(130));
    await put('2026-11-10', 56, at(140));
    expect((await me()).profile?.goal).toBe('maintain');
    const back = await put(TODAY, 56, at(150));
    expect(back.targetsChange?.safety.appliedGoal).toBe('lose');
    const profile = (await me()).profile;
    expect(profile?.goal).toBe('lose');
    expect(profile?.safetyFlags).not.toContain('low_bmi');
  });

  it('applies the same rule to a weight typed in the profile form', async () => {
    await onboard();
    await put(TODAY, 54, at(60));
    // One typed weight above the threshold: still no deficit, in the preview and in the save.
    const preview = await t.call(
      'POST',
      '/onboarding/targets-preview',
      profileInput({ weightKg: 60 }),
    );
    expect((await preview.json()) as unknown).toMatchObject({
      safety: { appliedGoal: 'maintain' },
    });
    await t.call('PUT', '/me/profile', profileInput({ weightKg: 60 }));
    expect((await me()).profile?.goal).toBe('maintain');
  });

  it('keeps ed_soft_stop whatever the weight', async () => {
    await onboard({ healthFlags: ['ed_soft_stop'] });
    const saved = await put(TODAY, 66);
    expect(saved.targetsChange?.safety.appliedGoal).toBe('maintain');
    const profile = (await me()).profile;
    expect(profile?.safetyFlags).toContain('ed_soft_stop');
    expect(profile?.goal).toBe('maintain');
  });

  it('stores the weight without targets during pregnancy (AC11)', async () => {
    await onboard({ healthFlags: ['pregnancy'] });
    const saved = await put(TODAY, 72);
    expect(saved.targetsChange).toBeNull();
    const after = await me();
    expect(after.targets).toBeNull();
    expect(after.profile?.weightKg).toBe(72);
    expect(after.profile?.safetyFlags).toContain('pregnancy');
  });
});

describe('DELETE /me/weights/{localDate} (AC9, AC13)', () => {
  beforeEach(() => onboard());

  it('recomputes the targets with the entry that is now the most recent', async () => {
    await put('2026-11-09', 74, at(30));
    const before = await me();
    const removed = await remove(TODAY);
    expect(removed.entry).toBeNull();
    expect(removed.targetsChange?.previous?.kcal).toBe(before.targets?.kcal);
    expect(removed.targetsChange?.current?.kcal).toBeGreaterThan(before.targets!.kcal);
    expect((await me()).profile?.weightKg).toBe(74);
  });

  it('does not change the targets when an older entry is deleted', async () => {
    await put('2026-11-09', 74, at(30));
    const removed = await remove('2026-11-09');
    expect(removed).toEqual({ entry: null, targetsChange: null });
    expect((await list()).map((e) => e.localDate)).toEqual([TODAY]);
  });

  it('succeeds when the entry does not exist, and leaves the profile alone with no entries', async () => {
    const before = await me();
    expect(await remove(TODAY)).toEqual({ entry: null, targetsChange: null });
    expect(await remove(TODAY)).toEqual({ entry: null, targetsChange: null });
    expect(await list()).toEqual([]);
    expect(await me()).toEqual(before);
  });

  it('rejects an implausible today', async () => {
    const res = await t.call('DELETE', `/me/weights/${TODAY}?today=2026-12-01`);
    expect(res.status).toBe(400);
  });
});

describe('GET /me/weights (AC14)', () => {
  beforeEach(() => onboard());

  it('returns the entries of the range, oldest first', async () => {
    await put('2026-11-09', 70.4);
    await put('2026-10-01', 71);
    expect((await list('2026-11-01', TODAY)).map((e) => e.localDate)).toEqual([
      '2026-11-09',
      TODAY,
    ]);
    expect(await list('2026-10-01', '2026-10-01')).toHaveLength(1);
  });

  it.each([
    ['from after to', '2026-11-10', '2026-11-01', { from: 'after_to' }],
    ['more than 366 days', '2025-11-09', TODAY, { to: 'too_big' }],
  ])('rejects %s', async (_name, from, to, fields) => {
    const res = await t.call('GET', `/me/weights?from=${from}&to=${to}`);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual(fields);
  });

  it('accepts exactly 366 days and rejects a missing bound', async () => {
    expect((await t.call('GET', `/me/weights?from=2025-11-10&to=${TODAY}`)).status).toBe(200);
    expect((await t.call('GET', `/me/weights?from=${TODAY}`)).status).toBe(400);
  });

  it('never returns another user’s entries', async () => {
    const other = await t.tokens.sign({ sub: '0b7a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' });
    await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION }, other);
    const res = await t.call('GET', `/me/weights?from=2026-11-01&to=${TODAY}`, undefined, other);
    expect(WeightListResponseSchema.parse(await res.json()).entries).toEqual([]);
  });
});

describe('PUT /me/profile and the weight log (AC13)', () => {
  it('stores another weight typed in the profile form as today’s entry', async () => {
    await onboard();
    await put('2026-11-09', 71);
    await t.call('PUT', '/me/profile', profileInput({ weightKg: 68.5 }));
    expect((await list()).map((e) => [e.localDate, e.weightKg])).toEqual([
      ['2026-11-09', 71],
      [TODAY, 68.5],
    ]);
  });

  it('adds no entry when the profile is saved with the same weight', async () => {
    await onboard();
    await remove(TODAY);
    await t.call('PUT', '/me/profile', profileInput({ jobActivity: 'physical' }));
    expect(await list()).toEqual([]);
  });

  it('deleting the account removes the entries (AC26)', async () => {
    await onboard();
    expect((await t.call('DELETE', '/me')).status).toBe(204);
    expect(t.store.users.size).toBe(0);
  });
});
