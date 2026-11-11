import type { Goal, ReportedHealthFlag, SafetyEvaluation, SafetyFlag } from '@pt/contracts';
import { computeAge } from '../dates';

/**
 * Profile safety rules (spec 001 AC17–AC21, BLUEPRINT §8). They run on every targets preview and profile
 * save, whatever the AI said. Thresholds need a dietitian's review before launch.
 */
export const SAFETY_RULES = {
  minAge: 16,
  adultAge: 18,
  teenMaxSurplusRatio: 0.1,
  /** ESPEN/GLIM low-BMI thresholds: < 20 under 70 years, < 22 from 70. No deficit below them. */
  minBmi: { under70: 20, from70: 22 },
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

  if (computeBmi(input.weightKg, input.heightCm) < minBmi) {
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
