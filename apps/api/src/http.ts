import { OpenAPIHono } from '@hono/zod-openapi';
import type { ApiErrorBody, ApiErrorCode } from '@pt/contracts';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import type { AuthUser } from './deps';

/** Hono env for authenticated routers: `requireAuth` sets `user`. */
export interface AuthEnv {
  Variables: { user: AuthUser };
}

const MESSAGES: Record<ApiErrorCode, string> = {
  unauthorized: 'A valid access token is required',
  consent_required: 'Health-data consent is required',
  validation_error: 'Invalid request',
  age_blocked: 'This app is not available under 16',
  rate_limited: 'Too many requests, try again later',
  ai_unavailable: 'The assistant is unavailable, use the form instead',
  not_found: 'Not found',
  internal_error: 'Something went wrong',
};

export function errorBody(code: ApiErrorCode, fields?: Record<string, string>): ApiErrorBody {
  return fields ? { code, message: MESSAGES[code], fields } : { code, message: MESSAGES[code] };
}

export function apiError<S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  code: ApiErrorCode,
  fields?: Record<string, string>,
) {
  return c.json(errorBody(code, fields), status);
}

/** Zod issues → `{ "heightCm": "too_big", "dietaryPrefs.allergies.0": "too_big" }` (AC22). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    fields[key] ??= issue.code;
  }
  return fields;
}

/** Router whose request validation failures use the shared error shape. */
export function createRouter() {
  return new OpenAPIHono<AuthEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(errorBody('validation_error', fieldErrors(result.error)), 400);
      }
    },
  });
}
