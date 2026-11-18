import {
  FEEDBACK_LIMITS as L,
  type FeedbackCitationId,
  type FeedbackNote,
  type FeedbackNumbers,
  type FeedbackNutrient,
  type FeedbackObservation,
  type FeedbackObservationKind,
  type FeedbackReading,
  type FeedbackState,
  type Food,
  type MealItem,
  type MealType,
  type Portion,
  type RecentFood,
  type SafetyFlag,
  type Targets,
  type TargetsBreakdown,
} from '@pt/contracts';
import { dailyTotals, mealTotals } from './nutrition';
import { initialPortion, portionPreview } from './portion';

/**
 * The daily feedback (spec 008): core finds the observations of a day and computes every number;
 * the AI only words them and picks foods among the candidates core gives it. Every threshold lives in
 * `FEEDBACK_LIMITS` and is provisional until the professional review.
 */

export type FeedbackTargets = Pick<Targets, 'kcal' | 'proteinG' | 'carbsG' | 'fiberG'>;
export type FeedbackBreakdown = Pick<
  TargetsBreakdown,
  'referenceWeightKg' | 'trainingFocus' | 'carbsMinGPerKg'
>;

export interface FeedbackDay {
  /** The day asked for (spec 005 `local_date`). */
  localDate: string;
  /** The day's live items, as stored (snapshots). */
  items: readonly Pick<MealItem, 'mealType' | 'nutrients'>[];
  /** "Hoy entreno" / "Ese día entrené" (AC10). */
  trainingDay: boolean;
}

/** The device's clock, only to tell a day in progress from a closed one (AC4). */
export interface FeedbackNow {
  today: string;
  /** Minutes after local midnight. */
  minuteOfDay: number;
}

export interface DayObservations {
  state: FeedbackState;
  /** The main meals still to come (AC4); empty on a closed day. */
  mealsLeft: MealType[];
  /** At most `notesMax`, in the order of AC11; never empty (`on_track`). */
  observations: FeedbackObservation[];
}

/** One citation per observation kind (AC18, "Sources" of spec 008). */
export const FEEDBACK_CITATIONS: Record<FeedbackObservationKind, FeedbackCitationId> = {
  day_incomplete: 'own_targets',
  protein_low: 'issn_protein_2017',
  protein_gap: 'issn_protein_2017',
  protein_uneven: 'issn_protein_2017',
  kcal_low: 'own_targets',
  kcal_above: 'own_targets',
  fiber_low: 'efsa_fibre_2010',
  fiber_gap: 'efsa_fibre_2010',
  carbs_low_training: 'acsm_and_dc_2016',
  carbs_gap_training: 'acsm_and_dc_2016',
  on_track: 'own_targets',
};

/** The order notes are kept in (AC11); the first `notesMax` stay. */
const ORDER: readonly FeedbackObservationKind[] = [
  'protein_low',
  'protein_gap',
  'carbs_low_training',
  'carbs_gap_training',
  'fiber_low',
  'fiber_gap',
  'kcal_low',
  'protein_uneven',
  'kcal_above',
];

/** The main meals and the minute their slot ends (spec 005 AC12: `mealTypeForTime`). */
const MAIN_MEALS: readonly { meal: MealType; endsAt: number }[] = [
  { meal: 'breakfast', endsAt: 11 * 60 },
  { meal: 'lunch', endsAt: 16 * 60 + 30 },
  // The dinner slot runs past midnight: it never ends while the day is in progress.
  { meal: 'dinner', endsAt: 24 * 60 },
];

/** `HH:mm` → minutes after midnight. */
export function minuteOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** No feedback with an eating-disorder signal or without numeric targets (AC2). */
export function feedbackAvailable(flags: readonly SafetyFlag[], hasTargets: boolean): boolean {
  return hasTargets && !flags.includes('ed_soft_stop');
}

const EMPTY_NUMBERS: FeedbackNumbers = {
  nutrient: null,
  eaten: null,
  target: null,
  left: null,
  mealsLeft: [],
  perMeal: [],
};

function observation(
  kind: FeedbackObservationKind,
  numbers: Partial<FeedbackNumbers> = {},
): FeedbackObservation {
  return { kind, numbers: { ...EMPTY_NUMBERS, ...numbers }, citation: FEEDBACK_CITATIONS[kind] };
}

function amounts(nutrient: FeedbackNutrient, eaten: number, target: number) {
  const e = Math.round(eaten);
  const t = Math.round(target);
  return { nutrient, eaten: e, target: t, left: Math.max(0, t - e) };
}

