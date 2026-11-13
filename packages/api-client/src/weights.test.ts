import { CONSENT_VERSION, type WeightEntry, type WeightSaveResponse } from '@pt/contracts';
import {
  MutationObserver,
  QueryClient,
  dehydrate,
  hydrate,
  onlineManager,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { queryKeys } from './hooks';
import { createMockApiClient } from './mock/backend';
import { mockAccessToken, mockUserFromEmail } from './mock/identity';
import { profileInput } from './test/fixtures';
import {
  registerWeightMutations,
  weightKeys,
  weightsQueryOptions,
  withWeightDay,
  type DeleteWeightVariables,
  type SaveWeightVariables,
} from './weights';

const NOW = new Date('2026-11-11T10:00:00.000Z');
const TODAY = '2026-11-11';
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();

/** A signed-in user with a stored profile (60 kg, entry of today) on the mock backend. */
async function setup() {
  const token = mockAccessToken(mockUserFromEmail('ana@example.com'));
  const api = createMockApiClient({ getAccessToken: async () => token, now: () => NOW });
  await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
  await api.updateProfile(profileInput);
  return { api, ...client(api) };
}

function client(api: ReturnType<typeof createMockApiClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  registerWeightMutations(queryClient, api);
  const save = (variables: SaveWeightVariables) =>
    new MutationObserver<WeightSaveResponse, unknown, SaveWeightVariables>(queryClient, {
      mutationKey: weightKeys.save,
    }).mutate(variables);
  const remove = (variables: DeleteWeightVariables) =>
    new MutationObserver<WeightSaveResponse, unknown, DeleteWeightVariables>(queryClient, {
      mutationKey: weightKeys.remove,
    }).mutate(variables);
  const cached = () => queryClient.getQueryData<WeightEntry[]>(weightKeys.list) ?? [];
  const load = () => queryClient.fetchQuery(weightsQueryOptions(api, TODAY));
  return { queryClient, save, remove, cached, load };
}

const stored = async (api: Awaited<ReturnType<typeof setup>>['api']) =>
  (await api.listWeights({ from: '2026-01-01', to: TODAY })).entries;

/** Lets the optimistic update (which awaits a cancel) reach the cache. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => onlineManager.setOnline(true));

describe('withWeightDay', () => {
  const entries = [
    { localDate: '2026-11-09', weightKg: 61, recordedAt: at(0) },
    { localDate: '2026-11-11', weightKg: 60, recordedAt: at(0) },
  ];

  it('replaces, adds in date order and removes', () => {
    const added = withWeightDay(entries, '2026-11-10', {
      localDate: '2026-11-10',
      weightKg: 60.5,
      recordedAt: at(1),
    });
    expect(added.map((e) => e.localDate)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    const replaced = withWeightDay(entries, '2026-11-11', { ...entries[1]!, weightKg: 59.8 });
    expect(replaced.map((e) => e.weightKg)).toEqual([61, 59.8]);
    expect(withWeightDay(entries, '2026-11-09', null)).toEqual([entries[1]]);
    expect(withWeightDay(entries, '2026-01-01', null)).toEqual(entries);
  });
});

describe('weights query', () => {
  it('loads the entries of the last year', async () => {
    const { api, load } = await setup();
    await api.saveWeight('2025-11-11', { weightKg: 64, recordedAt: at(1), today: TODAY });
    await api.saveWeight('2025-11-10', { weightKg: 65, recordedAt: at(1), today: TODAY });
    expect((await load()).map((e) => e.localDate)).toEqual(['2025-11-11', TODAY]);
  });
});

describe('weight mutations (spec 003 AC18–AC21)', () => {
  it('shows the entry at once, then the stored one, and announces the targets change', async () => {
    const { api, queryClient, save, cached, load } = await setup();
    await load();
    queryClient.setQueryData(queryKeys.me, await api.me());

    const pending = save({ localDate: TODAY, weightKg: 58, recordedAt: at(60), today: TODAY });
    await tick();
    expect(cached().at(-1)).toMatchObject({ localDate: TODAY, weightKg: 58 });

    const response = await pending;
    expect(response.targetsChange).not.toBeNull();
    expect(queryClient.getQueryData(weightKeys.targetsChange)).toEqual(response.targetsChange);
    expect(cached()).toEqual(await stored(api));
    // The profile weight and the targets changed: /me is refetched.
    expect(queryClient.getQueryState(queryKeys.me)?.isInvalidated).toBe(true);
  });

  it('removes the entry at once', async () => {
    const { api, remove, cached, load } = await setup();
    await load();
    const pending = remove({ localDate: TODAY, today: TODAY });
    await tick();
    expect(cached()).toEqual([]);
    await pending;
    expect(await stored(api)).toEqual([]);
  });

  it('queues a write made offline and sends it once after a restart (AC18, AC19)', async () => {
    const { api, queryClient, save, cached, load } = await setup();
    await load();
    onlineManager.setOnline(false);

    void save({ localDate: '2026-11-10', weightKg: 60.4, recordedAt: at(60), today: TODAY });
    void save({ localDate: TODAY, weightKg: 59.9, recordedAt: at(90), today: TODAY });
    await tick();
    expect(cached().map((e) => e.weightKg)).toEqual([60.4, 59.9]);
    expect(queryClient.isMutating({ mutationKey: weightKeys.mutations })).toBe(2);
    expect((await stored(api)).map((e) => e.weightKg)).toEqual([60]);

    // The app is closed: only the dehydrated state survives.
    const saved = JSON.parse(JSON.stringify(dehydrate(queryClient))) as ReturnType<
      typeof dehydrate
    >;
    expect(saved.mutations).toHaveLength(2);

    const restarted = client(api);
    hydrate(restarted.queryClient, saved);
    expect(restarted.cached().map((e) => e.weightKg)).toEqual([60.4, 59.9]);

    onlineManager.setOnline(true);
    await restarted.queryClient.resumePausedMutations();
    expect((await stored(api)).map((e) => [e.localDate, e.weightKg])).toEqual([
      ['2026-11-10', 60.4],
      [TODAY, 59.9],
    ]);
    expect(restarted.queryClient.isMutating()).toBe(0);
    // The queued entry reached the server now: its targets change is announced now.
    expect(restarted.queryClient.getQueryData(weightKeys.targetsChange)).not.toBeNull();
  });

  it('undoes a write the API rejects and says why (AC21)', async () => {
    const { api, queryClient, save, cached, load } = await setup();
    await load();
    const before = cached();
    await expect(
      save({ localDate: TODAY, weightKg: 20, recordedAt: at(60), today: TODAY }),
    ).rejects.toMatchObject({ status: 400 });
    expect(cached()).toEqual(before);
    expect(queryClient.getQueryData(weightKeys.rejected)).toEqual({
      localDate: TODAY,
      code: 'validation_error',
      fields: { weightKg: 'too_small' },
    });
    expect(await stored(api)).toEqual(before);
  });

  it('keeps retrying a write that fails with a network error or a 5xx (AC21)', async () => {
    const { api, load } = await setup();
    let failures = 2;
    const flaky = {
      ...api,
      saveWeight: (...args: Parameters<typeof api.saveWeight>) => {
        if (failures-- > 0) return Promise.reject(new TypeError('Network request failed'));
        return api.saveWeight(...args);
      },
    };
    const { queryClient, save } = client(flaky);
    queryClient.setMutationDefaults(weightKeys.save, {
      ...queryClient.getMutationDefaults(weightKeys.save),
      retryDelay: 0,
    });
    await load();
    await save({ localDate: TODAY, weightKg: 59, recordedAt: at(60), today: TODAY });
    expect((await stored(api)).map((e) => e.weightKg)).toEqual([59]);
    expect(queryClient.getQueryData(weightKeys.rejected)).toBeNull();
  });
});
