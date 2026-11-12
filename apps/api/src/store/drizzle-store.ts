import type { ConsentKind, PlannedActivity, SafetyFlag } from '@pt/contracts';
import { SafetyFlagSchema } from '@pt/contracts';
import { and, asc, desc, eq, isNull, schema, sql, type Db } from '@pt/db';
import type { Store } from '../deps';

const {
  aiUsage,
  consents,
  dietaryPrefs,
  lifestyleProfiles,
  nutritionTargets,
  plannedActivities,
  profiles,
} = schema;

type ProfileRow = typeof profiles.$inferSelect;
type PrefsRow = typeof dietaryPrefs.$inferSelect;
type LifestyleRow = typeof lifestyleProfiles.$inferSelect;
type ActivityRow = typeof plannedActivities.$inferSelect;
type TargetsRow = typeof nutritionTargets.$inferSelect;

/** Unknown values (e.g. a flag removed from the contract) are dropped instead of failing the response. */
function toFlags(values: readonly string[]): SafetyFlag[] {
  return values.flatMap((v) => {
    const parsed = SafetyFlagSchema.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  });
}

function toActivity(row: ActivityRow): PlannedActivity {
  return {
    kind: row.kind,
    label: row.label,
    sessionsPerWeek: row.sessionsPerWeek,
    minutesPerSession: row.minutesPerSession,
    intensity: row.intensity,
  };
}

function toProfile(
  row: ProfileRow,
  lifestyle: LifestyleRow | undefined,
  activities: ActivityRow[],
) {
  return {
    sex: row.sex,
    birthDate: row.birthDate,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    targetWeightKg: row.targetWeightKg,
    // Null for an account created before spec 002 that has not filled in the form again (AC17).
    jobActivity: lifestyle?.jobActivity ?? null,
    plannedActivities: activities.map(toActivity),
    requestedGoal: row.requestedGoal,
    goal: row.goal,
    safetyFlags: toFlags(row.safetyFlags),
    injuries: row.injuries,
    units: row.units,
    locale: row.locale,
    onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
  };
}

function toPrefs(row: PrefsRow) {
  return {
    dietType: row.dietType,
    allergies: row.allergies,
    dislikes: row.dislikes,
    restrictions: row.restrictions,
  };
}

function toTargets(row: TargetsRow) {
  return {
    kcal: row.kcal,
    proteinG: row.proteinG,
    carbsG: row.carbsG,
    fatG: row.fatG,
    fiberG: row.fiberG,
    formulaVersion: row.formulaVersion,
    clampedReason: row.clampedReason,
    validFrom: row.validFrom.toISOString(),
  };
}

