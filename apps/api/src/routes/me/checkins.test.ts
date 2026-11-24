import {
  ApiErrorSchema,
  CONSENT_VERSION,
  CheckinListResponseSchema,
  CheckinSaveResponseSchema,
  ExportResponseSchema,
  type CheckinUpsertRequest,
} from '@pt/contracts';
import { addDays } from '@pt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { NOW, OTHER_USER_ID, TODAY, createTestApp } from '../../test/fakes';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

/** Device time `seconds` after the server clock of the tests. */
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();

const errorOf = async (res: Response) => ApiErrorSchema.parse(await res.json());

const body = (overrides: Partial<CheckinUpsertRequest> = {}): CheckinUpsertRequest => ({
  sleepMinutes: 390,
  stress: 'normal',
  workShift: null,
  shiftStartMinute: null,
  shiftEndMinute: null,
  recordedAt: at(60),
  today: TODAY,
  ...overrides,
});

async function consent() {
  const res = await t.call('POST', '/me/consent', {
    kind: 'health_data',
    version: CONSENT_VERSION,
  });
  expect(res.status).toBe(204);
}

async function put(localDate: string, overrides: Partial<CheckinUpsertRequest> = {}) {
  const res = await t.call('PUT', `/me/checkins/${localDate}`, body(overrides));
  expect(res.status).toBe(200);
  return CheckinSaveResponseSchema.parse(await res.json()).checkin;
}

async function remove(localDate: string, recordedAt = at(120)) {
  const res = await t.call(
    'DELETE',
    `/me/checkins/${localDate}?recordedAt=${encodeURIComponent(recordedAt)}&today=${TODAY}`,
  );
  expect(res.status).toBe(200);
  return CheckinSaveResponseSchema.parse(await res.json()).checkin;
}

