import type {
  ActivityLevel,
  SafetyEvaluation,
  Sex,
  Targets,
  TargetsBreakdown,
} from '@pt/contracts';
import { computeAge } from '../dates';

export { computeAge };

/**
 * Daily calorie and macro targets, version `targets-v1` (spec 001 AC13–AC15).
 * Changing any constant here means a new formula version, new fixtures and a domain review.
 */
export const TARGETS_FORMULA_VERSION = 'targets-v1';

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Minimum daily kcal by sex (AC14); the BMR is also a floor. */
export const CALORIE_FLOOR: Record<Sex, number> = { female: 1200, male: 1500, other: 1350 };

const DEFICIT_RATIO = 0.2;
const DEFICIT_MAX_KCAL = 500;
const SURPLUS_RATIO = 0.1;
const SURPLUS_MAX_KCAL = 300;
const PROTEIN_G_PER_KG = { lose: 1.8, maintain: 1.6, gain: 1.6 } as const;
const FAT_KCAL_RATIO = 0.25;
const FAT_MIN_G_PER_KG = 0.6;
const FIBER_G_PER_1000_KCAL = 14; // IOM 2005
const FIBER_MIN_G = 25; // EFSA adequate intake for adults
const PROTEIN_MAX_KCAL_RATIO = 0.35; // top of the IOM AMDR
const REFERENCE_BMI_THRESHOLD = 30;
const REFERENCE_BMI = 25;
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

export interface TargetsInput {
  sex: Sex;
  birthDate: string;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
}

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
 * Computes targets for the goal that safety rules applied (`safety.appliedGoal`), never the raw request.
 * `today` is the user's local date (YYYY-MM-DD).
 */
export function computeTargets(
  input: TargetsInput,
  safety: SafetyEvaluation,
  today: string,
): { targets: Targets; breakdown: TargetsBreakdown } {
  if (!safety.targetsAllowed) {
    throw new Error('computeTargets: safety rules do not allow numeric targets for this profile');
  }
  const ageYears = computeAge(input.birthDate, today);
  const bmr = computeBmr(input.sex, input.weightKg, input.heightCm, ageYears);
  const activityFactor = ACTIVITY_FACTORS[input.activityLevel];
  const tdee = bmr * activityFactor;
  const goal = safety.appliedGoal;

  let adjustment = 0;
  if (goal === 'lose') {
    adjustment = -Math.min(tdee * DEFICIT_RATIO, DEFICIT_MAX_KCAL);
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

  const proteinGPerKg = PROTEIN_G_PER_KG[goal];
  // With obesity, g/kg of total weight overshoots (ISSN ranges come from lean, active people): use the
  // weight at BMI 25 for the user's height instead, and never exceed 35 % of kcal from protein.
  const heightM = input.heightCm / 100;
  const referenceWeightKg =
    input.weightKg / (heightM * heightM) >= REFERENCE_BMI_THRESHOLD
      ? REFERENCE_BMI * heightM * heightM
      : input.weightKg;
  const proteinG = Math.min(
    Math.round(proteinGPerKg * referenceWeightKg),
    Math.floor((kcal * PROTEIN_MAX_KCAL_RATIO) / KCAL_PER_G.protein),
  );
  const fatMinG = FAT_MIN_G_PER_KG * referenceWeightKg;
  let fatG = Math.round(Math.max((kcal * FAT_KCAL_RATIO) / KCAL_PER_G.fat, fatMinG));

  const carbsFor = (fat: number) =>
    Math.round((kcal - proteinG * KCAL_PER_G.protein - fat * KCAL_PER_G.fat) / KCAL_PER_G.carbs);
  let carbsG = carbsFor(fatG);
  if (carbsG < 0) {
    // Protein is kept; fat drops to its minimum; carbs never go negative.
    fatG = Math.round(fatMinG);
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
      clampedReason: clamped ? 'calorie_floor' : null,
    },
    breakdown: {
      ageYears,
      bmrKcal: Math.round(bmr),
      activityFactor,
      tdeeKcal: Math.round(tdee),
      goalAdjustmentKcal: Math.round(adjustment),
      floorKcal: Math.round(floor),
      proteinGPerKg,
      referenceWeightKg: Math.round(referenceWeightKg * 10) / 10,
    },
  };
}
