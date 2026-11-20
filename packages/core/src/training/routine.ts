import type {
  EquipmentAccess,
  Exercise,
  Locale,
  PlannedActivity,
  Program,
  ProgramExercise,
  SafetyFlag,
  TrainingExperience,
  TrainingFocus,
} from '@pt/contracts';

/**
 * The starter routine of spec 010 (AC13–AC15): templates as data, chosen by gym days, experience,
 * focus and equipment, and trimmed to the minutes of a session. Exercises are keys of the curated
 * catalog of spec 009 (a test in `@pt/db` checks they exist). Every number here is PROVISIONAL until
 * the professional review (spec 010 Open questions); conservative volumes, no sets to failure and no
 * 1–3-rep work for anyone (Safety).
 */

/** A routine before it is saved: the editor's state (AC16). `recordedAt` is set by the write. */
export type ProgramDraft = Omit<Program, 'recordedAt'>;

export type RoutineTemplateKey =
  'full-body' | 'full-body-ab' | 'full-body-abc' | 'upper-lower' | 'push-pull-legs';

export type RoutineSessionKey =
  | 'full_body'
  | 'full_body_a'
  | 'full_body_b'
  | 'full_body_c'
  | 'upper_a'
  | 'lower_a'
  | 'upper_b'
  | 'lower_b'
  | 'push'
  | 'pull'
  | 'legs';

/** One movement and its exercise per equipment level; null when that equipment has none. */
const MOVEMENTS = {
  squat: {
    full_gym: 'sentadilla',
    home_dumbbells: 'sentadilla-goblet',
    bodyweight: 'sentadilla-sin-peso',
  },
  legPress: {
    full_gym: 'prensa',
    home_dumbbells: 'sentadilla-mancuernas',
    bodyweight: 'zancadas-caminando',
  },
  splitSquat: {
    full_gym: 'sentadilla-bulgara',
    home_dumbbells: 'sentadilla-bulgara',
    bodyweight: 'zancadas-caminando',
  },
  rdl: {
    full_gym: 'peso-muerto-rumano',
    home_dumbbells: 'peso-muerto-rumano-mancuernas',
    bodyweight: 'puente-gluteo-una-pierna',
  },
  hipThrust: {
    full_gym: 'hip-thrust',
    home_dumbbells: 'puente-gluteo',
    bodyweight: 'puente-gluteo',
  },
  legCurl: { full_gym: 'curl-femoral-tumbado', home_dumbbells: null, bodyweight: null },
  legCurlSeated: { full_gym: 'curl-femoral-sentado', home_dumbbells: null, bodyweight: null },
  legExtension: {
    full_gym: 'extension-cuadriceps',
    home_dumbbells: 'zancadas',
    bodyweight: 'sentadilla-sin-peso',
  },
  calves: { full_gym: 'gemelos-pie', home_dumbbells: 'gemelos-mancuerna', bodyweight: null },
  calvesSeated: {
    full_gym: 'gemelos-sentado',
    home_dumbbells: 'gemelos-mancuerna',
    bodyweight: null,
  },
  bench: {
    full_gym: 'press-banca',
    home_dumbbells: 'press-banca-mancuernas',
    bodyweight: 'flexiones',
  },
  inclinePress: {
    full_gym: 'press-inclinado-mancuernas',
    home_dumbbells: 'press-inclinado-mancuernas',
    bodyweight: 'flexiones-declinadas',
  },
  ohp: {
    full_gym: 'press-militar',
    home_dumbbells: 'press-hombros-mancuernas',
    bodyweight: 'flexiones-declinadas',
  },
  dbShoulderPress: {
    full_gym: 'press-hombros-mancuernas',
    home_dumbbells: 'press-arnold',
    bodyweight: 'flexiones-declinadas',
  },
  row: {
    full_gym: 'remo-barra',
    home_dumbbells: 'remo-dos-mancuernas',
    bodyweight: 'remo-invertido',
  },
  cableRow: {
    full_gym: 'remo-polea-baja',
    home_dumbbells: 'remo-mancuerna',
    bodyweight: 'remo-invertido',
  },
  // Bodyweight: the inverted row is the only pull, so every session keeps one (push/pull balance).
  pulldown: {
    full_gym: 'jalon-pecho',
    home_dumbbells: 'pullover-mancuerna',
    bodyweight: 'remo-invertido',
  },
  lateralRaise: {
    full_gym: 'elevaciones-laterales',
    home_dumbbells: 'elevaciones-laterales',
    bodyweight: null,
  },
  facePull: { full_gym: 'face-pull', home_dumbbells: 'pajaros', bodyweight: null },
  curl: { full_gym: 'curl-barra', home_dumbbells: 'curl-mancuernas', bodyweight: null },
  hammerCurl: { full_gym: 'curl-martillo', home_dumbbells: 'curl-martillo', bodyweight: null },
  triceps: {
    full_gym: 'triceps-cuerda',
    home_dumbbells: 'triceps-tras-nuca',
    // No bench dips (extreme shoulder extension) and no extra push without a pull.
    bodyweight: null,
  },
  tricepsOverhead: {
    full_gym: 'triceps-tras-nuca-cuerda',
    home_dumbbells: 'press-frances-mancuernas',
    bodyweight: null,
  },
  plank: { full_gym: 'plancha', home_dumbbells: 'plancha', bodyweight: 'plancha' },
  crunch: { full_gym: 'crunch-polea', home_dumbbells: 'crunch', bodyweight: 'crunch' },
} as const satisfies Record<string, Record<EquipmentAccess, string | null>>;
type Movement = keyof typeof MOVEMENTS;

