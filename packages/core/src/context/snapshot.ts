import {
  CONTEXT_VERSION,
  EMPTY_WEEK,
  type ContextSnapshot,
  type EquipmentAccess,
  type Goal,
  type JobActivity,
  type PlannedActivity,
  type SafetyFlag,
  type Sex,
  type TrainingExperience,
  type TrainingFocus,
  type Week,
  type Weekday,
} from '@pt/contracts';
import { latestPerDay, usualSleep, type CheckinPoint } from '../checkin/checkin';
import { dayReadiness } from '../checkin/readiness';
import { typicalDay } from '../week/typical';
import { computeAge } from '../dates';
import {
  jobFactor,
  trainingFactor,
  trainingMinutesPerWeek,
  trainingSessionsPerWeek,
} from '../nutrition/activity';
import { isWeightTrendHidden, weightTrend, type WeightPoint } from '../weight/trend';

const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** The stored rows the snapshot is built from (ADR 003). Later stages add logs. */
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
  /** What the user trains for (spec 004). */
  trainingFocus: TrainingFocus;
  /** The weight log, in any order. Omitted means no entries. */
  weights?: readonly WeightPoint[];
  /** Work pattern, work blocks and day start (spec 010). Omitted means `EMPTY_WEEK`. */
  week?: Week;
  /** The routine wizard's answers (spec 010 AC14). Omitted means not answered. */
  trainingExperience?: TrainingExperience | null;
  equipmentAccess?: EquipmentAccess | null;
  /** Whether the user has an active routine. Omitted means no. */
  hasRoutine?: boolean;
  /** The daily check-ins of the last weeks, in any order (spec 011). Omitted means none. */
  checkins?: readonly CheckinPoint[];
}

/**
 * The user context for `today` (the user's local date), version `context-v5` (spec 002 AC12, spec 003
 * AC25, spec 004 AC11, spec 010 AC25, spec 011 AC17). Pure: the same sources and date always give the same snapshot,
 * and the sources are not modified.
 */
export function buildContextSnapshot(sources: ContextSources, today: string): ContextSnapshot {
  const { profile, plannedActivities } = sources;
  const trend = weightTrend(sources.weights ?? [], today);
  const trendHidden = isWeightTrendHidden(sources.safetyFlags);
  const week = sources.week ?? EMPTY_WEEK;
  const typical = { workBlocks: week.workBlocks, plannedActivities };
  const checkins = latestPerDay(sources.checkins ?? []);
  const checkin = checkins.find((c) => c.localDate === today) ?? null;
  const usual = usualSleep(checkins, today);
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
      focus: sources.trainingFocus,
      experience: sources.trainingExperience ?? null,
      equipment: sources.equipmentAccess ?? null,
      hasRoutine: sources.hasRoutine ?? false,
    },
    week: {
      workPattern: week.workPattern,
      dayStartMinute: week.dayStartMinute,
      days: WEEKDAYS.map((weekday) => {
        const day = typicalDay(typical, weekday);
        return {
          weekday,
          work: day.work && { startMinute: day.work.startMinute, endMinute: day.work.endMinute },
          training: day.training.map((slot) => ({
            activityIndex: slot.activityIndex,
            kind: slot.kind,
            minutes: slot.minutes,
            startMinute: slot.startMinute,
            isMatch: slot.isMatch,
          })),
        };
      }),
    },
    today: {
      checkin: checkin && {
        sleepMinutes: checkin.sleepMinutes,
        stress: checkin.stress,
        shift: checkin.workShift && {
          kind: checkin.workShift,
          startMinute: checkin.shiftStartMinute,
          endMinute: checkin.shiftEndMinute,
        },
      },
      readiness: dayReadiness(checkin, usual),
    },
    sleep: { usualMinutes: usual },
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
