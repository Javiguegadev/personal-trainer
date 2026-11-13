import {
  CONTEXT_VERSION,
  type ContextSnapshot,
  type Goal,
  type JobActivity,
  type PlannedActivity,
  type SafetyFlag,
  type Sex,
} from '@pt/contracts';
import { computeAge } from '../dates';
import {
  jobFactor,
  trainingFactor,
  trainingMinutesPerWeek,
  trainingSessionsPerWeek,
} from '../nutrition/activity';
import { isWeightTrendHidden, weightTrend, type WeightPoint } from '../weight/trend';

/** The stored rows the snapshot is built from (ADR 003). Later stages add logs and check-ins. */
export interface ContextSources {
  profile: {
    sex: Sex;
    birthDate: string;
    heightCm: number;
    weightKg: number;
    targetWeightKg: number | null;
    /** The goal the user asked for. */
    goal: Goal;
  };
  safetyFlags: readonly SafetyFlag[];
  jobActivity: JobActivity;
  plannedActivities: readonly PlannedActivity[];
  /** The weight log, in any order. Omitted means no entries. */
  weights?: readonly WeightPoint[];
}

/**
 * The user context for `today` (the user's local date), version `context-v2` (spec 002 AC12, spec 003
 * AC25). Pure: the
 * same sources and date always give the same snapshot, and the sources are not modified.
 */
export function buildContextSnapshot(sources: ContextSources, today: string): ContextSnapshot {
  const { profile, plannedActivities } = sources;
  const trend = weightTrend(sources.weights ?? [], today);
  const trendHidden = isWeightTrendHidden(sources.safetyFlags);
  return {
    version: CONTEXT_VERSION,
    date: today,
    profile: {
      sex: profile.sex,
      ageYears: computeAge(profile.birthDate, today),
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      targetWeightKg: profile.targetWeightKg,
      goal: profile.goal,
    },
    safetyFlags: [...sources.safetyFlags],
    job: { activity: sources.jobActivity, factor: jobFactor(sources.jobActivity) },
    training: {
      activities: plannedActivities.map((activity) => ({ ...activity })),
      sessionsPerWeek: trainingSessionsPerWeek(plannedActivities),
      minutesPerWeek: trainingMinutesPerWeek(plannedActivities),
      factor: trainingFactor(plannedActivities),
    },
    weight: {
      lastKg: trend.last?.weightKg ?? null,
      lastDate: trend.last?.localDate ?? null,
      averageKg: trendHidden ? null : trend.averageKg,
      changePerWeekKg: trendHidden ? null : trend.changePerWeekKg,
      fastLoss: trendHidden ? false : trend.fastLoss,
      trendHidden,
    },
  };
}
