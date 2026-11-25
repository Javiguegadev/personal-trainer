import type {
  ContextSnapshot,
  SafetyEvaluation,
  Sex,
  Targets,
  TargetsBreakdown,
} from '@pt/contracts';
import { computeAge } from '../dates';
import { roundTo } from '../units';
import { ACTIVITY_FACTOR_CEILING, isHighTrainingLoad } from './activity';
import {
  proteinGPerKg as proteinFor,
  referenceWeightKg as referenceFor,
  sportCarbsMinimum,
} from './focus';

export { computeAge };

/**
 * Daily calorie and macro targets, version `targets-v4` (spec 014; spec 004; spec 002 AC6, AC9–AC11;
 * spec 001 AC13–AC15). v2 replaced the single activity level of v1 with a job factor plus a training
 * factor (`./activity`); v3 adds what the user trains for (`./focus`): protein by focus, a smaller
 * deficit and a carbohydrate minimum for sport performance; v4 adds the weekly reviews' accepted
 * calibration to the TDEE, before the deficit or surplus, so their limits and the floor still apply.
 * Changing any constant here means a new formula version, new fixtures and a domain review.
 */
export const TARGETS_FORMULA_VERSION = 'targets-v4';

/** Minimum daily kcal by sex (AC14); the BMR is also a floor. */
export const CALORIE_FLOOR: Record<Sex, number> = { female: 1200, male: 1500, other: 1350 };

const DEFICIT_RATIO = 0.2;
const DEFICIT_MAX_KCAL = 500;
/**
 * With a high training load (spec 002 AC11) or a sport-performance focus (spec 004 AC5) the deficit is
 * smaller, to lower the risk of under-fuelling and to protect performance.
 */
const SMALL_DEFICIT_RATIO = 0.1;
const SMALL_DEFICIT_MAX_KCAL = 300;
const SURPLUS_RATIO = 0.1;
const SURPLUS_MAX_KCAL = 300;
const FAT_KCAL_RATIO = 0.25;
const FAT_MIN_G_PER_KG = 0.6;
/**
 * Fat never drops below 20 % of the calories to make room for carbohydrates (spec 004): the lower end
 * of the ACSM/AND/DC 2016 position stand (Thomas, Erdman & Burke) and of the IOM AMDR.
 */
const FAT_MIN_KCAL_RATIO = 0.2;
const FIBER_G_PER_1000_KCAL = 14; // IOM 2005
const FIBER_MIN_G = 25; // EFSA adequate intake for adults
const PROTEIN_MAX_KCAL_RATIO = 0.35; // top of the IOM AMDR
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

/** Mifflin-St Jeor (1990). "other" uses the mean of the male and female equations. */
export function computeBmr(sex: Sex, weightKg: number, heightCm: number, ageYears: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  const male = base + 5;
  const female = base - 161;
  if (sex === 'male') return male;
  if (sex === 'female') return female;
  return (male + female) / 2;
}

const roundTo10 = (kcal: number) => Math.round(kcal / 10) * 10;
const ceilTo10 = (kcal: number) => Math.ceil(kcal / 10) * 10;

/**
 * Computes targets from the user context, for the goal that safety rules applied
 * (`safety.appliedGoal`), never the raw request.
 */
