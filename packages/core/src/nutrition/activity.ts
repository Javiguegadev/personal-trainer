import type { ActivityKind, Intensity, JobActivity, PlannedActivity } from '@pt/contracts';

/**
 * Activity factors of `targets-v2` (spec 002 AC6, AC10, AC11). TDEE = BMR × (job factor + training
 * factor). Every constant here is PROVISIONAL: the values come from the domain review of the spec and
 * must be checked by a professional before the beta. Changing one means a new formula version, new
 * fixtures and a domain review.
 */

/**
 * Physical activity level of a day without training, by job. FAO/WHO/UNU (2004), Human energy
 * requirements: 1.40–1.69 sedentary or light lifestyle, 1.70–1.99 active, 2.00–2.40 vigorous.
 */
export const JOB_FACTORS: Record<JobActivity, number> = {
  sedentary: 1.4,
  standing: 1.6,
  physical: 1.8,
};

/**
 * MET of a whole session, rests included, by kind and intensity. They sit below the continuous-effort
 * codes of the Compendium of Physical Activities (Ainsworth et al., 2011) because people report the
 * session, not the minutes of effort.
 */
export const ACTIVITY_MET: Record<ActivityKind, Record<Intensity, number>> = {
  strength: { light: 3.0, moderate: 3.5, hard: 5.0 },
  cardio: { light: 4.0, moderate: 6.0, hard: 8.5 },
  sport: { light: 4.0, moderate: 6.0, hard: 8.0 },
  other: { light: 2.5, moderate: 4.0, hard: 6.0 },
};

/** Top of the FAO/WHO/UNU range for a vigorous lifestyle. A higher factor is not sustainable (AC10). */
export const ACTIVITY_FACTOR_CEILING = 2.4;

/** Planned minutes per week from which the deficit is reduced and a notice is shown (AC11). */
export const HIGH_TRAINING_LOAD_MINUTES = 600;

const HOURS_PER_WEEK = 168;

export function jobFactor(job: JobActivity): number {
  return JOB_FACTORS[job];
}

export function trainingMinutesPerWeek(activities: readonly PlannedActivity[]): number {
  return activities.reduce((sum, a) => sum + a.sessionsPerWeek * a.minutesPerSession, 0);
}

export function trainingSessionsPerWeek(activities: readonly PlannedActivity[]): number {
  return activities.reduce((sum, a) => sum + a.sessionsPerWeek, 0);
}

/**
 * Share of the BMR that the planned training adds, averaged over the week: for each activity, hours per
 * week × (MET − 1), added up and divided by the hours in a week. MET − 1 because the resting part of
 * each hour is already in the job factor. 1 MET is taken as the user's own BMR per hour, so the result
 * multiplies the BMR instead of the body weight (which would overstate the cost for heavy users).
 */
export function trainingFactor(activities: readonly PlannedActivity[]): number {
  const metHours = activities.reduce(
    (sum, a) =>
      sum +
      ((a.sessionsPerWeek * a.minutesPerSession) / 60) * (ACTIVITY_MET[a.kind][a.intensity] - 1),
    0,
  );
  return metHours / HOURS_PER_WEEK;
}

export function isHighTrainingLoad(minutesPerWeek: number): boolean {
  return minutesPerWeek >= HIGH_TRAINING_LOAD_MINUTES;
}
