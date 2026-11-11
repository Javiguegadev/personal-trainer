import {
  ApiErrorSchema,
  ExportResponseSchema,
  HealthResponseSchema,
  MeResponseSchema,
  OnboardingChatResponseSchema,
  TargetsPreviewResponseSchema,
  type ApiErrorCode,
  type ConsentRequest,
  type ExportResponse,
  type HealthResponse,
  type MeResponse,
  type OnboardingChatRequest,
  type OnboardingChatResponse,
  type ProfileInput,
  type TargetsPreviewResponse,
} from '@pt/contracts';
import type { z } from 'zod';

/** Code used when the response body is not an `ApiErrorSchema` body (proxy error, network, …). */
const FALLBACK_CODES: Partial<Record<number, ApiErrorCode>> = {
  400: 'validation_error',
  401: 'unauthorized',
  404: 'not_found',
  429: 'rate_limited',
};

/**
 * Error thrown for every non-2xx response. `code` maps to the i18n key `errors.<code>`;
 * `fields` maps a field path to an error code (AC22).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown, code?: ApiErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
  /** Called on every 401 (expired or revoked session), e.g. to sign out locally. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

async function toApiError(res: Response, fallbackMessage: string): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, fields } = parsed.data;
    return new ApiError(res.status, code, message, fields);
  }
  return new ApiError(res.status, FALLBACK_CODES[res.status] ?? 'internal_error', fallbackMessage);
}

export function createApiClient({
  baseUrl,
  getAccessToken,
  onUnauthorized,
  fetchImpl = fetch,
}: ApiClientOptions) {
  async function send(path: string, init: RequestInit & { json?: unknown } = {}) {
    const { json, ...rest } = init;
    const headers = new Headers(rest.headers);
    headers.set('accept', 'application/json');
    if (json !== undefined) headers.set('content-type', 'application/json');
    const token = await getAccessToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);

    const res = await fetchImpl(new URL(path, baseUrl), {
      ...rest,
      headers,
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });
    if (!res.ok) {
      if (res.status === 401) onUnauthorized?.();
      throw await toApiError(res, `${rest.method ?? 'GET'} ${path} failed (${res.status})`);
    }
    return res;
  }

  async function request<S extends z.ZodType>(
    path: string,
    schema: S,
    init: RequestInit & { json?: unknown } = {},
  ): Promise<z.infer<S>> {
    const res = await send(path, init);
    return schema.parse(await res.json());
  }

  return {
    health: (): Promise<HealthResponse> => request('/health', HealthResponseSchema),

    /** `GET /me`: profile, prefs, current targets, consent and onboarding status. */
    me: (): Promise<MeResponse> => request('/me', MeResponseSchema),

    /** `POST /me/consent` (AC6). */
    grantConsent: async (body: ConsentRequest): Promise<void> => {
      await send('/me/consent', { method: 'POST', json: body });
    },

    /** `PUT /me/profile`: stores profile + prefs + new targets (AC10, AC11, AC16). */
    updateProfile: (body: ProfileInput): Promise<MeResponse> =>
      request('/me/profile', MeResponseSchema, { method: 'PUT', json: body }),

    /** `POST /onboarding/chat` (AC8). The client keeps the transcript; the server stores nothing. */
    onboardingChat: (body: OnboardingChatRequest): Promise<OnboardingChatResponse> =>
      request('/onboarding/chat', OnboardingChatResponseSchema, { method: 'POST', json: body }),

    /** `POST /onboarding/targets-preview`: targets + safety, nothing stored (AC10, AC13–AC19). */
    targetsPreview: (body: ProfileInput): Promise<TargetsPreviewResponse> =>
      request('/onboarding/targets-preview', TargetsPreviewResponseSchema, {
        method: 'POST',
        json: body,
      }),

    /** `GET /me/export` (AC23). The caller turns it into a file (platform-specific). */
    exportData: (): Promise<ExportResponse> => request('/me/export', ExportResponseSchema),

    /** `DELETE /me` (AC24). The caller then signs out locally. */
    deleteAccount: async (): Promise<void> => {
      await send('/me', { method: 'DELETE' });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