/** Easier variants for beginners: feet-elevated push-ups are harder than plain ones. */
const BEGINNER_SWAPS: Readonly<Record<string, string>> = {
  'flexiones-declinadas': 'flexiones-inclinadas',
};

/** Multi-joint lifts: the strength focus gives them its lowest rep range (AC15). */
const COMPOUND: ReadonlySet<Movement> = new Set<Movement>([
  'squat',
  'legPress',
  'splitSquat',
  'rdl',
  'hipThrust',
  'bench',
  'inclinePress',
  'ohp',
  'dbShoulderPress',
  'row',
  'cableRow',
  'pulldown',
]);

/** Each session in priority order: trimming drops exercises from the end (AC15). */
const SESSIONS: Record<RoutineSessionKey, readonly Movement[]> = {
  full_body: ['squat', 'bench', 'cableRow', 'rdl', 'lateralRaise', 'plank'],
  full_body_a: ['squat', 'bench', 'cableRow', 'rdl', 'lateralRaise', 'plank'],
  full_body_b: ['legPress', 'ohp', 'pulldown', 'hipThrust', 'curl', 'triceps', 'crunch'],
  full_body_c: [
    'splitSquat',
    'inclinePress',
    'row',
    'legCurl',
    'facePull',
    'tricepsOverhead',
    'plank',
  ],
  upper_a: ['bench', 'row', 'ohp', 'pulldown', 'curl', 'triceps'],
  lower_a: ['squat', 'rdl', 'legExtension', 'legCurl', 'calves', 'plank'],
  upper_b: [
    'inclinePress',
    'pulldown',
    'dbShoulderPress',
    'cableRow',
    'lateralRaise',
    'hammerCurl',
    'tricepsOverhead',
  ],
  lower_b: ['legPress', 'hipThrust', 'splitSquat', 'legCurlSeated', 'calvesSeated', 'crunch'],
  push: ['bench', 'ohp', 'inclinePress', 'lateralRaise', 'triceps', 'tricepsOverhead'],
  pull: ['pulldown', 'row', 'cableRow', 'facePull', 'curl', 'hammerCurl'],
  legs: ['squat', 'rdl', 'legPress', 'legCurl', 'calves', 'plank'],
};

/** The sessions of each template, in rotation order. */
export const ROUTINE_TEMPLATES: Record<RoutineTemplateKey, readonly RoutineSessionKey[]> = {
  'full-body': ['full_body'],
  'full-body-ab': ['full_body_a', 'full_body_b'],
  'full-body-abc': ['full_body_a', 'full_body_b', 'full_body_c'],
  'upper-lower': ['upper_a', 'lower_a', 'upper_b', 'lower_b'],
  'push-pull-legs': ['push', 'pull', 'legs'],
};

