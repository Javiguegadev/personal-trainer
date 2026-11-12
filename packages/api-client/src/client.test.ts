import { CONSENT_VERSION } from '@pt/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, isApiError } from './client';
import { meBody, profileInput } from './test/fixtures';

const BASE = 'http://api.test';
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
            consents: [],
            aiUsage: [],
          }),
      },
      {
        run: (a: Api) => a.deleteAccount(),
        method: 'DELETE',
        path: '/me',
        res: () => new Response(null, { status: 204 }),
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
