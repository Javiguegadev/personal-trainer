import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './index';

const okBody = { status: 'ok', service: 'api', version: '0.0.0', time: '2026-01-01T00:00:00.000Z' };

describe('createApiClient', () => {
  it('parses a valid health response and sends the bearer token', async () => {
    const fetchImpl = vi.fn(async () => Response.json(okBody));
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: async () => 'tok',
      fetchImpl,
    });

    await expect(api.health()).resolves.toEqual(okBody);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
  });

  it('throws ApiError on non-2xx', async () => {
    const api = createApiClient({
      baseUrl: 'http://api.test',
      fetchImpl: async () => new Response('nope', { status: 503 }),
    });
    await expect(api.health()).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects responses that do not match the contract', async () => {
    const api = createApiClient({
      baseUrl: 'http://api.test',
      fetchImpl: async () => Response.json({ status: 'down' }),
    });
    await expect(api.health()).rejects.toThrow();
  });
});
