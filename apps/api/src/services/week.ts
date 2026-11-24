import type { MeResponse, WeekRequest } from '@pt/contracts';
import { addDays, evaluateStoredProfile, sameTrainingLoad } from '@pt/core';
import type { Deps, WeekWrite } from '../deps';
import { toMeResponse } from './profile';

export type SaveWeekResult = MeResponse | 'no_profile' | 'blocked';

/**
 * Stores the typical week in one write (spec 010 AC4). The targets are computed again only when the
 * training load changed (counts, minutes, kinds or intensities); days, times and names leave them as
 * they are. `no_profile`: no profile yet, or one from before spec 002 without a job.
 */
export async function saveWeek(
  deps: Deps,
  userId: string,
  request: WeekRequest,
): Promise<SaveWeekResult> {
  const { profile } = await deps.store.getMe(userId);
  if (!profile || profile.jobActivity === null) return 'no_profile';

  const write: WeekWrite = {
    week: {
      workPattern: request.workPattern,
      workBlocks: request.workBlocks,
      dayStartMinute: request.dayStartMinute,
    },
    plannedActivities: request.plannedActivities,
  };
  if (!sameTrainingLoad(profile.plannedActivities, request.plannedActivities)) {
    // The last 7 days of the log: the low-BMI recovery rule reads their average (spec 003 AC12).
    const context = await deps.store.getSafetyContext(userId, addDays(request.today, -6));
    const evaluation = evaluateStoredProfile(
      {
        ...profile,
        jobActivity: profile.jobActivity,
        plannedActivities: request.plannedActivities,
      },
      profile.weightKg,
      request.today,
      context.weights,
    );
    if (evaluation.kind === 'blocked') return 'blocked';
    write.evaluation = {
      goal: evaluation.safety.appliedGoal,
      safetyFlags: evaluation.flags,
      targets: evaluation.targets,
    };
  }

  if (!(await deps.store.saveWeek(userId, write, deps.now()))) return 'no_profile';
  return toMeResponse(userId, await deps.store.getMe(userId));
}
