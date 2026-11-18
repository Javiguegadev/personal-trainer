import type {
  FeedbackObservation,
  FeedbackObservationKind,
  FeedbackReading,
  Locale,
} from '@pt/contracts';
import type { FeedbackCandidates } from '@pt/core';

/**
 * The mock's stand-in for the feedback model (spec 008): no AI, one scripted note per kind that food
 * can fix, with the first candidate as its suggestion. The other kinds are left out, so they fall back
 * to the fixed wording, as with a real model that skips a note. It goes through the same
 * `validateFeedback` of `@pt/core` as the API.
 */
const SCRIPT: Partial<Record<FeedbackObservationKind, Record<Locale, string>>> = {
  protein_gap: {
    es: 'Aún puedes sumar proteína en lo que queda del día: algo que ya sueles comer sirve.',
    en: 'You can still add some protein later today: a food you already eat works well.',
  },
  protein_low: {
    es: 'La próxima vez, una ración más de proteína en alguna comida te acerca a tu objetivo.',
    en: 'Next time, one more serving of protein at a meal brings you closer to your target.',
  },
  fiber_gap: {
    es: 'Algún alimento con fibra que ya sueles comer, en la próxima comida, la suma.',
    en: 'A fibre-rich food you already eat, at your next meal, adds some.',
  },
  fiber_low: {
    es: 'La próxima vez, algún alimento con fibra que ya sueles comer te acerca a tu objetivo.',
    en: 'Next time, a fibre-rich food you already eat gets you closer to your target.',
  },
  carbs_gap_training: {
    es: 'Hoy entrenas: unos hidratos en la próxima comida te ayudan a rendir y recuperar.',
    en: 'You train today: some carbohydrates at your next meal help you perform and recover.',
  },
  carbs_low_training: {
    es: 'En un día de entreno, algo más de hidratos te ayuda a rendir y recuperar.',
    en: 'On a training day, some more carbohydrates help you perform and recover.',
  },
};

export function mockFeedbackReading(
  observations: readonly FeedbackObservation[],
  candidates: FeedbackCandidates,
  locale: Locale,
): FeedbackReading {
  return {
    notes: observations.flatMap(({ kind }) => {
      const text = SCRIPT[kind]?.[locale];
      if (!text) return [];
      const first = candidates[kind]?.[0];
      return [{ observation: kind, text, suggestionRefs: first ? [first.ref] : [] }];
    }),
  };
}
