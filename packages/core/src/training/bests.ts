import {
  WORKOUT_LIMITS,
  type DatedValue,
  type ExerciseSession,
  type ExerciseStats,
  type ExerciseTracking,
  type PersonalBests,
  type SetValues,
  type WorkoutSet,
} from '@pt/contracts';
import { roundTo } from '../units';

export const NO_BESTS: PersonalBests = {
  heaviestKg: null,
  oneRepMaxKg: null,
  mostReps: null,
  longestS: null,
  longestM: null,
};

export type BestKind = keyof PersonalBests;

/** Rounds to the nearest 0.5 kg. */
const half = (kg: number) => Math.round(kg * 2) / 2;

/**
 * Epley estimate of the one-rep max (AC14): weight × (1 + reps / 30), only for 1–12 reps, equal to the
 * weight for 1 rep, rounded to 0.5 kg. Null outside that range.
 */
export function estimatedOneRepMax(weightKg: number, reps: number): number | null {
  if (reps < 1 || reps > WORKOUT_LIMITS.oneRepMaxRepsMax || weightKg <= 0) return null;
  return half(reps === 1 ? weightKg : weightKg * (1 + reps / 30));
}

/** The values a set scores for each best of its tracking (AC14), already rounded. */
export function setScores(
  values: SetValues,
  tracking: ExerciseTracking,
): Partial<Record<BestKind, number>> {
  switch (tracking) {
    case 'weight_reps': {
      if (values.weightKg === null || values.reps === null) return {};
      const oneRm = estimatedOneRepMax(values.weightKg, values.reps);
      return {
        heaviestKg: roundTo(values.weightKg, 2),
        ...(oneRm !== null ? { oneRepMaxKg: oneRm } : {}),
      };
    }
    case 'reps':
      return values.reps !== null ? { mostReps: values.reps } : {};
    case 'duration':
      return values.durationS !== null ? { longestS: values.durationS } : {};
    case 'distance_duration':
      return values.distanceM !== null ? { longestM: values.distanceM } : {};
  }
}

/** Adds one set to the bests; a best changes only when strictly beaten, so its date is the first time. */
export function addToBests(
  bests: PersonalBests,
  values: SetValues,
  tracking: ExerciseTracking,
  localDate: string,
): PersonalBests {
  const next = { ...bests };
  for (const [kind, value] of Object.entries(setScores(values, tracking)) as [BestKind, number][]) {
    const current = next[kind];
    if (current === null || value > current.value) next[kind] = { value, localDate };
  }
  return next;
}

/** The bests of an exercise over its sessions, in any order (AC14). */
export function personalBests(
  sessions: readonly Pick<ExerciseSession, 'localDate' | 'sets'>[],
  tracking: ExerciseTracking,
): PersonalBests {
  const ordered = [...sessions].sort((a, b) => a.localDate.localeCompare(b.localDate));
  let bests = NO_BESTS;
  for (const session of ordered) {
    for (const set of session.sets) bests = addToBests(bests, set, tracking, session.localDate);
  }
  return bests;
}

export interface NewRecord {
  kind: BestKind;
  value: number;
}

/**
 * The bests a set beats (AC10). An exercise with no history gets no badge: there must be a best to
 * beat, so the first session of an exercise never shows one.
 */
export function newBests(
  values: SetValues,
  tracking: ExerciseTracking,
  bests: PersonalBests,
): NewRecord[] {
  const records: NewRecord[] = [];
  for (const [kind, value] of Object.entries(setScores(values, tracking)) as [BestKind, number][]) {
    const current: DatedValue | null = bests[kind];
    if (current !== null && value > current.value) records.push({ kind, value });
  }
  return records;
}

export interface ExerciseSetRow {
  workoutId: string;
  localDate: string;
  /** Start of the workout (ISO), to order sessions of the same day. */
  startedAt: string;
  exerciseId: string;
  tracking: ExerciseTracking;
  set: WorkoutSet;
}

/**
 * `GET /me/exercises/stats` (AC7, AC9, AC10, AC14): for every exercise done, the last session's sets,
 * the bests over the whole history and when it was last done; most recently done first.
 */
export function buildExerciseStats(rows: readonly ExerciseSetRow[]): ExerciseStats[] {
  const byExercise = new Map<
    string,
    Map<string, { session: ExerciseSession; startedAt: string }>
  >();
  const tracking = new Map<string, ExerciseTracking>();
  for (const row of rows) {
    tracking.set(row.exerciseId, row.tracking);
    const sessions = byExercise.get(row.exerciseId) ?? new Map();
    const entry = sessions.get(row.workoutId) ?? {
      session: { workoutId: row.workoutId, localDate: row.localDate, sets: [] },
      startedAt: row.startedAt,
    };
    entry.session.sets.push(row.set);
    sessions.set(row.workoutId, entry);
    byExercise.set(row.exerciseId, sessions);
  }
  const stats: ExerciseStats[] = [];
  for (const [exerciseId, sessions] of byExercise) {
    const all = [...sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const last = all[0]!;
    stats.push({
      exerciseId,
      last: {
        ...last.session,
        sets: [...last.session.sets].sort((a, b) => a.setNumber - b.setNumber),
      },
      bests: personalBests(
        all.map((s) => s.session),
        tracking.get(exerciseId)!,
      ),
      lastDoneAt: last.startedAt,
    });
  }
  return stats.sort((a, b) => b.lastDoneAt.localeCompare(a.lastDoneAt));
}

/** The last rest used for an exercise (AC9): the last set of the last session with a rest. */
export function lastRest(stats: Pick<ExerciseStats, 'last'> | null): number | null {
  if (!stats) return null;
  for (let i = stats.last.sets.length - 1; i >= 0; i--) {
    const rest = stats.last.sets[i]!.restS;
    if (rest !== null && rest > 0) return rest;
  }
  return null;
}

/** The chart of AC15: the best estimated 1RM of each session, oldest first. */
export function oneRepMaxSeries(
  sessions: readonly Pick<ExerciseSession, 'localDate' | 'sets'>[],
): { localDate: string; value: number }[] {
  return [...sessions]
    .map((s) => {
      const values = s.sets
        .map((set) =>
          set.weightKg !== null && set.reps !== null
            ? estimatedOneRepMax(set.weightKg, set.reps)
            : null,
        )
        .filter((v): v is number => v !== null);
      return { localDate: s.localDate, value: values.length ? Math.max(...values) : null };
    })
    .filter((p): p is { localDate: string; value: number } => p.value !== null)
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
}
