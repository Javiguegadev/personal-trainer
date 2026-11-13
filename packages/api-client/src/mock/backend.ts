/**
 * In-memory implementation of `ApiClient` for development and E2E tests (no Supabase, no cost).
 * It applies the same rules as apps/api: auth (401), consent (403), Zod validation (400 with `fields`),
 * and @pt/core safety and targets (422 `age_blocked`).
 * Never use it in production builds: the app enables it only with `__DEV__` and an explicit flag.
 */
import {
  CONSENT_VERSION,
  ConsentRequestSchema,
  ProfileInputSchema,
  WEIGHT_LIMITS,
  WeightDateParamSchema,
  WeightDeleteQuerySchema,
  WeightListQuerySchema,
  WeightUpsertRequestSchema,
  type ApiErrorCode,
  type DietaryPrefs,
  type ExportResponse,
  type MeResponse,
  type Profile,
  type WeightEntry,
  type WeightSaveResponse,
} from '@pt/contracts';
import {
  applyLatestWeight,
  checkWeightWrite,
  daysBetween,
  evaluateProfileInput,
  targetsOnly,
} from '@pt/core';
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
  /** The weight log, sorted by day. */
  weights: WeightEntry[];
}

type MockDb = Record<string, UserRecord>;

/** Storage key of the mock database. The suffix changes with the shape of the stored rows (spec 003). */
export const MOCK_DB_KEY = 'pt.mock-db.v3';

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
  weights: [],
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

  const activeConsent = (record: UserRecord) =>
    record.consents.findLast((c) => c.kind === 'health_data' && c.revokedAt === null);
  // A consent given to an older version of the text does not count (spec 002 AC14).
  const hasConsent = (record: UserRecord) => activeConsent(record)?.version === CONSENT_VERSION;

  async function authenticateWithConsent() {
    const session = await authenticate();
    if (!hasConsent(session.record)) throw fail('consent_required');
    return session;
  }

  function toMe(userId: string, record: UserRecord): MeResponse {
    const consent = activeConsent(record);
    const current = record.targets.find((t) => t.validTo === null);
    return {
      userId,
      consent: { healthData: hasConsent(record), version: consent?.version ?? null },
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

  const currentTargets = (record: UserRecord) => {
    const current = record.targets.find((t) => t.validTo === null);
    return current ? targetsOnly(current) : null;
  };

  function putWeight(record: UserRecord, entry: WeightEntry) {
    record.weights = [...record.weights.filter((w) => w.localDate !== entry.localDate), entry].sort(
      (a, b) => (a.localDate < b.localDate ? -1 : 1),
    );
  }

  /** After a weight write: the latest entry becomes the profile weight (spec 003 AC10–AC13). */
  function afterWeightWrite(
    record: UserRecord,
    localDate: string,
    today: string,
  ): WeightSaveResponse {
    const entry = record.weights.find((w) => w.localDate === localDate) ?? null;
    if (!record.profile) return { entry, targetsChange: null };
    const change = applyLatestWeight(
      record.profile,
      currentTargets(record),
      record.weights.at(-1) ?? null,
      today,
      record.weights,
    );
    if (change) {
      const at = now().toISOString();
      record.profile = {
        ...record.profile,
        weightKg: change.weightKg,
        goal: change.goal,
        safetyFlags: change.safetyFlags,
      };
      if (change.targetsChange) {
        for (const row of record.targets) if (row.validTo === null) row.validTo = at;
        const { current } = change.targetsChange;
        if (current) record.targets.push({ ...current, validFrom: at, validTo: null });
      }
    }
    persist();
    return { entry, targetsChange: change?.targetsChange ?? null };
  }

  function evaluate(body: unknown, record: UserRecord) {
    const input = parse(ProfileInputSchema, body);
    const evaluation = evaluateProfileInput(input, record.profile?.safetyFlags ?? [], now(), {
      storedWeightKg: record.profile?.weightKg ?? null,
      entries: record.weights,
    });
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
      // A new profile, or a weight typed in the profile form, is today's entry (spec 003 AC13).
      if (record.profile?.weightKg !== input.weightKg) {
        putWeight(record, { localDate: input.today, weightKg: input.weightKg, recordedAt: at });
      }
      record.profile = {
        sex: input.sex,
        birthDate: input.birthDate,
        heightCm: input.heightCm,
        weightKg: input.weightKg,
        targetWeightKg: input.targetWeightKg,
        jobActivity: input.jobActivity,
        plannedActivities: input.plannedActivities,
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

    listWeights: async (query) => {
      const { record } = await authenticateWithConsent();
      const { from, to } = parse(WeightListQuerySchema, query);
      if (from > to) throw fail('validation_error', { from: 'after_to' });
      if (daysBetween(from, to) > WEIGHT_LIMITS.listDaysMax) {
        throw fail('validation_error', { to: 'too_big' });
      }
      return { entries: record.weights.filter((w) => w.localDate >= from && w.localDate <= to) };
    },

    saveWeight: async (day, body) => {
      const { record } = await authenticateWithConsent();
      const { localDate } = parse(WeightDateParamSchema, { localDate: day });
      const input = parse(WeightUpsertRequestSchema, body);
      const invalid = checkWeightWrite({ localDate, ...input }, now());
      if (invalid) throw fail('validation_error', invalid);
      if (!record.profile) throw fail('validation_error', { profile: 'required' });
      const stored = record.weights.find((w) => w.localDate === localDate);
      // The write recorded later on its device wins (AC20).
      if (!stored || Date.parse(stored.recordedAt) <= Date.parse(input.recordedAt)) {
        putWeight(record, {
          localDate,
          weightKg: input.weightKg,
          recordedAt: new Date(input.recordedAt).toISOString(),
        });
      }
      return afterWeightWrite(record, localDate, input.today);
    },

    deleteWeight: async (day, query) => {
      const { record } = await authenticateWithConsent();
      const { localDate } = parse(WeightDateParamSchema, { localDate: day });
      const { today } = parse(WeightDeleteQuerySchema, query);
      const invalid = checkWeightWrite({ localDate, today }, now());
      if (invalid) throw fail('validation_error', invalid);
      if (!record.profile) throw fail('validation_error', { profile: 'required' });
      record.weights = record.weights.filter((w) => w.localDate !== localDate);
      return afterWeightWrite(record, localDate, today);
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
        weights: record.weights,
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