/** Enough of the target is left to be worth a note, and a meal is still to come. */
const gap = (eaten: number, target: number, minLeft: number, minRatio: number) =>
  target - eaten >= minLeft && target - eaten >= minRatio * target;

/**
 * The observations of a day (AC4–AC11). A day is in progress when it is today, before 22:00 and the
 * dinner has no items; otherwise it is closed. A thin closed day only asks whether something is missing
 * (AC5): a forgotten meal must not read as under-eating.
 */
export function dailyObservations(
  day: FeedbackDay,
  targets: FeedbackTargets,
  breakdown: FeedbackBreakdown,
  context: { safetyFlags: readonly SafetyFlag[] },
  now: FeedbackNow,
): DayObservations {
  const totals = dailyTotals(day.items);
  const perMeal = mealTotals(day.items);
  const hasItems = (meal: MealType) => day.items.some((item) => item.mealType === meal);

  const inProgress =
    day.localDate === now.today && now.minuteOfDay < L.inProgressUntilMinute && !hasItems('dinner');
  const state: FeedbackState = inProgress ? 'in_progress' : 'closed';
  const mealsLeft = inProgress
    ? MAIN_MEALS.filter(({ meal, endsAt }) => now.minuteOfDay < endsAt && !hasItems(meal)).map(
        ({ meal }) => meal,
      )
    : [];

  const mealsWithItems = new Set(day.items.map((item) => item.mealType)).size;
  if (
    !inProgress &&
    (mealsWithItems < L.incompleteMealsMin || totals.kcal < L.incompleteKcalRatio * targets.kcal)
  ) {
    return { state, mealsLeft, observations: [observation('day_incomplete')] };
  }

  const found: FeedbackObservation[] = [];
  const protein = amounts('protein', totals.proteinG, targets.proteinG);
  const carbs = amounts('carbs', totals.carbsG, targets.carbsG);
  const fiberEaten = totals.fiberG ?? 0;
  const fiber = amounts('fiber', fiberEaten, targets.fiberG);
  const unknownFiberKcal = day.items
    .filter((item) => item.nutrients.fiberG === null)
    .reduce((sum, item) => sum + item.nutrients.kcal, 0);
  const fiberKnown = totals.kcal <= 0 || unknownFiberKcal <= L.fiberUnknownKcalRatio * totals.kcal;
  const carbsMin =
    breakdown.trainingFocus === 'sport_performance' && breakdown.carbsMinGPerKg !== null
      ? breakdown.carbsMinGPerKg * breakdown.referenceWeightKg
      : null;

  if (inProgress) {
    const left = mealsLeft.length > 0;
    if (left && gap(totals.proteinG, targets.proteinG, L.proteinGapMinG, L.proteinGapMinRatio)) {
      found.push(observation('protein_gap', { ...protein, mealsLeft }));
    }
    if (
      left &&
      day.trainingDay &&
      gap(totals.carbsG, targets.carbsG, L.carbsGapMinG, L.carbsGapMinRatio)
    ) {
      found.push(observation('carbs_gap_training', { ...carbs, mealsLeft }));
    }
    if (left && fiberKnown && gap(fiberEaten, targets.fiberG, L.fiberGapMinG, L.fiberGapMinRatio)) {
      found.push(observation('fiber_gap', { ...fiber, mealsLeft }));
    }
  } else {
    if (totals.proteinG < L.proteinLowRatio * targets.proteinG) {
      found.push(observation('protein_low', protein));
    }
    if (day.trainingDay) {
      if (totals.carbsG < L.carbsLowRatio * targets.carbsG) {
        found.push(observation('carbs_low_training', carbs));
      } else if (carbsMin !== null && totals.carbsG < carbsMin) {
        found.push(observation('carbs_low_training', amounts('carbs', totals.carbsG, carbsMin)));
      }
    }
    if (fiberKnown && fiberEaten < L.fiberLowRatio * targets.fiberG) {
      found.push(observation('fiber_low', fiber));
    }
    if (totals.kcal < L.kcalLowRatio * targets.kcal) {
      found.push(observation('kcal_low', amounts('kcal', totals.kcal, targets.kcal)));
    }
    const uneven = proteinSpread(perMeal, totals.proteinG, breakdown);
    if (
      uneven &&
      (breakdown.trainingFocus === 'hypertrophy' || breakdown.trainingFocus === 'strength') &&
      totals.proteinG >= L.proteinLowRatio * targets.proteinG
    ) {
      found.push(observation('protein_uneven', { ...protein, perMeal: uneven }));
    }
    if (
      totals.kcal > L.kcalAboveRatio * targets.kcal &&
      !context.safetyFlags.includes('teen_limited')
    ) {
      found.push(observation('kcal_above', amounts('kcal', totals.kcal, targets.kcal)));
    }
  }

  const observations = ORDER.flatMap((kind) => found.filter((o) => o.kind === kind)).slice(
    0,
    L.notesMax,
  );
  return {
    state,
    mealsLeft,
    observations: observations.length > 0 ? observations : [observation('on_track')],
  };
}