/** Every catalog key the templates use, for the test that reads the curated catalog. */
export function routineExerciseKeys(): string[] {
  const keys = [
    ...Object.values(MOVEMENTS).flatMap((m): (string | null)[] => Object.values(m)),
    ...Object.values(BEGINNER_SWAPS),
  ];
  return [...new Set(keys.filter((k): k is string => k !== null))].sort();
}

/** Minutes one set takes, rest included, to fit a session in the user's time (AC15). */
export const MINUTES_PER_SET = 2.5;
/** A trimmed session keeps at least this many exercises. */
export const MIN_ROUTINE_EXERCISES = 4;
/** At or below this length a session keeps 4 exercises with 2 sets. */
export const SHORT_SESSION_MINUTES = 30;
const MIN_TRIMMED_SETS = 2;

/** The template for the answers (AC15, Safety). */
export function chooseRoutineTemplate(input: {
  days: number;
  experience: TrainingExperience;
  equipment: EquipmentAccess;
  focus: TrainingFocus;
}): RoutineTemplateKey {
  const { days, experience } = input;
  const beginner = experience === 'beginner';
  if (days <= 1) return 'full-body';
  if (days === 2) return 'full-body-ab';
  if (days === 3) return beginner ? 'full-body-ab' : 'full-body-abc';
  // Sport performance never gets more than 3 distinct sessions; bodyweight has too few exercises for
  // a split, so both stay on full body.
  if (input.focus === 'sport_performance' || input.equipment === 'bodyweight') {
    return beginner ? 'full-body-ab' : 'full-body-abc';
  }
  if (days === 4 || beginner) return 'upper-lower';
  return 'push-pull-legs';
}

type Target = Pick<ProgramExercise, 'sets' | 'repsMin' | 'repsMax' | 'durationS' | 'restS'>;

/** Sets, rep range, time and rest of one exercise (AC15, Safety). */
export function routineTarget(input: {
  compound: boolean;
  tracking: Exercise['tracking'];
  experience: TrainingExperience;
  focus: TrainingFocus;
  teen: boolean;
}): Target {
  const { compound, experience, focus } = input;
  const base =
    experience === 'beginner' ? (compound ? 3 : 2) : experience === 'advanced' && compound ? 4 : 3;
  const light = focus === 'general_fitness' || focus === 'sport_performance';
  const sets = light ? Math.min(base, 3) : base;
  if (input.tracking === 'duration') {
    return {
      sets,
      repsMin: null,
      repsMax: null,
      durationS: experience === 'beginner' ? 30 : 45,
      restS: 60,
    };
  }
  if (input.tracking === 'distance_duration') {
    return { sets, repsMin: null, repsMax: null, durationS: null, restS: 90 };
  }
  const [repsMin, repsMax] =
    focus === 'strength'
      ? compound && !input.teen
        ? [4, 6]
        : [6, 10]
      : focus === 'hypertrophy'
        ? [8, 12]
        : [10, 15];
  const restS = compound ? (focus === 'strength' ? 180 : 120) : 90;
  return { sets, repsMin, repsMax, durationS: null, restS };
}

/**
 * The session cut to the user's minutes (AC15): about 2.5 min per set with rest. Exercises are dropped
 * from the end down to 4, then sets are lowered (not below 2) from the last exercise back. A session of
 * 30 min or less keeps the first 4 exercises with 2 sets.
 */
export function trimToMinutes<T extends { sets: number }>(
  exercises: readonly T[],
  minutes: number,
): T[] {
  if (minutes <= SHORT_SESSION_MINUTES) {
    return exercises
      .slice(0, MIN_ROUTINE_EXERCISES)
      .map((e) => ({ ...e, sets: Math.min(e.sets, MIN_TRIMMED_SETS) }));
  }
  const budget = Math.floor(minutes / MINUTES_PER_SET);
  const total = (list: readonly T[]) => list.reduce((sum, e) => sum + e.sets, 0);
  const kept = exercises.map((e) => ({ ...e }));
  while (kept.length > MIN_ROUTINE_EXERCISES && total(kept) > budget) kept.pop();
  for (let i = kept.length - 1; i >= 0 && total(kept) > budget;) {
    const exercise = kept[i]!;
    if (exercise.sets > MIN_TRIMMED_SETS) exercise.sets--;
    else i--;
  }
  return kept;
}

