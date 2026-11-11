import { HealthResponseSchema } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createTestApp } from './test/fakes';

const app = createApp({ webOrigins: ['http://localhost:8081'], version: 'test' });

describe('GET /health', () => {
  it('returns a response matching the shared contract', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.version).toBe('test');
  });

  it('sets CORS headers for the Expo web origin', async () => {
    const res = await app.request('/health', { headers: { origin: 'http://localhost:8081' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8081');
  });
});

describe('GET /openapi.json', () => {
  it('documents the health route', async () => {
    const res = await app.request('/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths).toHaveProperty('/health');
  });
});

describe('user routes', () => {
  it('are documented in /openapi.json when deps are configured', async () => {
    const { app: full } = await createTestApp();
    const doc = (await (await full.request('/openapi.json')).json()) as {
      paths: Record<string, unknown>;
    };
    for (const path of [
      '/me',
      '/me/consent',
      '/me/profile',
      '/me/export',
      '/onboarding/chat',
      '/onboarding/targets-preview',
    ]) {
      expect(doc.paths).toHaveProperty([path]);
    }
  });

  it('are not mounted without deps (missing env in dev)', async () => {
    const res = await app.request('/me');
    expect(res.status).toBe(404);
  });
});