async function list(from = addDays(TODAY, -27), to = TODAY) {
  const res = await t.call('GET', `/me/checkins?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  return CheckinListResponseSchema.parse(await res.json()).checkins;
}

const ROUTES = [
  ['GET', `/me/checkins?from=2026-11-01&to=${TODAY}`, undefined],
  ['PUT', `/me/checkins/${TODAY}`, body()],
  [
    'DELETE',
    `/me/checkins/${TODAY}?recordedAt=${encodeURIComponent(at(0))}&today=${TODAY}`,
    undefined,
  ],
] as const;

describe('check-ins: auth and consent', () => {
  it.each(ROUTES)('%s %s without a token → 401', async (method, path, payload) => {
    const res = await t.call(method, path, payload, null);
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('unauthorized');
  });

  it.each(ROUTES)('%s %s without consent → 403', async (method, path, payload) => {
    const res = await t.call(method, path, payload);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('consent_required');
  });
});

describe('PUT /me/checkins/{localDate} (spec 011 AC2, AC3, AC15)', () => {
  beforeEach(consent);

  it('stores sleep, stress and a working shift with its hours', async () => {
    const stored = await put(TODAY, {
      sleepMinutes: 330,
      stress: 'high',
      workShift: 'night',
      shiftStartMinute: 1320,
      shiftEndMinute: 360,
    });
    expect(stored).toEqual({
      localDate: TODAY,
      sleepMinutes: 330,
      stress: 'high',
      workShift: 'night',
      shiftStartMinute: 1320,
      shiftEndMinute: 360,
      source: 'manual',
      recordedAt: at(60),
    });
    expect(await list()).toEqual([stored]);
  });

  it('stores a check-in with every answer empty (AC2)', async () => {
    const stored = await put(TODAY, { sleepMinutes: null, stress: null });
    expect(stored).toMatchObject({ sleepMinutes: null, stress: null, workShift: null });
  });

  it('keeps one row per day when the same check-in is sent twice', async () => {
    await put(TODAY);
    await put(TODAY);
    expect(await list()).toHaveLength(1);
  });

  it('lets the later recordedAt win, in either order of arrival', async () => {
    await put(TODAY, { sleepMinutes: 450, recordedAt: at(120) });
    const response = await put(TODAY, { sleepMinutes: 270, recordedAt: at(60) });
    // The older write loses and the response carries the newer one.
    expect(response?.sleepMinutes).toBe(450);
    expect((await list())[0]!.sleepMinutes).toBe(450);
    await put(TODAY, { sleepMinutes: 330, recordedAt: at(180) });
    expect((await list())[0]!.sleepMinutes).toBe(330);
  });

  it('accepts a day up to a year back and rejects one in the future or older (AC15)', async () => {
    await put(addDays(TODAY, -366));
    for (const [localDate, error] of [
      [addDays(TODAY, 1), 'in_future'],
      [addDays(TODAY, -367), 'too_old'],
    ] as const) {
      const res = await t.call('PUT', `/me/checkins/${localDate}`, body());
      expect(res.status).toBe(400);
      expect((await errorOf(res)).fields).toEqual({ localDate: error });
    }
  });

  it('rejects a device clock more than a day ahead of the server (AC15)', async () => {
    const res = await t.call('PUT', `/me/checkins/${TODAY}`, body({ recordedAt: at(86_401) }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ recordedAt: 'in_future' });
  });

  it('rejects an implausible local date', async () => {
    const res = await t.call(
      'PUT',
      `/me/checkins/${addDays(TODAY, -5)}`,
      body({ today: addDays(TODAY, -3) }),
    );
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ today: 'implausible' });
  });

  it('rejects a working shift without hours and hours on a day off', async () => {
    for (const payload of [
      body({ workShift: 'morning' }),
      body({ workShift: 'off', shiftStartMinute: 360, shiftEndMinute: 840 }),
      body({ sleepMinutes: 961 }),
    ]) {
      const res = await t.call('PUT', `/me/checkins/${TODAY}`, payload);
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe('validation_error');
    }
  });

  it("never touches another user's check-in of the same day", async () => {
    await put(TODAY, { sleepMinutes: 450 });
    const other = await t.tokens.sign({ sub: OTHER_USER_ID });
    await t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION }, other);
    const res = await t.call(
      'PUT',
      `/me/checkins/${TODAY}`,
      body({ sleepMinutes: 270, recordedAt: at(300) }),
      other,
    );
    expect(CheckinSaveResponseSchema.parse(await res.json()).checkin?.sleepMinutes).toBe(270);
    expect((await list()).map((c) => c.sleepMinutes)).toEqual([450]);
  });
});

describe('DELETE /me/checkins/{localDate} (spec 011 AC5, AC15)', () => {
  beforeEach(consent);

  it('deletes the check-in of the day', async () => {
    await put(TODAY);
    expect(await remove(TODAY)).toBeNull();
    expect(await list()).toEqual([]);
  });

  it('is not undone by a later-arriving write with an earlier recordedAt', async () => {
    await put(TODAY, { recordedAt: at(60) });
    await remove(TODAY, at(120));
    expect(await put(TODAY, { recordedAt: at(90) })).toBeNull();
    expect(await list()).toEqual([]);
    // A newer write brings it back.
    expect(await put(TODAY, { recordedAt: at(180), sleepMinutes: 510 })).toMatchObject({
      sleepMinutes: 510,
    });
  });

  it('loses against a newer write and returns it', async () => {
    await put(TODAY, { recordedAt: at(180), sleepMinutes: 450 });
    expect(await remove(TODAY, at(120))).toMatchObject({ sleepMinutes: 450 });
    expect(await list()).toHaveLength(1);
  });

  it('keeps a delete that arrives before its check-in from winning over it later', async () => {
    await remove(TODAY, at(120));
    expect(await put(TODAY, { recordedAt: at(60) })).toBeNull();
    expect(await list()).toEqual([]);
  });

  it('moves a tombstone forward with a newer delete, so a write between the two loses', async () => {
    await remove(TODAY, at(120));
    await remove(TODAY, at(200));
    expect(await put(TODAY, { recordedAt: at(150) })).toBeNull();
    expect(await list()).toEqual([]);
  });

  it('rejects a day in the future and a device clock far ahead', async () => {
    const future = await t.call(
      'DELETE',
      `/me/checkins/${addDays(TODAY, 1)}?recordedAt=${encodeURIComponent(at(0))}&today=${TODAY}`,
    );
    expect(future.status).toBe(400);
    const ahead = await t.call(
      'DELETE',
      `/me/checkins/${TODAY}?recordedAt=${encodeURIComponent(at(86_401))}&today=${TODAY}`,
    );
    expect(ahead.status).toBe(400);
    expect((await errorOf(ahead)).fields).toEqual({ recordedAt: 'in_future' });
  });
});

describe('GET /me/checkins (spec 011)', () => {
  beforeEach(consent);

  it('lists the range oldest first, without deleted check-ins', async () => {
    await put(TODAY, { sleepMinutes: 450 });
    await put(addDays(TODAY, -2), { sleepMinutes: 330 });
    await put(addDays(TODAY, -1), { sleepMinutes: 390 });
    await remove(addDays(TODAY, -1));
    await put(addDays(TODAY, -40), { sleepMinutes: 510 });
    expect((await list()).map((c) => [c.localDate, c.sleepMinutes])).toEqual([
      [addDays(TODAY, -2), 330],
      [TODAY, 450],
    ]);
  });

  it('rejects `from` after `to` and a range over 92 days', async () => {
    const reversed = await t.call('GET', `/me/checkins?from=${TODAY}&to=${addDays(TODAY, -1)}`);
    expect(reversed.status).toBe(400);
    expect((await errorOf(reversed)).fields).toEqual({ from: 'after_to' });
    const long = await t.call('GET', `/me/checkins?from=${addDays(TODAY, -93)}&to=${TODAY}`);
    expect(long.status).toBe(400);
    expect((await errorOf(long)).fields).toEqual({ to: 'too_big' });
    expect(await list(addDays(TODAY, -92), TODAY)).toEqual([]);
  });
});

describe('GET /me/export (spec 011 AC16)', () => {
  beforeEach(consent);

  it('includes every check-in, deleted ones with deletedAt', async () => {
    await put(addDays(TODAY, -1), { sleepMinutes: 330 });
    await put(TODAY, { sleepMinutes: 450 });
    await remove(addDays(TODAY, -1));
    const data = ExportResponseSchema.parse(await (await t.call('GET', '/me/export')).json());
    expect(data.checkins.map((c) => [c.localDate, c.sleepMinutes, c.deletedAt !== null])).toEqual([
      [addDays(TODAY, -1), 330, true],
      [TODAY, 450, false],
    ]);
  });
});
