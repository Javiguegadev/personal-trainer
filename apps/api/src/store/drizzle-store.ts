import type {
  ActivityDay,
  ConsentKind,
  PlannedActivity,
  SafetyFlag,
  WorkBlock,
} from '@pt/contracts';
import { SafetyFlagSchema } from '@pt/contracts';
import { and, asc, count, desc, eq, gte, isNull, lte, schema, sql, type Db } from '@pt/db';
import type { Store } from '../deps';
import { createCheckinStore, exportCheckins } from './checkin-store';
import { createFoodStore, exportFoodLog } from './food-store';
import { createTrainingStore, exportTrainingLog } from './training-store';

const {
  aiUsage,
  bodyMeasurements,
  consents,
  dietaryPrefs,
  lifestyleProfiles,
  nutritionTargets,
  plannedActivities,
  plannedActivityDays,
  profiles,
  trainingProfiles,
  workBlocks,
} = schema;

type ProfileRow = typeof profiles.$inferSelect;
type PrefsRow = typeof dietaryPrefs.$inferSelect;
type LifestyleRow = typeof lifestyleProfiles.$inferSelect;
type TrainingRow = typeof trainingProfiles.$inferSelect;
type ActivityRow = typeof plannedActivities.$inferSelect;
type DayRow = typeof plannedActivityDays.$inferSelect;
type WorkBlockRow = typeof workBlocks.$inferSelect;
type TargetsRow = typeof nutritionTargets.$inferSelect;
type WeightRow = typeof bodyMeasurements.$inferSelect;
type Reader = Pick<Db, 'select'>;
type Writer = Pick<Db, 'insert' | 'delete'>;

/** What `toProfile` needs besides the profile row: the user's rows of the other profile tables. */
interface ProfileRows {
  lifestyle: LifestyleRow | undefined;
  training: TrainingRow | undefined;
  activities: ActivityRow[];
  days: DayRow[];
  blocks: WorkBlockRow[];
}

/** The rows of the other profile tables, read with `reader` (the db or a transaction). */
async function loadProfileRows(reader: Reader, userId: string): Promise<ProfileRows> {
  const [[lifestyle], [training], activities, days, blocks] = await Promise.all([
    reader.select().from(lifestyleProfiles).where(eq(lifestyleProfiles.userId, userId)),
    reader.select().from(trainingProfiles).where(eq(trainingProfiles.userId, userId)),
    reader
      .select()
      .from(plannedActivities)
      .where(eq(plannedActivities.userId, userId))
      .orderBy(asc(plannedActivities.position)),
    reader
      .select()
      .from(plannedActivityDays)
      .where(eq(plannedActivityDays.userId, userId))
      .orderBy(asc(plannedActivityDays.weekday)),
    reader
      .select()
      .from(workBlocks)
      .where(eq(workBlocks.userId, userId))
      .orderBy(asc(workBlocks.weekday)),
  ]);
  return { lifestyle, training, activities, days, blocks };
}

/**
 * Replaces the training list with its days (spec 002 AC5, spec 010 AC4). The list is small (at most 6
 * rows with 7 days each) and has no history; deleting an activity cascades to its days.
 */
async function replaceActivities(
  tx: Writer,
  userId: string,
  activities: readonly PlannedActivity[],
): Promise<void> {
  await tx.delete(plannedActivities).where(eq(plannedActivities.userId, userId));
  if (activities.length === 0) return;
  const inserted = await tx
    .insert(plannedActivities)
    .values(
      activities.map(({ days: _, ...activity }, position) => ({ userId, ...activity, position })),
    )
    .returning({ id: plannedActivities.id, position: plannedActivities.position });
  const days = inserted.flatMap(({ id, position }) =>
    activities[position]!.days.map((day) => ({ activityId: id, userId, ...day })),
  );
  if (days.length > 0) await tx.insert(plannedActivityDays).values(days);
}

/** Unknown values (e.g. a flag removed from the contract) are dropped instead of failing the response. */
function toFlags(values: readonly string[]): SafetyFlag[] {
  return values.flatMap((v) => {
    const parsed = SafetyFlagSchema.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  });
}

function toActivity(row: ActivityRow, days: readonly DayRow[]): PlannedActivity {
  return {
    kind: row.kind,
    label: row.label,
    sessionsPerWeek: row.sessionsPerWeek,
    minutesPerSession: row.minutesPerSession,
    intensity: row.intensity,
    days: days
      .filter((day) => day.activityId === row.id)
      .map((day): ActivityDay => ({
        weekday: day.weekday,
        startMinute: day.startMinute,
        isMatch: day.isMatch,
      })),
  };
}

const toWorkBlock = (row: WorkBlockRow): WorkBlock => ({
  weekday: row.weekday,
  startMinute: row.startMinute,
  endMinute: row.endMinute,
});

