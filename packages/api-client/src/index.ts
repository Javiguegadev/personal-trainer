/**
 * @pt/api-client — typed client for apps/api, shared by web and mobile.
 * Every response is validated against @pt/contracts at runtime.
 * TanStack Query hooks are added here (Phase 2+) so both platforms reuse them.
 */
import { HealthResponseSchema, type HealthResponse } from '@pt/contracts';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export function createApiClient({ baseUrl, getAccessToken, fetchImpl = fetch }: ApiClientOptions) {
  async function request<S extends z.ZodType>(
    path: string,
    schema: S,
    init: RequestInit = {},
  ): Promise<z.infer<S>> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    const token = await getAccessToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);

    const res = await fetchImpl(new URL(path, baseUrl), { ...init, headers });
    if (!res.ok) throw new ApiError(res.status, `${init.method ?? 'GET'} ${path} failed`);
    return schema.parse(await res.json());
  }

  return {
    health: (): Promise<HealthResponse> => request('/health', HealthResponseSchema),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
