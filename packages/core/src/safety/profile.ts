import type { Goal, ReportedHealthFlag, SafetyEvaluation, SafetyFlag } from '@pt/contracts';
import { computeAge } from '../dates';
import { isHighTrainingLoad } from '../nutrition/activity';

/**
 * Profile safety rules (spec 001 AC17–AC21, spec 002 AC11, BLUEPRINT §8). They run on every targets preview and profile
 * save, whatever the AI said. Thresholds need a dietitian's review before launch.
 */
export const SAFETY_RULES = {
  minAge: 16,
  adultAge: 18,
  teenMaxSurplusRatio: 0.1,
  /** ESPEN/GLIM low-BMI thresholds: < 20 under 70 years, < 22 from 70. No deficit below them. */
  minBmi: { under70: 20, from70: 22 },
  /**
   * A profile flagged `low_bmi` gets the deficit back only when its 7-day average weight is at least this
   * many BMI points above the threshold (spec 003 AC12): one high, clothed or mistyped reading must not
   * switch the deficit on and off.
   */
  lowBmiRecoveryMargin: 0.5,
  olderAge: 70,
} as const;

export interface SafetyInput {
  birthDate: string;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number | null;
  goal: Goal;
  healthFlags: ReportedHealthFlag[];
  injuries: string | null;
  /**
   * 7-day average of the weight log (spec 003), or null with fewer than 3 entries in the week. Only used
   * to leave `low_bmi`. Omitted means no average.
   */
  weightAverageKg?: number | null;
  /** Planned training per week (spec 002 AC11). Omitted means no training. */
  trainingMinutesPerWeek?: number;
  /**
   * Flags stored on the profile from earlier evaluations. `ed_soft_stop` is sticky (AC20: no deficit is
   * ever applied), so a later Settings edit cannot switch it off.
   */
  previousFlags?: readonly SafetyFlag[];
}

export function computeBmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export function evaluateProfileSafety(input: SafetyInput, today: string): SafetyEvaluation {
  const age = computeAge(input.birthDate, today);
  const requestedGoal = input.goal;

  if (age < SAFETY_RULES.minAge) {
    return {
      status: 'blocked',
      requestedGoal,
      appliedGoal: 'maintain',
      flags: [],
      maxSurplusRatio: null,
      targetsAllowed: false,
    };
  }

  const minBmi =
    age >= SAFETY_RULES.olderAge ? SAFETY_RULES.minBmi.from70 : SAFETY_RULES.minBmi.under70;
  const flags = new Set<SafetyFlag>();
  let noDeficit = false;
  let maxSurplusRatio: number | null = null;

  const teen = age < SAFETY_RULES.adultAge;
  if (teen) {
    flags.add('teen_limited');
    noDeficit = true;
    maxSurplusRatio = SAFETY_RULES.teenMaxSurplusRatio;
  }

  // Into `low_bmi` on one reading; out of it only on the 7-day average with a margin (spec 003 AC12).
  const averageKg = input.weightAverageKg ?? null;
  const recovered =
    averageKg !== null &&
    computeBmi(averageKg, input.heightCm) >= minBmi + SAFETY_RULES.lowBmiRecoveryMargin;
  const wasLow = input.previousFlags?.includes('low_bmi') ?? false;
  if (computeBmi(input.weightKg, input.heightCm) < minBmi || (wasLow && !recovered)) {
    flags.add('low_bmi');
    noDeficit = true;
  }
  if (input.targetWeightKg !== null && computeBmi(input.targetWeightKg, input.heightCm) < minBmi) {
    flags.add('low_target_bmi');
    noDeficit = true;
  }

  if (input.previousFlags?.includes('ed_soft_stop')) {
    flags.add('ed_soft_stop');
    noDeficit = true;
  }

  for (const flag of input.healthFlags) {
    flags.add(flag);
    if (flag === 'pregnancy' || flag === 'ed_soft_stop') noDeficit = true;
  }

  if (input.injuries !== null && input.injuries.trim() !== '') flags.add('injury');
  // The smaller deficit itself is applied by `computeTargets`; the flag drives the notice.
  if (isHighTrainingLoad(input.trainingMinutesPerWeek ?? 0)) flags.add('high_training_load');

  const appliedGoal: Goal = noDeficit && requestedGoal === 'lose' ? 'maintain' : requestedGoal;

  return {
    status: teen ? 'teen_limited' : 'ok',
    requestedGoal,
    appliedGoal,
    flags: [...flags],
    maxSurplusRatio,
    // Pregnancy/breastfeeding: needs rise by trimester; no numbers, refer to a midwife or doctor.
    targetsAllowed: !flags.has('pregnancy'),
  };
}
