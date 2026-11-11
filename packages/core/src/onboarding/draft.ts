import {
  HeightCmSchema,
  REQUIRED_DRAFT_FIELDS,
  WeightKgSchema,
  type OnboardingDraft,
  type ProfileDraftToolInput,
  type RequiredDraftField,
} from '@pt/contracts';
import { birthDateFromAge, daysBetween } from '../dates';
import { roundTo, toCm, toKg } from '../units';

export type DraftField = keyof OnboardingDraft;

/**
 * Merges what the AI extracted (`update_profile_draft` tool input) into the draft. Measurements are
 * converted here, not by the AI (AC9). Implausible values are dropped and reported so the AI asks again
 * (AC22). `today` (the user's local date) checks the birth date and turns an age into a birth date.
 */
export function applyDraftToolInput(
  draft: OnboardingDraft,
  input: ProfileDraftToolInput,
  today: string,
): { draft: OnboardingDraft; invalid: DraftField[] } {
  const next: OnboardingDraft = { ...draft };
  const invalid: DraftField[] = [];

  const { height, weight, targetWeight, birthDate, ageYears, allergies, restrictions, ...plain } = input;
  Object.assign(next, plain);
  // Allergies and restrictions only ever grow from the chat: an AI call that omits an item must not
  // silently drop it (allergen safety). Removing items happens in the summary/form.
  if (allergies) next.allergies = union(draft.allergies, allergies);
  if (restrictions) next.restrictions = union(draft.restrictions, restrictions);

  if (height) {
    const cm = roundTo(toCm(height), 1);
    if (HeightCmSchema.safeParse(cm).success) next.heightCm = cm;
    else invalid.push('heightCm');
  }
  if (weight) {
    const kg = roundTo(toKg(weight), 1);
    if (WeightKgSchema.safeParse(kg).success) next.weightKg = kg;
    else invalid.push('weightKg');
  }
  if (targetWeight) {
    const kg = roundTo(toKg(targetWeight), 1);
    if (WeightKgSchema.safeParse(kg).success) next.targetWeightKg = kg;
    else invalid.push('targetWeightKg');
  }
  if (birthDate) {
    const age = daysBetween(birthDate, today) / 365.25;
    if (age < 0 || age > 120) invalid.push('birthDate');
    else next.birthDate = birthDate;
  } else if (ageYears !== undefined) {
    // An exact birth date always wins; an age only gives an approximation the user can edit.
    next.birthDate = birthDateFromAge(ageYears, today);
  }

  return { draft: next, invalid };
}

/** Case-insensitive union that keeps the first spelling seen. */
function union(a: readonly string[] | undefined, b: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const item of [...(a ?? []), ...b]) {
    const key = item.trim().toLocaleLowerCase();
    if (key && !seen.has(key)) seen.set(key, item.trim());
  }
  return [...seen.values()];
}

export function missingDraftFields(draft: OnboardingDraft): RequiredDraftField[] {
  return REQUIRED_DRAFT_FIELDS.filter((field) => draft[field] === undefined);
}

/**
 * The client sends its local date; accept it only within ±1 day of the server's UTC date, which covers
 * every time zone.
 */
export function isPlausibleClientDate(clientDate: string, nowIso: string): boolean {
  return Math.abs(daysBetween(nowIso.slice(0, 10), clientDate)) <= 1;
}
