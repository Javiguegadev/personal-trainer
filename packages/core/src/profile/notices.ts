import type { Profile, SafetyEvaluation, Targets } from '@pt/contracts';
import { trainingMinutesPerWeek } from '../nutrition/activity';
import { referenceWeightKg, sportCarbsMinimum } from '../nutrition/focus';

/**
 * Safety notices shown on the summary, in Settings and on "Today" (spec 001 AC14, AC18–AC21; spec 002
 * AC10, AC11; spec 004 AC5, AC8). Each maps to the i18n key `safety.<notice>`. Ordered from most to
 * least important.
 */
export type ProfileNotice =
  | 'pregnancy'
  | 'ed_soft_stop'
  | 'low_bmi'
  | 'low_target_bmi'
  | 'teen_limited'
  | 'calorie_floor'
  | 'carbs_below_sport_minimum'
  | 'sport_underfuelling'
  | 'high_training_load'
  | 'performance_deficit'
  | 'activity_ceiling'
  | 'medical_condition';

const ORDER: readonly ProfileNotice[] = [
  'pregnancy',
  'ed_soft_stop',
  'low_bmi',
  'low_target_bmi',
  'teen_limited',
  'calorie_floor',
  'carbs_below_sport_minimum',
  'sport_underfuelling',
  'high_training_load',
  'performance_deficit',
  'activity_ceiling',
  'medical_condition',
];

/**
 * What the training notices need (spec 004): a stored `Profile` as it is, or the form input with the
 * goal the safety rules applied (`goal`, never the requested one).
 */
export type TrainingNoticeFacts = Pick<
  Profile,
  'trainingFocus' | 'goal' | 'heightCm' | 'weightKg' | 'plannedActivities'
>;

export function profileNotices(
  safety: Pick<SafetyEvaluation, 'flags'>,
  targets: Pick<Targets, 'clampedReason' | 'carbsG'> | null,
  training?: TrainingNoticeFacts,
): ProfileNotice[] {
  const notices = new Set<ProfileNotice>();
  for (const flag of safety.flags) {
    // A reported condition and free-text injuries get the same "see a professional" notice (AC21).
    if (flag === 'injury' || flag === 'medical_condition') notices.add('medical_condition');
    else notices.add(flag);
  }
  if (targets?.clampedReason === 'calorie_floor') notices.add('calorie_floor');
  if (targets?.clampedReason === 'activity_ceiling') notices.add('activity_ceiling');
  if (targets && training?.trainingFocus === 'sport_performance') {
    if (training.goal === 'lose') notices.add('performance_deficit');
    const minimum = sportCarbsMinimum(
      training.trainingFocus,
      trainingMinutesPerWeek(training.plannedActivities),
      referenceWeightKg(training.heightCm, training.weightKg),
    );
    if (minimum && targets.carbsG < minimum.grams) {
      // Losing fat: the deficit leaves the carbohydrates short, so "keep my weight" helps. Without a
      // deficit that advice does nothing (or cuts calories): a possible under-fuelling, see a professional.
      notices.add(training.goal === 'lose' ? 'carbs_below_sport_minimum' : 'sport_underfuelling');
    }
  }
  return ORDER.filter((notice) => notices.has(notice));
}
