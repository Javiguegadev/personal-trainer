import type { ExerciseTracking, SetValues } from '@pt/contracts';

/**
 * Helpers for an exercise of a sentence the catalog lacks (spec 012 AC7): its name for the picker's
 * search and for "Crear ejercicio", and how the new exercise is tracked, from the sets said.
 */

/** Words of set notation and connectors that never start or end an exercise name (es and en). */
const EDGE_WORDS = new Set([
  'x',
  '×',
  'kg',
  'kgs',
  'kilo',
  'kilos',
  'lb',
  'lbs',
  'libra',
  'libras',
  'pound',
  'pounds',
  'serie',
  'series',
  'set',
  'sets',
  'rep',
  'reps',
  'repeticion',
  'repetición',
  'repeticiones',
  's',
  'seg',
  'segs',
  'segundo',
  'segundos',
  'sec',
  'secs',
  'second',
  'seconds',
  'min',
  'mins',
  'minuto',
  'minutos',
  'minute',
  'minutes',
  'm',
  'metro',
  'metros',
  'km',
  'kms',
  'lastre',
  'veces',
  'times',
  'con',
  'a',
  'al',
  'de',
  'del',
  'en',
  'y',
  'e',
  'o',
  'por',
  'para',
  'cada',
  'of',
  'with',
  'at',
  'and',
  'for',
  'in',
  'by',
  'each',
]);

const HAS_DIGIT = /\d/;

/**
 * The name in the words of a mention ("press Larsen 4x8 con 60" → "Press Larsen"): numbers dropped,
 * and set notation and connectors trimmed at both ends. Empty when only sets were said.
 */
export function mentionName(mention: string): string {
  const words = mention
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ''))
    .filter((word) => word !== '' && !HAS_DIGIT.test(word));
  while (words.length && EDGE_WORDS.has(words[0]!.toLowerCase())) words.shift();
  while (words.length && EDGE_WORDS.has(words.at(-1)!.toLowerCase())) words.pop();
  const name = words.join(' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * How an exercise said with these sets is tracked: a distance, a time without reps, a weight, or reps
 * only. Null when no value was said.
 */
export function trackingFromSets(sets: readonly SetValues[]): ExerciseTracking | null {
  const said = (field: keyof SetValues) => sets.some((s) => s[field] !== null);
  if (said('distanceM')) return 'distance_duration';
  if (said('durationS') && !said('reps')) return 'duration';
  if (said('weightKg')) return 'weight_reps';
  if (said('reps')) return 'reps';
  return null;
}
