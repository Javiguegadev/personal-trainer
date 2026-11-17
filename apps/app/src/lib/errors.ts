import { isApiError } from '@pt/api-client';
import type { Messages } from '@pt/i18n';
import { AuthError } from './auth';

/** Translated, user-facing message for any error thrown by auth or the API. */
export function errorMessage(error: unknown, t: Messages): string {
  if (error instanceof AuthError) return t.auth.errors[error.code];
  if (isApiError(error)) return t.errors[error.code];
  // fetch() rejects with a TypeError when the network or the server is unreachable.
  if (error instanceof TypeError) return t.errors.network;
  return t.errors.unknown;
}
