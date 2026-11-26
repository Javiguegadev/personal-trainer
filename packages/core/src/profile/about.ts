import {
  ReportedHealthFlagSchema,
  type DietaryPrefs,
  type Profile,
  type ProfileInput,
  type ReportedHealthFlag,
} from '@pt/contracts';
import { DEFAULT_TRAINING_FOCUS } from './form';

/** The optional items "Lo que sé de ti" can clear with "Borrar" (spec 014 AC12). */
export type ClearableItem = 'targetWeight' | 'allergies' | 'dislikes' | 'injuries';

const isReported = (flag: string): flag is ReportedHealthFlag =>
  ReportedHealthFlagSchema.safeParse(flag).success;

/**
 * The stored profile as a `PUT /me/profile` body with `item` cleared (spec 014 AC12). Built from the
 * stored numbers, not from the form, so nothing else changes: a weight in pounds converted back and
 * forth would otherwise count as a new weight. The goal is the one the user asked for (the safety
 * rules apply again on the save, as in "Tus datos"). Null for a profile that cannot be saved as it is
 * (before spec 002, without a job, or without dietary preferences).
 */
export function profileInputWithout(
  profile: Profile,
  prefs: DietaryPrefs | null,
  item: ClearableItem,
  today: string,
): ProfileInput | null {
  if (profile.jobActivity === null || prefs === null) return null;
  return {
    sex: profile.sex,
    birthDate: profile.birthDate,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    targetWeightKg: item === 'targetWeight' ? null : profile.targetWeightKg,
    jobActivity: profile.jobActivity,
    plannedActivities: profile.plannedActivities,
    goal: profile.requestedGoal,
    trainingFocus: profile.trainingFocus ?? DEFAULT_TRAINING_FOCUS,
    injuries: item === 'injuries' ? null : profile.injuries,
    healthFlags: profile.safetyFlags.filter(isReported),
    units: profile.units,
    locale: profile.locale,
    dietaryPrefs: {
      ...prefs,
      allergies: item === 'allergies' ? [] : prefs.allergies,
      dislikes: item === 'dislikes' ? [] : prefs.dislikes,
    },
    today,
  };
}
