import type {
  ProfileInput,
  SafetyEvaluation,
  SafetyFlag,
  Targets,
  TargetsBreakdown,
} from '@pt/contracts';
import { isPlausibleClientDate } from '../dates';
import { computeTargets } from '../nutrition/targets';
import { evaluateProfileSafety } from '../safety/profile';

export type ProfileEvaluation =
  | { kind: 'invalid'; fields: Record<string, string> }
  | { kind: 'blocked' }
  | {
      kind: 'ok';
      safety: SafetyEvaluation;
      targets: Targets | null;
      breakdown: TargetsBreakdown | null;
      /** What gets stored in `profiles.safety_flags`. */
      flags: SafetyFlag[];
    };

/** Request-level checks that Zod cannot do alone (they need the server clock). */
export function checkClientDates(
  input: { today: string; birthDate?: string },
  now: Date,
): Record<string, string> | null {
  if (!isPlausibleClientDate(input.today, now.toISOString())) return { today: 'implausible' };
  if (input.birthDate !== undefined && input.birthDate > input.today) {
    return { birthDate: 'in_future' };
  }
  return null;
}

/**
 * Safety rules + targets for a confirmed profile (AC13–AC22). Runs on both the preview and the save, so
 * nothing the client sends can bypass these rules. `now` is the server clock.
 */
export function evaluateProfileInput(
  input: ProfileInput,
  previousFlags: readonly SafetyFlag[],
  now: Date,
): ProfileEvaluation {
  const invalid = checkClientDates(input, now);
  if (invalid) return { kind: 'invalid', fields: invalid };

  const safety = evaluateProfileSafety(
    {
      birthDate: input.birthDate,
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      targetWeightKg: input.targetWeightKg,
      goal: input.goal,
      healthFlags: input.healthFlags,
      injuries: input.injuries,
      previousFlags,
    },
    input.today,
  );
  if (safety.status === 'blocked') return { kind: 'blocked' };

  const computed = safety.targetsAllowed ? computeTargets(input, safety, input.today) : null;
  const flags = [...safety.flags];
  if (computed?.targets.clampedReason === 'calorie_floor') flags.push('calorie_floor');

  return {
    kind: 'ok',
    safety,
    targets: computed?.targets ?? null,
    breakdown: computed?.breakdown ?? null,
    flags,
  };
}
