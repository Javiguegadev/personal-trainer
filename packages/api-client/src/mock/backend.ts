/**
 * In-memory implementation of `ApiClient` for development and E2E tests (no Supabase, no cost).
 * It applies the same rules as apps/api: auth (401), consent (403), Zod validation (400 with `fields`),
 * and @pt/core safety and targets (422 `age_blocked`).
 * Never use it in production builds: the app enables it only with `__DEV__` and an explicit flag.
 */
import {
  ConsentRequestSchema,
  ProfileInputSchema,
  type ApiErrorCode,
  type DietaryPrefs,
  type ExportResponse,
  type MeResponse,
  type Profile,
} from '@pt/contracts';
import { evaluateProfileInput } from '@pt/core';
import type { z } from 'zod';
import { ApiError, type ApiClient } from '../client';
import { parseMockToken, type MockUser } from './identity';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MockApiClientOptions {
  getAccessToken: () => Promise<string | null>;
  onUnauthorized?: () => void;
  /** Persists the mock database between reloads (e.g. localStorage). In memory when omitted. */
  storage?: KeyValueStorage;
  now?: () => Date;
  /** Artificial delay per call, so loading states are visible. */
  latencyMs?: number;
}

interface UserRecord {
  email: string | null;
  consents: ExportResponse['consents'];
  profile: Profile | null;
  dietaryPrefs: DietaryPrefs | null;
  /** Full history; the current row has `validTo: null`. */
  targets: ExportResponse['targets'];
  aiUsage: ExportResponse['aiUsage'];
}

type MockDb = Record<string, UserRecord>;

export const MOCK_DB_KEY = 'pt.mock.db.v1';

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

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  consent_required: 403,
  validation_error: 400,
  age_blocked: 422,
  rate_limited: 429,
  ai_unavailable: 503,
  not_found: 404,
  internal_error: 500,
};

const fail = (code: ApiErrorCode, fields?: Record<string, string>) =>
  new ApiError(STATUS[code], code, MESSAGES[code], fields);

/** Same shape as the API's `fieldErrors` (apps/api/src/http.ts). */
function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    fields[key] ??= issue.code;
  }
  return fields;
}

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw fail('validation_error', fieldErrors(result.error));
  return result.data;
}

const emptyUser = (email: string | null): UserRecord => ({
  email,
  consents: [],
  profile: null,
  dietaryPrefs: null,
  targets: [],
  aiUsage: [],
});

export function createMockApiClient({
  getAccessToken,
  onUnauthorized,
  storage,
  now = () => new Date(),
  latencyMs = 0,
}: MockApiClientOptions): ApiClient {
  const db: MockDb = (() => {
    try {
      const raw = storage?.getItem(MOCK_DB_KEY);
      return raw ? (JSON.parse(raw) as MockDb) : {};
    } catch {
      return {};
    }
  })();
  const persist = () => storage?.setItem(MOCK_DB_KEY, JSON.stringify(db));
  const wait = () =>
    latencyMs > 0
      ? new Promise<void>((resolve) => setTimeout(resolve, latencyMs))
      : Promise.resolve();

  async function authenticate(): Promise<{ user: MockUser; record: UserRecord }> {
    await wait();
    const user = parseMockToken(await getAccessToken());
    if (!user) {
      onUnauthorized?.();
      throw fail('unauthorized');
    }
    const record = (db[user.userId] ??= emptyUser(user.email));
    return { user, record };
  }

  const hasConsent = (record: UserRecord) =>
    record.consents.some((c) => c.kind === 'health_data' && c.revokedAt === null);

  async function authenticateWithConsent() {
    const session = await authenticate();
    if (!hasConsent(session.record)) throw fail('consent_required');
    return session;
  }

  function toMe(userId: string, record: UserRecord): MeResponse {
    const consent = record.consents.findLast(
      (c) => c.kind === 'health_data' && c.revokedAt === null,
    );
    const current = record.targets.find((t) => t.validTo === null);
    return {
      userId,
      consent: { healthData: consent !== undefined, version: consent?.version ?? null },
      onboardingCompleted: record.profile?.onboardingCompletedAt != null,
      profile: record.profile,
      dietaryPrefs: record.dietaryPrefs,
      targets: current
        ? {
            kcal: current.kcal,
            proteinG: current.proteinG,
            carbsG: current.carbsG,
            fatG: current.fatG,
            fiberG: current.fiberG,
            formulaVersion: current.formulaVersion,
            clampedReason: current.clampedReason,
            validFrom: current.validFrom,
          }
        : null,
    };
  }

  function evaluate(body: unknown, record: UserRecord) {
    const input = parse(ProfileInputSchema, body);
    const evaluation = evaluateProfileInput(input, record.profile?.safetyFlags ?? [], now());
    if (evaluation.kind === 'invalid') throw fail('validation_error', evaluation.fields);
    if (evaluation.kind === 'blocked') throw fail('age_blocked');
    return { input, evaluation };
  }

  return {
    health: async () => {
      await wait();
      return { status: 'ok', service: 'api (mock)', version: 'mock', time: now().toISOString() };
    },

    me: async () => {
      const { user, record } = await authenticate();
      return toMe(user.userId, record);
    },

    grantConsent: async (body) => {
      const { record } = await authenticate();
      const consent = parse(ConsentRequestSchema, body);
      record.consents.push({
        kind: consent.kind,
        version: consent.version,
        grantedAt: now().toISOString(),
        revokedAt: null,
      });
      persist();
    },

    updateProfile: async (body) => {
      const { user, record } = await authenticateWithConsent();
      const { input, evaluation } = evaluate(body, record);
      const at = now().toISOString();
      record.profile = {
        sex: input.sex,
        birthDate: input.birthDate,
        heightCm: input.heightCm,
        weightKg: input.weightKg,
        targetWeightKg: input.targetWeightKg,
        activityLevel: input.activityLevel,
        requestedGoal: input.goal,
        goal: evaluation.safety.appliedGoal,
        safetyFlags: evaluation.flags,
        injuries: input.injuries?.trim() || null,
        units: input.units,
        locale: input.locale,
        onboardingCompletedAt: record.profile?.onboardingCompletedAt ?? at,
      };
      record.dietaryPrefs = input.dietaryPrefs;
      for (const row of record.targets) if (row.validTo === null) row.validTo = at;
      if (evaluation.targets)
        record.targets.push({ ...evaluation.targets, validFrom: at, validTo: null });
      persist();
      return toMe(user.userId, record);
    },

    targetsPreview: async (body) => {
      const { record } = await authenticateWithConsent();
      const { evaluation } = evaluate(body, record);
      return {
        targets: evaluation.targets,
        breakdown: evaluation.breakdown,
        safety: evaluation.safety,
      };
    },

    exportData: async () => {
      const { user, record } = await authenticate();
      return {
        exportedAt: now().toISOString(),
        userId: user.userId,
        email: record.email,
        profile: record.profile,
        dietaryPrefs: record.dietaryPrefs,
        targets: record.targets,
        consents: record.consents,
        aiUsage: record.aiUsage,
      };
    },

    deleteAccount: async () => {
      const { user } = await authenticate();
      delete db[user.userId];
      persist();
    },
  };
}
