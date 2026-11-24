import type {
  ActivityType,
  WorkoutReading,
  WorkoutReadingActivity,
  WorkoutReadingExercise,
  WorkoutReadingSetGroup,
} from '@pt/contracts';

/**
 * The mock's stand-in for the workout model (spec 012): no AI, simple rules over the sentence, and the
 * same `workoutDraft` of `@pt/core` as the API. Enough for the E2E journeys and for trying the draft
 * screens without spending money:
 *
 * - "ayer", "anteayer", "hoy" set the day; "a las 7 de la tarde" the start time; "me dolía" the pain.
 * - "pádel", "fútbol", "spinning"/"clase", "corrí"/"correr" are activities, with "N min", "una hora"
 *   or "hora y media", and a distance in km noted.
 * - Everything else is split at commas, "y" and "+" into exercises: "4x8 con 60", "3x10", "3 x 45 s",
 *   "20 min" and "con 135 lbs" are read; the rest of the words are searched (`find`). A part that
 *   matches no exercise is left unresolved.
 * - A sentence with nothing of that is `not_workout`, or `unclear` when it talks about training.
 */

const ACTIVITIES: [RegExp, ActivityType][] = [
  [/p[aá]del/, 'padel'],
  [/f[uú]tbol/, 'football'],
  [/spinning|clase/, 'group_class'],
  [/corr[ií]|correr/, 'running'],
];

const TRAINING_WORDS = /entren|gym|gimnasio|pierna|pecho|espalda|lo de siempre/;

function minutesOf(part: string): number | null {
  if (/hora y media/.test(part)) return 90;
  if (/una hora/.test(part)) return 60;
  const minutes = /(\d+)\s*(?:min|minutos)\b/.exec(part);
  return minutes ? Number(minutes[1]) : null;
}

function activityOf(part: string): WorkoutReadingActivity | null {
  const found = ACTIVITIES.find(([pattern]) => pattern.test(part));
  if (!found) return null;
  return {
    mention: part,
    activity: found[1],
    minutes: minutesOf(part),
    sessionRpe: null,
    distanceSaid: /\d+\s*km/.test(part),
  };
}

const group = (over: Partial<WorkoutReadingSetGroup>): WorkoutReadingSetGroup => ({
  count: 1,
  reps: null,
  weight: null,
  weightUnit: 'kg',
  durationS: null,
  distanceM: null,
  ...over,
});

/** The sets of one part and the words left for the search. */
function setsOf(part: string): { groups: WorkoutReadingSetGroup[]; words: string } {
  let words = part;
  const take = (pattern: RegExp) => {
    const match = pattern.exec(words);
    if (match) words = words.replace(match[0], ' ');
    return match;
  };
  const seconds = take(/(\d+)\s*x\s*(\d+)\s*(?:s|seg|segundos)\b/);
  if (seconds) {
    const groups = [group({ count: Number(seconds[1]), durationS: Number(seconds[2]) })];
    return { groups, words };
  }
  const sets = take(/(\d+)\s*x\s*(\d+)/);
  const weight = take(/\b(?:con|a)\s+(\d+(?:[.,]\d+)?)\s*(kg|kilos|lbs?|libras)?/);
  const weightKg = weight ? Number(weight[1]!.replace(',', '.')) : null;
  const weightUnit = weight?.[2] && /^l/.test(weight[2]) ? 'lb' : 'kg';
  if (sets) {
    const groups = [
      group({ count: Number(sets[1]), reps: Number(sets[2]), weight: weightKg, weightUnit }),
    ];
    return { groups, words };
  }
  const minutes = take(/(\d+)\s*(?:min|minutos)\b/);
  if (minutes) return { groups: [group({ durationS: Number(minutes[1]) * 60 })], words };
  return {
    groups: weightKg === null ? [] : [group({ weight: weightKg, weightUnit })],
    words,
  };
}

export function mockWorkoutReading(
  sentence: string,
  find: (query: string) => string | null,
): WorkoutReading {
  let text = sentence.toLowerCase();
  const daysAgo = /anteayer/.test(text)
    ? 2
    : /\bayer\b/.test(text)
      ? 1
      : /\bhoy\b/.test(text)
        ? 0
        : null;
  text = text.replace(/\b(anteayer|ayer|hoy)\b:?/g, ' ');
  const clock = /a las (\d{1,2})(?::(\d{2}))?( de la tarde| de la noche)?/.exec(text);
  let startTime: string | null = null;
  if (clock) {
    const hour = Number(clock[1]) + (clock[3] && Number(clock[1]) < 12 ? 12 : 0);
    startTime = `${String(hour).padStart(2, '0')}:${clock[2] ?? '00'}`;
    text = text.replace(clock[0], ' ');
  }
  const painMentioned = /dolor|duele|dol[ií]a|molestia|lesi/.test(text);
  text = text.replace(/,?\s*(?:me dol[ií]a|me duele|con molestias)[^,]*/g, ' ');

  const exercises: WorkoutReadingExercise[] = [];
  const activities: WorkoutReadingActivity[] = [];
  const parts = text
    .split(/,|\+|;|\s+y\s+(?!media)|\s+por la tarde\s+|\s+luego\s+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const part of parts) {
    const activity = activityOf(part);
    if (activity) {
      activities.push(activity);
      continue;
    }
    const { groups, words } = setsOf(part);
    const query = words
      .replace(/\b(de|del|la|el|en|series?)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!query) continue;
    const ref = find(query);
    if (!ref && groups.length === 0) continue;
    exercises.push({ mention: part, exerciseRef: ref, setGroups: groups });
  }

  if (exercises.length === 0 && activities.length === 0) {
    return {
      status: TRAINING_WORDS.test(sentence.toLowerCase()) ? 'unclear' : 'not_workout',
      gym: null,
      activities: [],
      daysAgo: null,
      startTime: null,
      painMentioned: false,
    };
  }
  return {
    status: 'ok',
    gym: exercises.length ? { exercises, minutes: null, sessionRpe: null } : null,
    activities,
    daysAgo,
    startTime,
    painMentioned,
  };
}