export function createDrizzleStore(db: Db): Store {
  const activeConsent = (userId: string, kind: ConsentKind) =>
    db
      .select({ version: consents.version })
      .from(consents)
      .where(and(eq(consents.userId, userId), eq(consents.kind, kind), isNull(consents.revokedAt)))
      .orderBy(desc(consents.grantedAt))
      .limit(1);

  const lifestyleOf = (userId: string) =>
    db.select().from(lifestyleProfiles).where(eq(lifestyleProfiles.userId, userId));
  const activitiesOf = (userId: string) =>
    db
      .select()
      .from(plannedActivities)
      .where(eq(plannedActivities.userId, userId))
      .orderBy(asc(plannedActivities.position));

  return {
    async getMe(userId) {
      const [[consent], [profile], [lifestyle], activities, [prefs], [targets]] = await Promise.all(
        [
          activeConsent(userId, 'health_data'),
          db.select().from(profiles).where(eq(profiles.id, userId)),
          lifestyleOf(userId),
          activitiesOf(userId),
          db.select().from(dietaryPrefs).where(eq(dietaryPrefs.userId, userId)),
          db
            .select()
            .from(nutritionTargets)
            .where(and(eq(nutritionTargets.userId, userId), isNull(nutritionTargets.validTo)))
            .orderBy(desc(nutritionTargets.validFrom))
            .limit(1),
        ],
      );
      return {
        consentVersion: consent?.version ?? null,
        profile: profile ? toProfile(profile, lifestyle, activities) : null,
        dietaryPrefs: prefs ? toPrefs(prefs) : null,
        targets: targets ? toTargets(targets) : null,
      };
    },

    async hasConsent(userId, kind) {
      return (await activeConsent(userId, kind)).length > 0;
    },

    async grantConsent(userId, kind, version, at) {
      await db.insert(consents).values({ userId, kind, version, grantedAt: at });
    },

    async getSafetyFlags(userId) {
      const [row] = await db
        .select({ flags: profiles.safetyFlags })
        .from(profiles)
        .where(eq(profiles.id, userId));
      return row ? toFlags(row.flags) : [];
    },

    async saveProfile(userId, data, at) {
      await db.transaction(async (tx) => {
        const { jobActivity, plannedActivities: activities, ...profile } = data.profile;
        const values = { id: userId, ...profile, updatedAt: at };
        await tx
          .insert(profiles)
          .values({ ...values, onboardingCompletedAt: at })
          .onConflictDoUpdate({
            target: profiles.id,
            set: {
              ...values,
              // Keeps its first value on later edits (Settings, AC16); set again when a migration
              // cleared it (spec 002 AC17).
              onboardingCompletedAt: sql`coalesce(${profiles.onboardingCompletedAt}, ${at.toISOString()}::timestamptz)`,
            },
          });

        const lifestyle = { userId, jobActivity, updatedAt: at };
        await tx
          .insert(lifestyleProfiles)
          .values(lifestyle)
          .onConflictDoUpdate({ target: lifestyleProfiles.userId, set: lifestyle });

        // The list is small (at most 6 rows) and has no history: replace it.
        await tx.delete(plannedActivities).where(eq(plannedActivities.userId, userId));
        if (activities.length > 0) {
          await tx
            .insert(plannedActivities)
            .values(activities.map((activity, position) => ({ userId, ...activity, position })));
        }

        const prefs = { userId, ...data.dietaryPrefs, updatedAt: at };
        await tx
          .insert(dietaryPrefs)
          .values(prefs)
          .onConflictDoUpdate({ target: dietaryPrefs.userId, set: prefs });

        await tx
          .update(nutritionTargets)
          .set({ validTo: at })
          .where(and(eq(nutritionTargets.userId, userId), isNull(nutritionTargets.validTo)));
        if (data.targets) {
          await tx.insert(nutritionTargets).values({ userId, ...data.targets, validFrom: at });
        }
      });
    },

    async recordAiUsage(userId, usage, at) {
      await db.insert(aiUsage).values({
        userId,
        feature: usage.feature,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsd,
        latencyMs: usage.latencyMs,
        status: usage.status,
        createdAt: at,
      });
    },

    async exportUser(userId) {
      const [[profile], [lifestyle], activities, [prefs], targets, consentRows, usageRows] =
        await Promise.all([
          db.select().from(profiles).where(eq(profiles.id, userId)),
          lifestyleOf(userId),
          activitiesOf(userId),
          db.select().from(dietaryPrefs).where(eq(dietaryPrefs.userId, userId)),
          db
            .select()
            .from(nutritionTargets)
            .where(eq(nutritionTargets.userId, userId))
            .orderBy(desc(nutritionTargets.validFrom)),
          db
            .select()
            .from(consents)
            .where(eq(consents.userId, userId))
            .orderBy(desc(consents.grantedAt)),
          db
            .select()
            .from(aiUsage)
            .where(eq(aiUsage.userId, userId))
            .orderBy(desc(aiUsage.createdAt)),
        ]);
      return {
        profile: profile ? toProfile(profile, lifestyle, activities) : null,
        dietaryPrefs: prefs ? toPrefs(prefs) : null,
        targets: targets.map((t) => ({
          ...toTargets(t),
          validTo: t.validTo?.toISOString() ?? null,
        })),
        consents: consentRows.map((c) => ({
          kind: c.kind,
          version: c.version,
          grantedAt: c.grantedAt.toISOString(),
          revokedAt: c.revokedAt?.toISOString() ?? null,
        })),
        aiUsage: usageRows.map((u) => ({
          feature: u.feature,
          model: u.model,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          createdAt: u.createdAt.toISOString(),
        })),
      };
    },
  };
}