/**
 * The grams of protein per meal when they are uneven (AC9): fewer than two meals reach 0.25 g/kg of the
 * reference weight (at least 20 g) and one meal holds more than half the day's protein. Null otherwise.
 */
function proteinSpread(
  perMeal: Record<MealType, { proteinG: number; kcal: number }>,
  proteinG: number,
  breakdown: FeedbackBreakdown,
): FeedbackNumbers['perMeal'] | null {
  const meals = (Object.entries(perMeal) as [MealType, { proteinG: number; kcal: number }][])
    .filter(([, totals]) => totals.kcal > 0 || totals.proteinG > 0)
    .map(([mealType, totals]) => ({ mealType, grams: Math.round(totals.proteinG) }));
  if (proteinG <= 0) return null;
  const threshold = Math.max(L.unevenMinG, L.unevenGPerKg * breakdown.referenceWeightKg);
  const reaching = Object.values(perMeal).filter((t) => t.proteinG >= threshold).length;
  const top = Math.max(...Object.values(perMeal).map((t) => t.proteinG));
  return reaching < L.unevenMealsMin && top > L.unevenTopShare * proteinG ? meals : null;
}

// ── Candidates (AC12) ────────────────────────────────────────────────────────────────────────────────

/** A food the user already eats, offered to the model for one observation. */
export interface FeedbackCandidate {
  /** Short ref shown to the model (`c1`), unique across the observations of one request. */
  ref: string;
  food: Food;
  portion: Portion;
  /** Grams of the missing nutrient in the portion, to one decimal. */
  amount: number;
  /** Kcal of the portion, rounded. */
  kcal: number;
}

export type FeedbackCandidates = Partial<Record<FeedbackObservationKind, FeedbackCandidate[]>>;

const FIXABLE: Partial<Record<FeedbackObservationKind, 'proteinG' | 'fiberG' | 'carbsG'>> = {
  protein_low: 'proteinG',
  protein_gap: 'proteinG',
  fiber_low: 'fiberG',
  fiber_gap: 'fiberG',
  carbs_low_training: 'carbsG',
  carbs_gap_training: 'carbsG',
};

/**
 * The user's foods that best fill each fixable observation (AC12): recents with their last portion and
 * favourites with their first serving, ranked by the missing nutrient per portion, without portions
 * above half the day's kcal target. Suggestions never come from foods the user did not log: the catalog
 * has no allergen or diet data.
 */
