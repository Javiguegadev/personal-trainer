import { CONSENT_VERSION, type MealItem, type ProfileInput, type WeightEntry } from '@pt/contracts';
import { addDays } from '@pt/core';
import { createMockApiClient, MOCK_DB_KEY, type KeyValueStorage } from '../mock/backend';
import { mockAccessToken, mockUserFromEmail } from '../mock/identity';
import { profileInput } from './fixtures';

/**
 * A mock backend with a weekly-review history (spec 014). The profile is saved on Wednesday 11 November
 * 2026, so the first review is on Monday 7 December (21 days later, then the next Monday): it reviews
 * the week of Monday 30 November.
 */
export const ONBOARDED = '2026-11-11';
export const FIRST_REVIEW = '2026-12-07';
export const REVIEWED_WEEK = '2026-11-30';

const user = mockUserFromEmail('ana@example.com');

/** The rows of the mock database a test seeds (the rest of the record is left as it is). */
interface SeedRecord {
  weights: WeightEntry[];
  mealItems: (MealItem & { deleted: boolean })[];
  profile: { safetyFlags: string[] } | null;
}

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const meal = (localDate: string, kcal: number): MealItem & { deleted: boolean } => ({
  id: `5e000000-0000-4000-8000-${localDate.replaceAll('-', '').padStart(12, '0')}`,
  localDate,
  mealType: 'lunch',
  foodId: null,
  servingId: null,
  servings: null,
  servingLabel: null,
  grams: null,
  unit: 'g',
  label: 'Menú',
  nutrients: { kcal, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null },
  inputMethod: 'quick_add',
  plannedItemId: null,
  recordedAt: `${localDate}T12:00:00.000Z`,
  deleted: false,
});

export function reviewHistory() {
  const storage = memoryStorage();
  let now = new Date(`${ONBOARDED}T10:00:00.000Z`);
  const open = () =>
    createMockApiClient({
      getAccessToken: async () => mockAccessToken(user),
      storage,
      now: () => now,
    });
  let api = open();

  /** Changes the stored rows, then reopens the backend so it reads them. */
  const seed = (mutate: (record: SeedRecord) => void) => {
    const db = JSON.parse(storage.getItem(MOCK_DB_KEY)!) as Record<string, SeedRecord>;
    mutate(db[user.userId]!);
    storage.setItem(MOCK_DB_KEY, JSON.stringify(db));
    api = open();
  };

  return {
    /** The backend as last opened (`seed` reopens it). */
    api: () => api,
    /** Sets the server clock to `day`, 10:00 UTC, and returns `day` (the app's today). */
    at: (day: string) => {
      now = new Date(`${day}T10:00:00.000Z`);
      return day;
    },
    /** Consent and a profile that wants to lose weight, saved on `ONBOARDED`. */
    onboard: async (overrides: Partial<ProfileInput> = {}) => {
      await api.grantConsent({ kind: 'health_data', version: CONSENT_VERSION });
      return api.updateProfile({
        ...profileInput,
        goal: 'lose',
        targetWeightKg: 55,
        today: ONBOARDED,
        ...overrides,
      });
    },
    seed,
    /** Four weeks before the first review (9 November to 6 December): a flat weight, `kcal` a day. */
    seedSlowLoss: (kcal: number) =>
      seed((record) => {
        const days = Array.from({ length: 28 }, (_, i) => addDays('2026-11-09', i));
        record.weights = days.map((localDate) => ({
          localDate,
          weightKg: profileInput.weightKg,
          recordedAt: `${localDate}T07:00:00.000Z`,
        }));
        record.mealItems = days.map((day) => meal(day, kcal));
      }),
  };
}
