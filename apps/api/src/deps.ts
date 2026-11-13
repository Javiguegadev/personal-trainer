import type { AiUsage } from '@pt/ai';
import type {
  ConsentKind,
  DietaryPrefs,
  ExportResponse,
  JobActivity,
  Profile,
  SafetyFlag,
  StoredTargets,
  Targets,
  WeightEntry,
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
  profile: Omit<Profile, 'onboardingCompletedAt' | 'jobActivity'> & { jobActivity: JobActivity };
  dietaryPrefs: DietaryPrefs;
  /** Null when safety rules do not allow numeric targets: the current row is closed, nothing is inserted. */
  targets: Targets | null;
  /**
   * The user's day. When the profile is new or its weight changed, the weight is also stored as the
   * entry of this day (spec 003 AC13).
   */
  today: string;
}

export interface SafetyContext {
  /** Empty when there is no profile yet. */
  flags: SafetyFlag[];
  /** Null when there is no profile yet. */
  weightKg: number | null;
  weights: WeightEntry[];
}

/** A weight write: the entry to store for that day, or null to delete it. */
export interface WeightWrite {
  localDate: string;
  /** First day of `WeightState.recent`. */
  recentFrom: string;
  entry: { weightKg: number; recordedAt: string } | null;
}

/** What `writeWeight` shows its `decide` callback, read inside the transaction after the write. */
export interface WeightState {
  profile: Profile;
  targets: StoredTargets | null;
  /** The user's most recent entry by day, after the write. */
  latest: WeightEntry | null;
  /** The entries from `WeightWrite.recentFrom` on, after the write, oldest first. */
  recent: WeightEntry[];
}

/** The profile after the most recent weight changed (spec 003 AC10). */
export interface WeightDecision {
  weightKg: number;
  goal: Profile['goal'];
  safetyFlags: SafetyFlag[];
  /** Set when the targets differ: the current row is closed and this one is inserted (null = none). */
  newTargets?: Targets | null;
}

export interface WeightWriteResult {
  /** The entry stored for that day after the write. */
  entry: WeightEntry | null;
  /** The targets before the write. */
  previousTargets: StoredTargets | null;
}

export type ExportRecord = Omit<ExportResponse, 'exportedAt' | 'userId' | 'email'>;

/** Persistence port. Real implementation: `store/drizzle-store.ts`; tests use an in-memory fake. */
export interface Store {
  getMe(userId: string): Promise<MeRecord>;
  /** Whether the latest active (not revoked) consent of this kind is for this version of the text. */
  hasConsent(userId: string, kind: ConsentKind, version: string): Promise<boolean>;
  grantConsent(userId: string, kind: ConsentKind, version: string, at: Date): Promise<void>;
  /**
   * What the safety rules need besides the form: the stored flags (`ed_soft_stop` is sticky), the stored
   * weight and the weight entries from `weightsFrom` on (the low-BMI recovery rule, spec 003 AC12).
   */
  getSafetyContext(userId: string, weightsFrom: string): Promise<SafetyContext>;
  /**
   * In one transaction: upserts profile, job and prefs, replaces the training list, closes the current
   * targets row and inserts the new one (spec 001 AC16, spec 002 AC5).
   */
  saveProfile(userId: string, data: ProfileWrite, at: Date): Promise<void>;
  /** Entries dated from `from` to `to` (inclusive), oldest first. */
  listWeights(userId: string, from: string, to: string): Promise<WeightEntry[]>;
  /**
   * In one transaction (spec 003 AC8–AC10, AC20): stores the entry unless the stored one was recorded
   * later, or deletes it; then asks `decide` what the profile becomes and applies it. Returns null when
   * the user has no profile (nothing is written).
   */
  writeWeight(
    userId: string,
    write: WeightWrite,
    decide: (state: WeightState) => WeightDecision | null,
    at: Date,
  ): Promise<WeightWriteResult | null>;
  recordAiUsage(userId: string, usage: AiUsage, at: Date): Promise<void>;
  exportUser(userId: string): Promise<ExportRecord>;
}

/** Supabase Auth admin (service key, server only). Deleting the auth user cascades to every user row. */
export interface AuthAdmin {
  deleteUser(userId: string): Promise<void>;
}

export interface Deps {
  verifyToken: VerifyToken;
  store: Store;
  authAdmin: AuthAdmin;
  now: () => Date;
}
