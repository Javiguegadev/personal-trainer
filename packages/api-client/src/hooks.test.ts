import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';
import {
  afterAccountDeleted,
  afterConsent,
  afterProfileSaved,
  meQueryOptions,
  queryKeys,
  shouldRetry,
  targetsPreviewQueryOptions,
} from './hooks';
import { meBody, profileInput } from './test/fixtures';

function apiReturning(body: unknown) {
  const fetchImpl = vi.fn(async () => Response.json(body));
  return {
    api: createApiClient({
      baseUrl: 'http://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
    fetchImpl,
  };
}

describe('shouldRetry', () => {
  it('never retries 4xx errors (401, 403 consent, 422 age, 429)', () => {
    for (const [status, code] of [
      [401, 'unauthorized'],
      [403, 'consent_required'],
      [422, 'age_blocked'],
      [429, 'rate_limited'],
    ] as const) {
      expect(shouldRetry(0, new ApiError(status, code, 'x'))).toBe(false);
    }
  });

  it('retries 5xx and network errors twice', () => {
    const error = new ApiError(503, 'ai_unavailable', 'x');
    expect(shouldRetry(0, error)).toBe(true);
    expect(shouldRetry(1, error)).toBe(true);
    expect(shouldRetry(2, error)).toBe(false);
    expect(shouldRetry(0, new TypeError('Network request failed'))).toBe(true);
  });
});

describe('query options', () => {
  it('fetches /me under the me key', async () => {
    const { api } = apiReturning(meBody);
    const queryClient = new QueryClient();
    await expect(queryClient.fetchQuery(meQueryOptions(api))).resolves.toEqual(meBody);
    expect(queryClient.getQueryData(queryKeys.me)).toEqual(meBody);
  });

  it('keys the targets preview on the profile input', async () => {
    const preview = {
      targets: null,
      breakdown: null,
      safety: {
        status: 'ok',
        requestedGoal: 'maintain',
        appliedGoal: 'maintain',
        flags: [],
        maxSurplusRatio: null,
        targetsAllowed: false,
      },
    };
    const { api, fetchImpl } = apiReturning(preview);
    const queryClient = new QueryClient();
    await queryClient.fetchQuery(targetsPreviewQueryOptions(api, profileInput));
    await queryClient.fetchQuery(targetsPreviewQueryOptions(api, { ...profileInput }));
    expect(fetchImpl).toHaveBeenCalledOnce();

    await queryClient.fetchQuery(
      targetsPreviewQueryOptions(api, { ...profileInput, weightKg: 61 }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('cache updates', () => {
  it('refetches /me after consent (AC6)', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.me, meBody);
    await afterConsent(queryClient);
    expect(queryClient.getQueryState(queryKeys.me)?.isInvalidated).toBe(true);
  });

  it('writes the saved profile response to the /me cache (AC10, AC16)', () => {
    const queryClient = new QueryClient();
    const saved = { ...meBody, onboardingCompleted: true };
    afterProfileSaved(queryClient, saved);
    expect(queryClient.getQueryData(queryKeys.me)).toEqual(saved);
  });

  it('drops every cached query after deleting the account (AC24)', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.me, meBody);
    queryClient.setQueryData(queryKeys.targetsPreview(profileInput), {});
    afterAccountDeleted(queryClient);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