function toProfile(
  row: ProfileRow,
  { lifestyle, training, activities, days, blocks }: ProfileRows,
) {
  return {
    sex: row.sex,
    birthDate: row.birthDate,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    targetWeightKg: row.targetWeightKg,
    // Null for an account created before spec 002 that has not filled in the form again (AC17).
    jobActivity: lifestyle?.jobActivity ?? null,
    plannedActivities: activities.map((activity) => toActivity(activity, days)),
    requestedGoal: row.requestedGoal,
    goal: row.goal,
    // Every profile has a row after migration 0005 (spec 004 AC13); null only for safety.
    trainingFocus: training?.focus ?? null,
    safetyFlags: toFlags(row.safetyFlags),
    injuries: row.injuries,
    units: row.units,
    locale: row.locale,
    onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
    week: {
      workPattern: lifestyle?.workPattern ?? null,
      workBlocks: blocks.map(toWorkBlock),
      dayStartMinute: lifestyle?.dayStartMinute ?? 0,
    },
    trainingExperience: training?.experience ?? null,
    equipmentAccess: training?.equipment ?? null,
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

  return {
    ...createFoodStore(db),
    ...createTrainingStore(db),
    ...createCheckinStore(db),

    async getMe(userId) {
      const [[consent], [profile], profileRows, [prefs], [targets]] = await Promise.all([
        activeConsent(userId, 'health_data'),
        db.select().from(profiles).where(eq(profiles.id, userId)),
        loadProfileRows(db, userId),
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
        profile: profile ? toProfile(profile, profileRows) : null,
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

        await replaceActivities(tx, userId, activities);

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

        const [[entry], [latest], recent, profileRows, [targets]] = await Promise.all([
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
          loadProfileRows(tx, userId),
          tx
            .select()
            .from(nutritionTargets)
            .where(and(eq(nutritionTargets.userId, userId), isNull(nutritionTargets.validTo)))
            .orderBy(desc(nutritionTargets.validFrom))
            .limit(1),
        ]);
        const previousTargets = targets ? toTargets(targets) : null;

        const decision = decide({
          profile: toProfile(profile, profileRows),
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

    async countAiUsage(userId, feature, since) {
      const [row] = await db
        .select({ n: count() })
        .from(aiUsage)
        .where(
          and(
            eq(aiUsage.userId, userId),
            eq(aiUsage.feature, feature),
            gte(aiUsage.createdAt, since),
          ),
        );
      return row?.n ?? 0;
    },

    async saveWeek(userId, write, at) {
      return db.transaction(async (tx) => {
        // Serialises with the other profile writes of the user (weights, profile form).
        const [profile] = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.id, userId))
          .for('update');
        if (!profile) return false;
        const updated = await tx
          .update(lifestyleProfiles)
          .set({
            workPattern: write.week.workPattern,
            dayStartMinute: write.week.dayStartMinute,
            updatedAt: at,
          })
          .where(eq(lifestyleProfiles.userId, userId))
          .returning({ userId: lifestyleProfiles.userId });
        // An account from before spec 002 has no job yet: it fills in the profile form first.
        if (updated.length === 0) return false;

        await tx.delete(workBlocks).where(eq(workBlocks.userId, userId));
        if (write.week.workBlocks.length > 0) {
          await tx
            .insert(workBlocks)
            .values(write.week.workBlocks.map((block) => ({ userId, ...block })));
        }
        await replaceActivities(tx, userId, write.plannedActivities);

        if (write.evaluation) {
          await tx
            .update(profiles)
            .set({
              goal: write.evaluation.goal,
              safetyFlags: write.evaluation.safetyFlags,
              updatedAt: at,
            })
            .where(eq(profiles.id, userId));
          await tx
            .update(nutritionTargets)
            .set({ validTo: at })
            .where(and(eq(nutritionTargets.userId, userId), isNull(nutritionTargets.validTo)));
          if (write.evaluation.targets) {
            await tx
              .insert(nutritionTargets)
              .values({ userId, ...write.evaluation.targets, validFrom: at });
          }
        }
        return true;
      });
    },

    async saveTrainingProfile(userId, update, at) {
      const updated = await db
        .update(trainingProfiles)
        .set({ experience: update.experience, equipment: update.equipment, updatedAt: at })
        .where(eq(trainingProfiles.userId, userId))
        .returning({ userId: trainingProfiles.userId });
      return updated.length > 0;
    },

    async exportUser(userId) {
      const [[profile], profileRows, [prefs], targets, consentRows, usageRows, weights] =
        await Promise.all([
          db.select().from(profiles).where(eq(profiles.id, userId)),
          loadProfileRows(db, userId),
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
        profile: profile ? toProfile(profile, profileRows) : null,
        dietaryPrefs: prefs ? toPrefs(prefs) : null,
        targets: targets.map((t) => ({
          ...toTargets(t),
          validTo: t.validTo?.toISOString() ?? null,
        })),
        weights: weights.map(toWeight),
        ...(await exportFoodLog(db, userId)),
        ...(await exportTrainingLog(db, userId)),
        checkins: await exportCheckins(db, userId),
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