export function computeTargets(
  snapshot: ContextSnapshot,
  safety: SafetyEvaluation,
): { targets: Targets; breakdown: TargetsBreakdown } {
  if (!safety.targetsAllowed) {
    throw new Error('computeTargets: safety rules do not allow numeric targets for this profile');
  }
  const input = snapshot.profile;
  const { ageYears } = input;
  const bmr = computeBmr(input.sex, input.weightKg, input.heightCm, ageYears);
  const uncapped = snapshot.job.factor + snapshot.training.factor;
  // Tolerance: 1.8 + 0.6 is 2.4000000000000004 in floating point, which is not above the ceiling.
  const capped = uncapped - ACTIVITY_FACTOR_CEILING > 1e-9;
  const activityFactor = capped ? ACTIVITY_FACTOR_CEILING : uncapped;
  // The calibration corrects the estimate of the expenditure (spec 014), not the goal.
  const calibrationKcal = snapshot.energy.calibrationKcal;
  const tdee = bmr * activityFactor + calibrationKcal;
  const goal = safety.appliedGoal;
  const { focus, minutesPerWeek } = snapshot.training;
  const smallDeficit = isHighTrainingLoad(minutesPerWeek) || focus === 'sport_performance';

  let adjustment = 0;
  if (goal === 'lose') {
    adjustment = smallDeficit
      ? -Math.min(tdee * SMALL_DEFICIT_RATIO, SMALL_DEFICIT_MAX_KCAL)
      : -Math.min(tdee * DEFICIT_RATIO, DEFICIT_MAX_KCAL);
  } else if (goal === 'gain') {
    adjustment = Math.min(tdee * SURPLUS_RATIO, SURPLUS_MAX_KCAL);
    if (safety.maxSurplusRatio !== null)
      adjustment = Math.min(adjustment, tdee * safety.maxSurplusRatio);
  }

  const floor = Math.max(bmr, CALORIE_FLOOR[input.sex]);
  const raw = tdee + adjustment;
  const clamped = raw < floor;
  // Never round below the floor, even when raw is only a few kcal above it.
  const kcal = Math.max(clamped ? 0 : roundTo10(raw), ceilTo10(floor));

  const proteinGPerKg = proteinFor(focus, goal);
  // Protein never exceeds 35 % of kcal (with obesity it already uses the BMI-25 weight).
  const referenceWeightKg = referenceFor(input.heightCm, input.weightKg);
  const proteinG = Math.min(
    Math.round(proteinGPerKg * referenceWeightKg),
    Math.floor((kcal * PROTEIN_MAX_KCAL_RATIO) / KCAL_PER_G.protein),
  );
  // Rounded up, so the stored grams never fall below the minimum.
  const fatMinG = Math.ceil(FAT_MIN_G_PER_KG * referenceWeightKg);
  let fatG = Math.max(Math.round((kcal * FAT_KCAL_RATIO) / KCAL_PER_G.fat), fatMinG);
  let fatLoweredForCarbs = false;

  const carbsFor = (fat: number) =>
    Math.round((kcal - proteinG * KCAL_PER_G.protein - fat * KCAL_PER_G.fat) / KCAL_PER_G.carbs);
  let carbsG = carbsFor(fatG);
  const carbsMin = sportCarbsMinimum(focus, minutesPerWeek, referenceWeightKg);
  if (carbsMin && carbsG < carbsMin.grams) {
    // Sport performance (spec 004 AC7, AC8): fat makes room for the carbohydrate minimum, down to
    // 0.6 g/kg and 20 % of the calories; calories never change. Fat is rounded down so the carbs reach
    // the minimum when it fits.
    const fatRoom = Math.floor(
      (kcal - proteinG * KCAL_PER_G.protein - carbsMin.grams * KCAL_PER_G.carbs) / KCAL_PER_G.fat,
    );
    const sportFatMinG = Math.max(fatMinG, Math.ceil((kcal * FAT_MIN_KCAL_RATIO) / KCAL_PER_G.fat));
    const lowered = Math.max(fatRoom, sportFatMinG);
    fatLoweredForCarbs = lowered < fatG;
    fatG = Math.min(fatG, lowered);
    carbsG = Math.max(0, carbsFor(fatG));
  } else if (carbsG < 0) {
    // Protein is kept; fat drops to its minimum; carbs never go negative.
    fatG = fatMinG;
    carbsG = Math.max(0, carbsFor(fatG));
  }

  return {
    targets: {
      kcal,
      proteinG,
      carbsG,
      fatG,
      fiberG: Math.max(FIBER_MIN_G, Math.round((kcal / 1000) * FIBER_G_PER_1000_KCAL)),
      formulaVersion: TARGETS_FORMULA_VERSION,
      // The floor is the more important reason when both apply.
      clampedReason: clamped ? 'calorie_floor' : capped ? 'activity_ceiling' : null,
    },
    breakdown: {
      ageYears,
      bmrKcal: Math.round(bmr),
      activityFactor: roundTo(activityFactor, 3),
      jobFactor: snapshot.job.factor,
      trainingFactor: roundTo(snapshot.training.factor, 3),
      calibrationKcal,
      tdeeKcal: Math.round(tdee),
      goalAdjustmentKcal: Math.round(adjustment),
      floorKcal: Math.round(floor),
      proteinGPerKg,
      referenceWeightKg: Math.round(referenceWeightKg * 10) / 10,
      trainingFocus: focus,
      carbsMinGPerKg: carbsMin?.gPerKg ?? null,
      fatLoweredForCarbs,
    },
  };
}