/** The gym days and minutes of the profile's strength activities (AC13, AC14); null without one. */
export function routineDays(
  activities: readonly PlannedActivity[],
): { days: number; minutes: number } | null {
  const strength = activities.filter((a) => a.kind === 'strength');
  if (strength.length === 0) return null;
  return {
    days: Math.min(
      7,
      strength.reduce((sum, a) => sum + a.sessionsPerWeek, 0),
    ),
    minutes: Math.min(...strength.map((a) => a.minutesPerSession)),
  };
}

/** What the wizard and the routine screen do for the user's safety flags (spec 010 Safety). */
export function routineSafety(flags: readonly SafetyFlag[]): {
  /** Pregnancy: no template, an empty routine built by hand. */
  buildsTemplate: boolean;
  /** Injury or a medical condition: "Si algo te duele, para y consulta…". */
  showsPainLine: boolean;
} {
  return {
    buildsTemplate: !flags.includes('pregnancy'),
    showsPainLine: flags.includes('injury') || flags.includes('medical_condition'),
  };
}

export type RoutineCatalogEntry = Pick<Exercise, 'id' | 'nameEs' | 'nameEn' | 'tracking'>;

export interface RoutineNames {
  program: (template: RoutineTemplateKey) => string;
  session: (session: RoutineSessionKey) => string;
}

const labelOf = (exercise: RoutineCatalogEntry, locale: Locale) =>
  locale === 'en' ? exercise.nameEn : exercise.nameEs;

/**
 * The proposed routine (AC15), or null with pregnancy (the wizard offers `emptyRoutine` instead). An
 * exercise missing from the catalog, or repeated in a session, is skipped.
 */
export function starterRoutine(
  input: {
    days: number;
    minutes: number;
    experience: TrainingExperience;
    equipment: EquipmentAccess;
    focus: TrainingFocus;
    flags: readonly SafetyFlag[];
  },
  deps: {
    catalogByKey: ReadonlyMap<string, RoutineCatalogEntry>;
    locale: Locale;
    newId: () => string;
    names: RoutineNames;
  },
): ProgramDraft | null {
  if (!routineSafety(input.flags).buildsTemplate) return null;
  const teen = input.flags.includes('teen_limited');
  const templateKey = chooseRoutineTemplate(input);
  const sessions = ROUTINE_TEMPLATES[templateKey].map((sessionKey) => {
    const used = new Set<string>();
    const exercises: ProgramExercise[] = [];
    for (const movement of SESSIONS[sessionKey]) {
      const base: string | null = MOVEMENTS[movement][input.equipment];
      const key = base && input.experience === 'beginner' ? (BEGINNER_SWAPS[base] ?? base) : base;
      const exercise = key === null ? undefined : deps.catalogByKey.get(key);
      if (!key || !exercise || used.has(key)) continue;
      used.add(key);
      exercises.push({
        exerciseId: exercise.id,
        label: labelOf(exercise, deps.locale),
        tracking: exercise.tracking,
        ...routineTarget({
          compound: COMPOUND.has(movement),
          tracking: exercise.tracking,
          experience: input.experience,
          focus: input.focus,
          teen,
        }),
      });
    }
    return {
      id: deps.newId(),
      name: deps.names.session(sessionKey),
      exercises: trimToMinutes(exercises, input.minutes),
    };
  });
  return {
    id: deps.newId(),
    name: deps.names.program(templateKey),
    origin: 'template',
    templateKey,
    sessions,
  };
}

/** A routine built by hand (pregnancy, Safety): one empty session. */
export function emptyRoutine(input: {
  newId: () => string;
  name: string;
  sessionName: string;
}): ProgramDraft {
  return {
    id: input.newId(),
    name: input.name,
    origin: 'user',
    templateKey: null,
    sessions: [{ id: input.newId(), name: input.sessionName, exercises: [] }],
  };
}
