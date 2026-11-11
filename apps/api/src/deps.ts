import type { AiUsage, OnboardingTurnResult } from '@pt/ai';
import type {
  ConsentKind,
  DietaryPrefs,
  ExportResponse,
  OnboardingChatRequest,
  Profile,
  SafetyFlag,
  StoredTargets,
  Targets,
} from '@pt/contracts';

/** The signed-in user, taken from a verified Supabase access token. */
export interface AuthUser {
  userId: string;
  email: string | null;
}

/** Returns the user for a valid access token, or null (expired, bad signature, wrong audience…). */
export type VerifyToken = (token: string) => Promise<AuthUser | null>;

export interface MeRecord {
  consentVersion: string | null;
  profile: Profile | null;
  dietaryPrefs: DietaryPrefs | null;
  targets: StoredTargets | null;
}

export interface ProfileWrite {
  profile: Omit<Profile, 'onboardingCompletedAt'>;
  dietaryPrefs: DietaryPrefs;
  /** Null when safety rules do not allow numeric targets: the current row is closed, nothing is inserted. */
  targets: Targets | null;
}

export type ExportRecord = Omit<ExportResponse, 'exportedAt' | 'userId' | 'email'>;

/** Persistence port. Real implementation: `store/drizzle-store.ts`; tests use an in-memory fake. */
export interface Store {
  getMe(userId: string): Promise<MeRecord>;
  /** Active (not revoked) consent of this kind. */
  hasConsent(userId: string, kind: ConsentKind): Promise<boolean>;
  grantConsent(userId: string, kind: ConsentKind, version: string, at: Date): Promise<void>;
  /** Flags stored on the profile (empty when there is no profile yet). */
  getSafetyFlags(userId: string): Promise<SafetyFlag[]>;
  /** Upserts profile + prefs, closes the current targets row and inserts the new one (AC16). */
  saveProfile(userId: string, data: ProfileWrite, at: Date): Promise<void>;
  countAiCalls(userId: string, feature: string, since: Date): Promise<number>;
  recordAiUsage(userId: string, usage: AiUsage, at: Date): Promise<void>;
  exportUser(userId: string): Promise<ExportRecord>;
}

/** Supabase Auth admin (service key, server only). Deleting the auth user cascades to every user row. */
export interface AuthAdmin {
  deleteUser(userId: string): Promise<void>;
}

/** One onboarding chat turn. Null when the AI is not configured (no API key): the API answers 503. */
export type OnboardingAi =
  ((request: OnboardingChatRequest) => Promise<OnboardingTurnResult>) | null;

export interface Deps {
  verifyToken: VerifyToken;
  store: Store;
  authAdmin: AuthAdmin;
  onboardingAi: OnboardingAi;
  now: () => Date;
}