export function feedbackCandidates(
  observations: readonly FeedbackObservation[],
  sources: { recents: readonly RecentFood[]; favourites: readonly Food[] },
  kcalTarget: number,
): FeedbackCandidates {
  const seen = new Set<string>();
  const pool: { food: Food; portion: Portion }[] = [];
  for (const { food, lastPortion } of sources.recents) {
    if (seen.has(food.id)) continue;
    seen.add(food.id);
    pool.push({ food, portion: initialPortion(food, lastPortion) });
  }
  for (const food of sources.favourites) {
    if (seen.has(food.id)) continue;
    seen.add(food.id);
    pool.push({ food, portion: initialPortion(food, null) });
  }

  let next = 1;
  const result: FeedbackCandidates = {};
  for (const { kind } of observations) {
    const nutrient = FIXABLE[kind];
    if (!nutrient || result[kind]) continue;
    const ranked = pool
      .flatMap(({ food, portion }) => {
        const preview = portionPreview(food, portion);
        const value = preview?.nutrients[nutrient];
        if (!preview || value === null || value === undefined || value <= 0) return [];
        if (preview.nutrients.kcal > L.candidateKcalShareMax * kcalTarget) return [];
        return [
          {
            food,
            portion,
            amount: Math.round(value * 10) / 10,
            kcal: Math.round(preview.nutrients.kcal),
          },
        ];
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, L.candidatesPerObservation);
    result[kind] = ranked.map((candidate) => ({ ...candidate, ref: `c${next++}` }));
  }
  return result;
}

// ── Validation (AC14) ────────────────────────────────────────────────────────────────────────────────

/**
 * Restriction and compensation (AC14, "Safety"): a note with any of these falls back to the fixed
 * wording. Matched on lower-case text without accents. To review with the professional reviewer.
 */
export const COMPENSATION_TERMS: readonly RegExp[] = [
  // es
  /\bsalt(a|ar|arte|ate|atela|atelo|es|e|ando)\b/,
  /\bayun/,
  /\bquem(a|ar|arlo|arla|alo|ala|as|e|es)\b/,
  /\bcompens/,
  /\bpurg/,
  /\bvomit/,
  /\bcomer? menos\b/,
  /\bcomas menos\b/,
  /\bmenos manana\b/,
  /\brestring/,
  /\brestricc/,
  /\bdeja de comer\b/,
  /\bno (cenes|comas|desayunes|meriendes)\b/,
  /\bdetox\b/,
  // en
  /\bskip/,
  /\bfast(s|ing|ed)?\b/,
  /\bburn/,
  /\bcompensat/,
  /\bmake up for\b/,
  /\bpurg/,
  /\beat less\b/,
  /\bcut (back|down)\b/,
  /\brestrict/,
  /\bstarv/,
  /\bcleanse\b/,
];

const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function hasCompensationTerm(text: string): boolean {
  const plain = normalize(text);
  return COMPENSATION_TERMS.some((term) => term.test(plain));
}

function usableText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.length > L.textMax) return null;
  // Numbers come only from core (AC14): the chip shows them.
  if (/\d/.test(trimmed)) return null;
  if (hasCompensationTerm(trimmed)) return null;
  return trimmed;
}

const best = (candidates: readonly FeedbackCandidate[] | undefined) =>
  (candidates ?? []).slice(0, L.suggestionsPerNote).map(({ food, portion }) => ({ food, portion }));

/** Every note in fixed wording, with core's best candidates (AC15). */
export function templateNotes(
  observations: readonly FeedbackObservation[],
  candidates: FeedbackCandidates,
): FeedbackNote[] {
  return observations.map((obs) => ({
    observation: obs,
    text: null,
    source: 'template',
    suggestions: best(candidates[obs.kind]),
  }));
}

/**
 * The notes to show from the model's output (AC14): one per observation core produced, in core's
 * order. A text with digits, too long or with a compensation term falls back to the fixed wording;
 * suggestions not among that observation's candidates are dropped; an observation the model left out
 * gets the fixed wording. A fixed-wording note carries core's best candidates.
 */
export function validateFeedback(
  reading: FeedbackReading,
  observations: readonly FeedbackObservation[],
  candidates: FeedbackCandidates,
): FeedbackNote[] {
  return observations.map((obs) => {
    const note = reading.notes.find((n) => n.observation === obs.kind);
    const text = note ? usableText(note.text) : null;
    if (!note || text === null) return templateNotes([obs], candidates)[0]!;
    const own = new Map((candidates[obs.kind] ?? []).map((c) => [c.ref, c]));
    const refs = [...new Set(note.suggestionRefs)].filter((ref) => own.has(ref));
    return {
      observation: obs,
      text,
      source: 'ai',
      suggestions: refs.slice(0, L.suggestionsPerNote).map((ref) => {
        const { food, portion } = own.get(ref)!;
        return { food, portion };
      }),
    };
  });
}

/** One line per citation kind used, in the order of the notes (AC18). */
export function feedbackCitations(notes: readonly FeedbackNote[]): FeedbackCitationId[] {
  return [...new Set(notes.map((note) => note.observation.citation))];
}

// ── Fingerprint (AC17) ───────────────────────────────────────────────────────────────────────────────

/**
 * A short hash of a day's items (their ids and `recordedAt`), computed the same way by the API and the
 * app: when it changes, the feedback shown is stale. Order and the time-zone format of `recordedAt` do
 * not matter.
 */
export function feedbackFingerprint(items: readonly Pick<MealItem, 'id' | 'recordedAt'>[]): string {
  const keys = items.map((item) => `${item.id}@${Date.parse(item.recordedAt)}`).sort();
  // FNV-1a, 32 bits.
  let hash = 0x811c9dc5;
  for (const char of keys.join('|')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${items.length}-${hash.toString(16).padStart(8, '0')}`;
}
