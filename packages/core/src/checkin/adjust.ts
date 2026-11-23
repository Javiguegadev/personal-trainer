import type { Readiness } from '@pt/contracts';
import type { LiveExercise, LiveSession, LiveSet } from '../training/session';
import {
  READINESS_RULES,
  readinessHeadline,
  sessionCut,
  type ReadinessHeadline,
} from './readiness';

/**
 * The readiness adjustment of a live session (spec 011 AC7, AC8). It is applied once, when a routine
 * session starts live for today, and kept on the session in device storage, so a check-in saved
 * later never changes a started session (AC10) and "Entrenar normal" works after a restart. Nothing of
 * it reaches the stored workout.
 */
export interface SessionReadiness {
  level: 'reduced' | 'low';
  /** The reason the banner shows. */
  headline: ReadinessHeadline;
  /** The last set of each exercise that lost one, to put back with "Entrenar normal". */
  removedSets: { exerciseUid: string; sets: LiveSet[] }[];
  /** The last exercise of a low day, with its position. */
  removedExercise: { index: number; exercise: LiveExercise } | null;
}

/**
 * On a `reduced` or `low` day, a routine session started live for `today` loses one set from every
 * exercise with 3 or more and, on a low day with more than 4 exercises, its last exercise. Any other
 * session started live today (free, repeated) is kept as it is but carries the reason. A normal or
 * unknown day, a past session or a session on another day are returned unchanged.
 */
export function adjustSessionForReadiness(
  session: LiveSession,
  readiness: Readiness,
  today: string,
): LiveSession {
  const headline = readinessHeadline(readiness);
  if (headline === null || readiness.level === 'normal' || readiness.level === 'unknown') {
    return session;
  }
  if (session.mode !== 'live' || session.localDate !== today) return session;
  const level = readiness.level;

  const noCut: SessionReadiness = { level, headline, removedSets: [], removedExercise: null };
  if (session.inputMethod !== 'program') return { ...session, readiness: noCut };

  const cut = sessionCut(
    session.exercises.map((e) => e.sets.length),
    level,
  );
  const lastIndex = session.exercises.length - 1;
  const removedExercise = cut.exercise
    ? { index: lastIndex, exercise: session.exercises[lastIndex]! }
    : null;
  const kept = cut.exercise ? session.exercises.slice(0, -1) : session.exercises;

  const removedSets: SessionReadiness['removedSets'] = [];
  const exercises = kept.map((exercise) => {
    if (!cut.sets || exercise.sets.length <= READINESS_RULES.minSetsPerExercise) return exercise;
    removedSets.push({ exerciseUid: exercise.uid, sets: exercise.sets.slice(-1) });
    return { ...exercise, sets: exercise.sets.slice(0, -1) };
  });

  return { ...session, exercises, readiness: { level, headline, removedSets, removedExercise } };
}

/** Whether the banner offers "Entrenar normal": something was removed (AC8). */
export function canTrainNormally(session: LiveSession): boolean {
  const readiness = session.readiness;
  return !!readiness && (readiness.removedSets.length > 0 || readiness.removedExercise !== null);
}

/**
 * "Entrenar normal" (AC8): the removed sets go back at the end of their exercise (the sets done or
 * added meanwhile stay), the removed exercise goes back to its place, and the line is hidden. An
 * exercise the user removed meanwhile stays removed.
 */
export function restoreSessionVolume(session: LiveSession): LiveSession {
  const readiness = session.readiness;
  if (!readiness) return session;
  const exercises = session.exercises.map((exercise) => {
    const removed = readiness.removedSets.find((r) => r.exerciseUid === exercise.uid);
    return removed ? { ...exercise, sets: [...exercise.sets, ...removed.sets] } : exercise;
  });
  const back = readiness.removedExercise;
  if (back && !exercises.some((e) => e.uid === back.exercise.uid)) {
    exercises.splice(Math.min(back.index, exercises.length), 0, back.exercise);
  }
  return { ...session, exercises, readiness: null };
}
