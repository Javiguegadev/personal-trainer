import { EMPTY_WEEK, type PlannedActivity, type Profile, type Week } from '@pt/contracts';

/**
 * The typical week of a profile. A `/me` cached on the device before spec 010 has no `week` until it
 * is fetched again (offline it may never be), so it reads as the empty week instead of crashing.
 */
export function profileWeek(profile: Pick<Profile, 'week'> | null | undefined): Week {
  return (profile?.week as Week | undefined) ?? EMPTY_WEEK;
}

/** The planned activities, with no days for an activity cached before spec 010 (see `profileWeek`). */
export function profileActivities(profile: Pick<Profile, 'plannedActivities'>): PlannedActivity[] {
  return profile.plannedActivities.map((activity) => ({
    ...activity,
    days: (activity.days as PlannedActivity['days'] | undefined) ?? [],
  }));
}
