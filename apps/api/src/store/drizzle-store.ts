import type { ConsentKind, PlannedActivity, SafetyFlag } from '@pt/contracts';
import { SafetyFlagSchema } from '@pt/contracts';
import { and, asc, desc, eq, gte, isNull, lte, schema, sql, type Db } from '@pt/db';
import type { Store } from '../deps';

const {
  aiUsage,
  bodyMeasurements,
  consents,
  dietaryPrefs,
  lifestyleProfiles,
  nutritionTargets,
  plannedActivities,
  profiles,
  trainingProfiles,
} = schema;

type ProfileRow = typeof profiles.$inferSelect;
type PrefsRow = typeof dietaryPrefs.$inferSelect;
type LifestyleRow = typeof lifestyleProfiles.$inferSelect;
type TrainingRow = typeof trainingProfiles.$inferSelect;
type ActivityRow = typeof plannedActivities.$inferSelect;
type TargetsRow = typeof nutritionTargets.$inferSelect;
type WeightRow = typeof bodyMeasurements.$inferSelect;

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
  training: TrainingRow | undefined,
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
    // Every profile has a row after migration 0005 (spec 004 AC13); null only for safety.
    trainingFocus: training?.focus ?? null,
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

function toWeight(row: WeightRow) {
  return {
    localDate: row.localDate,
    weightKg: row.weightKg,
    recordedAt: row.recordedAt.toISOString(),
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
  const trainingOf = (userId: string) =>
    db.select().from(trainingProfiles).where(eq(trainingProfiles.userId, userId));
  const activitiesOf = (userId: string) =>
    db
      .select()
      .from(plannedActivities)
      .where(eq(plannedActivities.userId, userId))
      .orderBy(asc(plannedActivities.position));

  return {
    async getMe(userId) {
      const [[consent], [profile], [lifestyle], [training], activities, [prefs], [targets]] =
        await Promise.all([
          activeConsent(userId, 'health_data'),
          db.select().from(profiles).where(eq(profiles.id, userId)),
          lifestyleOf(userId),
          trainingOf(userId),
          activitiesOf(userId),
          db.select().from(dietaryPrefs).where(eq(dietaryPrefs.userId, userId)),
          db
            .select()
            .from(nutritionTargets)
            .where(and(eq(nutritionTargets.userId, userId), isNull(nutritionTargets.validTo)))
            .orderBy(desc(nutritionTargets.validFrom))
            .limit(1),
        ]);
      return {
        consentVersion: consent?.version ?? null,
        profile: profile ? toProfile(profile, lifestyle, training, activities) : null,
        dietaryPrefs: prefs ? toPrefs(prefs) : null,
        targets: targets ? toTargets(targets) : null,
      };
    },

    async hasConsent(userId, kind, version) {
      const [latest] = await activeConsent(userId, kind);
      return latest?.version === version;
    },

    async grantConsent(userId, kind, version, at) {
      await db.insert(consents).values({ userId, kind, version, grantedAt: at });
    },

    async getSafetyContext(userId, weightsFrom) {
      const [[row], weights] = await Promise.all([
        db
          .select({ flags: profiles.safetyFlags, weightKg: profiles.weightKg })
          .from(profiles)
          .where(eq(profiles.id, userId)),
        db
          .select()
          .from(bodyMeasurements)
          .where(
            and(eq(bodyMeasurements.userId, userId), gte(bodyMeasurements.localDate, weightsFrom)),
          )
          .orderBy(asc(bodyMeasurements.localDate)),
      ]);
      return {
        flags: row ? toFlags(row.flags) : [],
        weightKg: row?.weightKg ?? null,
        weights: weights.map(toWeight),
      };
    },

    async saveProfile(userId, data, at) {
      await db.transaction(async (tx) => {
        const {
          jobActivity,
          trainingFocus,
          plannedActivities: activities,
          ...profile
        } = data.profile;
        const values = { id: userId, ...profile, updatedAt: at };
        const [stored] = await tx
          .select({ weightKg: profiles.weightKg })
          .from(profiles)
          .where(eq(profiles.id, userId));
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

        // A new profile, or a weight typed in the profile form, is today's entry (spec 003 AC13).
        if (stored?.weightKg !== profile.weightKg) {
          const entry = { weightKg: profile.weightKg, recordedAt: at, updatedAt: at };
          await tx
            .insert(bodyMeasurements)
            .values({ userId, localDate: data.today, ...entry })
            .onConflictDoUpdate({
              target: [bodyMeasurements.userId, bodyMeasurements.localDate],
              set: entry,
            });
        }

        const lifestyle = { userId, jobActivity, updatedAt: at };
        await tx
          .insert(lifestyleProfiles)
          .values(lifestyle)
          .onConflictDoUpdate({ target: lifestyleProfiles.userId, set: lifestyle });

        const training = { userId, focus: trainingFocus, updatedAt: at };
        await tx
          .insert(trainingProfiles)
          .values(training)
          .onConflictDoUpdate({ target: trainingProfiles.userId, set: training });

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

    async listWeights(userId, from, to) {
      const rows = await db
        .select()
        .from(bodyMeasurements)
        .where(
          and(
            eq(bodyMeasurements.userId, userId),
            gte(bodyMeasurements.localDate, from),
            lte(bodyMeasurements.localDate, to),
          ),
        )
        .orderBy(asc(bodyMeasurements.localDate));
      return rows.map(toWeight);
    },

    async writeWeight(userId, write, decide, at) {
      return db.transaction(async (tx) => {
        // The row lock serialises the writes of one user, so "most recent entry" is read consistently.
        const [profile] = await tx
          .select()
          .from(profiles)
          .where(eq(profiles.id, userId))
          .for('update');
        if (!profile) return null;

        const day = and(
          eq(bodyMeasurements.userId, userId),
          eq(bodyMeasurements.localDate, write.localDate),
        );
        if (write.entry) {
          const entry = {
            weightKg: write.entry.weightKg,
            recordedAt: new Date(write.entry.recordedAt),
            updatedAt: at,
          };
          await tx
            .insert(bodyMeasurements)
            .values({ userId, localDate: write.localDate, ...entry })
            .onConflictDoUpdate({
              target: [bodyMeasurements.userId, bodyMeasurements.localDate],
              set: entry,
              // The write recorded later on its device wins, whatever the order of arrival (AC20).
              setWhere: lte(bodyMeasurements.recordedAt, entry.recordedAt),
            });
        } else {
          await tx.delete(bodyMeasurements).where(day);
        }

        const [[entry], [latest], recent, [lifestyle], [training], activities, [targets]] =
          await Promise.all([
            tx.select().from(bodyMeasurements).where(day),
            tx
              .select()
              .from(bodyMeasurements)
              .where(eq(bodyMeasurements.userId, userId))
              .orderBy(desc(bodyMeasurements.localDate))
              .limit(1),
            tx
              .select()
              .from(bodyMeasurements)
              .where(
                and(
                  eq(bodyMeasurements.userId, userId),
                  gte(bodyMeasurements.localDate, write.recentFrom),
                ),
              )
              .orderBy(asc(bodyMeasurements.localDate)),
            tx.select().from(lifestyleProfiles).where(eq(lifestyleProfiles.userId, userId)),
            tx.select().from(trainingProfiles).where(eq(trainingProfiles.userId, userId)),
            tx
              .select()
              .from(plannedActivities)
              .where(eq(plannedActivities.userId, userId))
              .orderBy(asc(plannedActivities.position)),
            tx
              .select()
              .from(nutritionTargets)
              .where(and(eq(nutritionTargets.userId, userId), isNull(nutritionTargets.validTo)))
              .orderBy(desc(nutritionTargets.validFrom))
              .limit(1),
          ]);
        const previousTargets = targets ? toTargets(targets) : null;

        const decision = decide({
          profile: toProfile(profile, lifestyle, training, activities),
          targets: previousTargets,
          latest: latest ? toWeight(latest) : null,
          recent: recent.map(toWeight),
        });
        if (decision) {
          await tx
            .update(profiles)
            .set({
              weightKg: decision.weightKg,
              goal: decision.goal,
              safetyFlags: decision.safetyFlags,
              updatedAt: at,
            })
            .where(eq(profiles.id, userId));
          if (decision.newTargets !== undefined) {
            await tx
              .update(nutritionTargets)
              .set({ validTo: at })
              .where(and(eq(nutritionTargets.userId, userId), isNull(nutritionTargets.validTo)));
            if (decision.newTargets) {
              await tx
                .insert(nutritionTargets)
                .values({ userId, ...decision.newTargets, validFrom: at });
            }
          }
        }
        return { entry: entry ? toWeight(entry) : null, previousTargets };
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
      const [
        [profile],
        [lifestyle],
        [training],
        activities,
        [prefs],
        targets,
        consentRows,
        usageRows,
        weights,
      ] = await Promise.all([
        db.select().from(profiles).where(eq(profiles.id, userId)),
        lifestyleOf(userId),
        trainingOf(userId),
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
        db
          .select()
          .from(bodyMeasurements)
          .where(eq(bodyMeasurements.userId, userId))
          .orderBy(asc(bodyMeasurements.localDate)),
      ]);
      return {
        profile: profile ? toProfile(profile, lifestyle, training, activities) : null,
        dietaryPrefs: prefs ? toPrefs(prefs) : null,
        targets: targets.map((t) => ({
          ...toTargets(t),
          validTo: t.validTo?.toISOString() ?? null,
        })),
        weights: weights.map(toWeight),
        // The food log tables arrive with the db step of spec 005; the export reads them from then on.
        mealItems: [],
        favouriteFoods: [],
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
