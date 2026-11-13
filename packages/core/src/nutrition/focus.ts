import type { Goal, TrainingFocus } from '@pt/contracts';

/**
 * What the user trains for, in numbers (`targets-v3`, spec 004 AC6, AC7). Every constant here is
 * PROVISIONAL: it needs the domain review and the professional reviewer before the beta. Changing one
 * means a new formula version, new fixtures and a domain review.
 */

/**
 * Protein in g per kg of reference weight, by focus and applied goal (spec 004 AC6). ISSN position stand
 * on protein and exercise (1.4–2.0 g/kg; the top of the range in a deficit, to keep lean mass); Morton et
 * al. (2018): gains in lean mass level off around 1.6 g/kg, so 1.8 keeps a margin for muscle and strength.
 */
const PROTEIN_G_PER_KG: Record<TrainingFocus, Record<Goal, number>> = {
  general_fitness: { lose: 1.8, maintain: 1.6, gain: 1.6 },
  sport_performance: { lose: 1.8, maintain: 1.6, gain: 1.6 },
  hypertrophy: { lose: 2.0, maintain: 1.8, gain: 1.8 },
  strength: { lose: 2.0, maintain: 1.8, gain: 1.8 },
};

/**
 * Carbohydrate minimum for sport performance, by planned minutes per week (spec 004 AC7): the lower bound
 * of the IOC (2011) / ACSM (2016) daily bands. Light (3–5 g/kg), moderate, about 1 h a day (5–7 g/kg),
 * high, 1–3 h a day (6–10 g/kg). Ordered from the highest threshold.
 */
const SPORT_CARBS_BANDS: readonly { fromMinutes: number; gPerKg: number }[] = [
  { fromMinutes: 840, gPerKg: 6 },
  { fromMinutes: 420, gPerKg: 5 },
  { fromMinutes: 0, gPerKg: 3 },
];

const REFERENCE_BMI_THRESHOLD = 30;
const REFERENCE_BMI = 25;

/** Protein per kg; a profile without a focus yet (before migration 0004) is health and general fitness. */
export function proteinGPerKg(focus: TrainingFocus | null, goal: Goal): number {
  return PROTEIN_G_PER_KG[focus ?? 'general_fitness'][goal];
}

/**
 * The weight protein, the fat minimum and the carbohydrate minimum are computed from: the actual weight,
 * or the weight at BMI 25 for the user's height from BMI 30 (g/kg of total weight overshoots with obesity,
 * as the ISSN ranges come from lean, active people).
 */
export function referenceWeightKg(heightCm: number, weightKg: number): number {
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM) >= REFERENCE_BMI_THRESHOLD
    ? REFERENCE_BMI * heightM * heightM
    : weightKg;
}

/**
 * The carbohydrates the planned training needs, for sport performance only (null otherwise). Used by
 * `computeTargets`, and by the app to show the AC8 notice where there is no breakdown ("Today").
 */
export function sportCarbsMinimum(
  focus: TrainingFocus | null,
  minutesPerWeek: number,
  referenceKg: number,
): { gPerKg: number; grams: number } | null {
  if (focus !== 'sport_performance') return null;
  const band = SPORT_CARBS_BANDS.find((b) => minutesPerWeek >= b.fromMinutes);
  const gPerKg = band?.gPerKg ?? 3;
  return { gPerKg, grams: Math.round(gPerKg * referenceKg) };
}
