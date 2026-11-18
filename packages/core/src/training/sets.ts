import { WORKOUT_LIMITS, type ExerciseTracking, type SetValues, type Units } from '@pt/contracts';
import { kgToLb, lbToKg, roundTo } from '../units';

export const EMPTY_SET: SetValues = {
  reps: null,
  weightKg: null,
  durationS: null,
  distanceM: null,
};

/**
 * Whether a set has the values its exercise's tracking needs (spec 009 AC8): weight and reps; reps
 * (extra weight optional); time; or distance (time optional).
 */
export function setMatchesTracking(values: SetValues, tracking: ExerciseTracking): boolean {
  switch (tracking) {
    case 'weight_reps':
      return values.reps !== null && values.weightKg !== null;
    case 'reps':
      return values.reps !== null;
    case 'duration':
      return values.durationS !== null;
    case 'distance_duration':
      return values.distanceM !== null;
  }
}

/** Keeps only the fields of the tracking, so a stray value never reaches the log. */
export function setForTracking(values: SetValues, tracking: ExerciseTracking): SetValues {
  switch (tracking) {
    case 'weight_reps':
      return { ...EMPTY_SET, reps: values.reps, weightKg: values.weightKg };
    case 'reps':
      return { ...EMPTY_SET, reps: values.reps, weightKg: values.weightKg || null };
    case 'duration':
      return { ...EMPTY_SET, durationS: values.durationS };
    case 'distance_duration':
      return { ...EMPTY_SET, distanceM: values.distanceM, durationS: values.durationS };
  }
}

/** Fills the empty fields of what the user typed with the placeholder (AC8). */
export function withPlaceholder(values: SetValues, placeholder: SetValues | null): SetValues {
  if (!placeholder) return values;
  return {
    reps: values.reps ?? placeholder.reps,
    weightKg: values.weightKg ?? placeholder.weightKg,
    durationS: values.durationS ?? placeholder.durationS,
    distanceM: values.distanceM ?? placeholder.distanceM,
  };
}

const clampWeight = (kg: number) => Math.min(Math.max(kg, 0), WORKOUT_LIMITS.weightKgMax);

/**
 * One tap of the weight stepper (AC8): 2.5 kg, or 5 lb in imperial units. The result is stored in kg
 * with 2 decimals and lands on the step of the user's unit, so lb → kg → lb shows the same number.
 */
export function stepWeight(weightKg: number | null, direction: 1 | -1, units: Units): number {
  if (units === 'imperial') {
    const lb = weightKg === null ? 0 : roundTo(kgToLb(weightKg), 1);
    const step = WORKOUT_LIMITS.weightStepLb;
    const next =
      direction === 1 ? Math.floor(lb / step) * step + step : Math.ceil(lb / step) * step - step;
    return clampWeight(roundTo(lbToKg(Math.max(next, 0)), 2));
  }
  const kg = weightKg ?? 0;
  const step = WORKOUT_LIMITS.weightStepKg;
  const next =
    direction === 1
      ? Math.floor(roundTo(kg / step, 6)) * step + step
      : Math.ceil(roundTo(kg / step, 6)) * step - step;
  return clampWeight(roundTo(next, 2));
}

/** A weight in the user's unit, for display: kg with up to 2 decimals, lb with 1. */
export function displayWeight(weightKg: number, units: Units): number {
  return units === 'imperial' ? roundTo(kgToLb(weightKg), 1) : roundTo(weightKg, 2);
}

/** A typed weight in the user's unit, to kg with 2 decimals; null when it is not a valid number. */
export function parseSetWeightField(text: string, units: Units): number | null {
  const value = Number(text.trim().replace(',', '.'));
  if (text.trim() === '' || !Number.isFinite(value) || value < 0) return null;
  const kg = roundTo(units === 'imperial' ? lbToKg(value) : value, 2);
  return kg <= WORKOUT_LIMITS.weightKgMax ? kg : null;
}

/** `mm:ss` or `h:mm:ss` (or plain seconds) → seconds; null when invalid or out of range. */
export function parseDurationField(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.some((p) => !/^\d+$/.test(p)) || parts.length > 3) return null;
  const [a, b, c] = parts.map(Number) as [number, number?, number?];
  const seconds =
    parts.length === 1 ? a : parts.length === 2 ? a * 60 + b! : a * 3600 + b! * 60 + c!;
  if (parts.length > 1 && parts.slice(1).some((p) => Number(p) >= 60)) return null;
  return seconds >= WORKOUT_LIMITS.durationSMin && seconds <= WORKOUT_LIMITS.durationSMax
    ? seconds
    : null;
}

/** Seconds as `m:ss` (or `h:mm:ss` from one hour). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Safety check of a typed weight (spec 009 Safety): more than 50 % above the heaviest weight ever
 * lifted in that exercise asks for confirmation, so a 2.5 → 25 slip never becomes a record.
 */
export function isWeightJump(weightKg: number | null, heaviestKg: number | null): boolean {
  if (weightKg === null || heaviestKg === null || heaviestKg <= 0) return false;
  return weightKg > heaviestKg * (1 + WORKOUT_LIMITS.weightJumpRatio);
}
