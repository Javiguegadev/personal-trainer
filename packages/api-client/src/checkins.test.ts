import { CONSENT_VERSION, type CheckinSaveResponse, type DailyCheckin } from '@pt/contracts';
import {
  MutationObserver,
  QueryClient,
  dehydrate,
  hydrate,
  onlineManager,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkinKeys,
  checkinRange,
  checkinsQueryOptions,
  registerCheckinMutations,
  withCheckinDay,
  type DeleteCheckinVariables,
  type SaveCheckinVariables,
} from './checkins';
import { createMockApiClient } from './mock/backend';
import { mockAccessToken, mockUserFromEmail } from './mock/identity';

const NOW = new Date('2026-11-23T08:00:00.000Z');
const TODAY = '2026-11-23'; // Monday
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();

const answers = {
  sleepMinutes: 390,
  stress: 'normal',
  workShift: null,
  shiftStartMinute: null,
  shiftEndMinute: null,
} as const;
const saveVars = (overrides: Partial<SaveCheckinVariables> = {}): SaveCheckinVariables => ({
  localDate: TODAY,
  ...answers,
  recordedAt: at(60),
  today: TODAY,
  ...overrides,
});

/** A signed-in user with consent on the mock backend. */
async function setup() {
  const token = mockAccessToken(mockUserFromEmail('ana@example.com'));
  const api = createMockApiClient({ getAccessToken: async () => token, now: () => NOW });
  await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
  return { api, ...client(api) };
}

function client(api: ReturnType<typeof createMockApiClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  registerCheckinMutations(queryClient, api);
  const save = (variables: SaveCheckinVariables) =>
    new MutationObserver<CheckinSaveResponse, unknown, SaveCheckinVariables>(queryClient, {
      mutationKey: checkinKeys.save,
    }).mutate(variables);
  const remove = (variables: DeleteCheckinVariables) =>
    new MutationObserver<CheckinSaveResponse, unknown, DeleteCheckinVariables>(queryClient, {
      mutationKey: checkinKeys.remove,
    }).mutate(variables);
  const cached = () => queryClient.getQueryData<DailyCheckin[]>(checkinKeys.list) ?? [];
  const load = () => queryClient.fetchQuery(checkinsQueryOptions(api, TODAY));
  return { queryClient, save, remove, cached, load };
}

const stored = async (api: Awaited<ReturnType<typeof setup>>['api']) =>
  (await api.listCheckins(checkinRange(TODAY))).checkins;

/** Lets the optimistic update (which awaits a cancel) reach the cache. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => onlineManager.setOnline(true));

describe('checkinRange', () => {
  it('reaches the Monday 12 weeks back, within the 92 days of the API', () => {
    expect(checkinRange(TODAY)).toEqual({ from: '2026-08-31', to: TODAY });
    expect(checkinRange('2026-11-29')).toEqual({ from: '2026-08-31', to: '2026-11-29' }); // Sunday
  });
});

describe('withCheckinDay', () => {
  const day = (localDate: string, sleepMinutes: number): DailyCheckin => ({
    localDate,
    ...answers,
    sleepMinutes,
    source: 'manual',
    recordedAt: at(0),
  });

  it('replaces, adds in date order and removes', () => {
    const list = [day('2026-11-20', 330), day(TODAY, 450)];
    expect(
      withCheckinDay(list, '2026-11-21', day('2026-11-21', 390)).map((c) => c.localDate),
    ).toEqual(['2026-11-20', '2026-11-21', TODAY]);
    expect(withCheckinDay(list, TODAY, day(TODAY, 270)).map((c) => c.sleepMinutes)).toEqual([
      330, 270,
    ]);
    expect(withCheckinDay(list, '2026-11-20', null)).toEqual([list[1]]);
  });
});

describe('check-in mutations (spec 011 AC14)', () => {
  it('shows the check-in at once, then the stored one', async () => {
    const { api, save, cached, load } = await setup();
    await load();
    const pending = save(saveVars({ sleepMinutes: 330, stress: 'high' }));
    await tick();
    expect(cached()).toEqual([
      {
        localDate: TODAY,
        ...answers,
        sleepMinutes: 330,
        stress: 'high',
        source: 'manual',
        recordedAt: at(60),
      },
    ]);
    await pending;
    expect(cached()).toEqual(await stored(api));
  });

  it('removes the check-in at once, and the delete wins over an older write', async () => {
    const { api, save, remove, cached, load } = await setup();
    await load();
    await save(saveVars({ recordedAt: at(60) }));
    const pending = remove({ localDate: TODAY, recordedAt: at(120), today: TODAY });
    await tick();
    expect(cached()).toEqual([]);
    await pending;
    expect(await stored(api)).toEqual([]);
    // An older write arriving late cannot bring it back.
    await save(saveVars({ recordedAt: at(90) }));
    expect(cached()).toEqual([]);
  });

  it('queues writes made offline and sends them once after a restart', async () => {
    const { api, queryClient, save, remove, cached, load } = await setup();
    await load();
    onlineManager.setOnline(false);

    void save(saveVars({ localDate: '2026-11-22', sleepMinutes: 450, recordedAt: at(30) }));
    void save(saveVars({ sleepMinutes: 330, recordedAt: at(60) }));
    void save(saveVars({ sleepMinutes: 270, recordedAt: at(90) }));
    void remove({ localDate: '2026-11-22', recordedAt: at(120), today: TODAY });
    await tick();
    expect(cached().map((c) => [c.localDate, c.sleepMinutes])).toEqual([[TODAY, 270]]);
    expect(queryClient.isMutating({ mutationKey: checkinKeys.mutations })).toBe(4);
    expect(await stored(api)).toEqual([]);

    // The app is closed: only the dehydrated state survives.
    const saved = JSON.parse(JSON.stringify(dehydrate(queryClient))) as ReturnType<
      typeof dehydrate
    >;
    expect(saved.mutations).toHaveLength(4);
    const restarted = client(api);
    hydrate(restarted.queryClient, saved);
    expect(restarted.cached().map((c) => c.sleepMinutes)).toEqual([270]);

    onlineManager.setOnline(true);
    await restarted.queryClient.resumePausedMutations();
    expect((await stored(api)).map((c) => [c.localDate, c.sleepMinutes])).toEqual([[TODAY, 270]]);
    expect(restarted.queryClient.isMutating()).toBe(0);
  });

  it('undoes a write the API rejects and says why', async () => {
    const { queryClient, save, cached, load } = await setup();
    await load();
    await expect(save(saveVars({ localDate: '2026-11-24' }))).rejects.toMatchObject({
      status: 400,
    });
    expect(cached()).toEqual([]);
    expect(queryClient.getQueryData(checkinKeys.rejected)).toEqual({
      localDate: '2026-11-24',
      code: 'validation_error',
      fields: { localDate: 'in_future' },
    });
  });

  it('keeps retrying a write that fails with a network error', async () => {
    const { api, load } = await setup();
    let failures = 2;
    const flaky = {
      ...api,
      saveCheckin: (...args: Parameters<typeof api.saveCheckin>) => {
        if (failures-- > 0) return Promise.reject(new TypeError('Network request failed'));
        return api.saveCheckin(...args);
      },
    };
    const { queryClient, save } = client(flaky);
    queryClient.setMutationDefaults(checkinKeys.save, {
      ...queryClient.getMutationDefaults(checkinKeys.save),
      retryDelay: 0,
    });
    await load();
    await save(saveVars());
    expect((await stored(api)).map((c) => c.sleepMinutes)).toEqual([390]);
    expect(queryClient.getQueryData(checkinKeys.rejected)).toBeNull();
  });
});

describe('mock backend check-ins (spec 011 AC15, AC16)', () => {
  it('keeps one row per day and exports deleted ones with deletedAt', async () => {
    const { api } = await setup();
    const body = { ...answers, recordedAt: at(60), today: TODAY };
    await api.saveCheckin(TODAY, body);
    await api.saveCheckin(TODAY, body);
    await api.saveCheckin('2026-11-22', { ...body, recordedAt: at(10) });
    await api.deleteCheckin('2026-11-22', { recordedAt: at(20), today: TODAY });
    expect((await stored(api)).map((c) => c.localDate)).toEqual([TODAY]);
    const data = await api.exportData();
    expect(data.checkins.map((c) => [c.localDate, c.deletedAt !== null])).toEqual([
      ['2026-11-22', true],
      [TODAY, false],
    ]);
  });
});
