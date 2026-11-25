import type {
  DailyCheckin,
  PlannedWorkout,
  Program,
  ProgramSession,
  Readiness,
  ReadinessLevel,
  ReadinessReason,
  Workout,
} from '@pt/contracts';
import { daysBetween } from '../dates';
import { pendingPlannedWorkouts, resolvePlannedSession, sortPlannedSessions } from '../plan/status';
import { latestPerDay } from './checkin';

/**
 * The day's readiness (spec 011 AC6–AC9, AC13), computed on the device from the check-in and the
 * usual sleep, so it works offline. It only ever removes volume: a good night never adds anything
 * (Safety "Never more"). Every threshold is PROVISIONAL until the professional review.
 */
export const READINESS_RULES = {
  /** Under this, sleep is "very short" (the "Menos de 5 h" chip). */
  veryShortSleepMinutes: 300,
  /** Under this, sleep is "short" (the "5–6 h" chip). */
  shortSleepMinutes: 360,
  /** Sleep this far under the usual sleep lowers the readiness. */
  belowUsualMinutes: 90,
  /** The routine adjustment never leaves an exercise under this many sets (Safety). */
  minSetsPerExercise: 2,
  /** …nor a session under this many exercises (Safety). */
  minExercises: 4,
  /** Pattern notice (AC13): short nights out of the last 7 days. */
  patternShortNights: 4,
  /** Pattern notice (AC13): high-stress days out of the last 7 days. */
  patternHighStressDays: 5,
  patternDays: 7,
} as const;

type SleepAndStress = Pick<DailyCheckin, 'sleepMinutes' | 'stress'>;

const REASON_ORDER: readonly ReadinessReason[] = [
  'very_short_sleep',
  'short_sleep',
  'below_usual_sleep',
  'high_stress',
];

export function dayReadiness(
  checkin: SleepAndStress | null,
  usualSleepMinutes: number | null,
): Readiness {
  if (!checkin || (checkin.sleepMinutes === null && checkin.stress === null)) {
    return { level: 'unknown', reasons: [] };
  }
  const sleep = checkin.sleepMinutes;
  const fired = new Set<ReadinessReason>();
  if (sleep !== null && sleep < READINESS_RULES.veryShortSleepMinutes)
    fired.add('very_short_sleep');
  else if (sleep !== null && sleep < READINESS_RULES.shortSleepMinutes) fired.add('short_sleep');
  if (
    sleep !== null &&
    usualSleepMinutes !== null &&
    usualSleepMinutes - sleep >= READINESS_RULES.belowUsualMinutes
  ) {
    fired.add('below_usual_sleep');
  }
  if (checkin.stress === 'high') fired.add('high_stress');

  const reasons = REASON_ORDER.filter((r) => fired.has(r));
  const low =
    fired.has('very_short_sleep') || (fired.has('short_sleep') && fired.has('high_stress'));
  const level: ReadinessLevel = low ? 'low' : reasons.length > 0 ? 'reduced' : 'normal';
  return { level, reasons };
}

/** The one reason a line shows (decision c of spec 011). */
export type ReadinessHeadline =
  | 'very_short_sleep'
  | 'short_sleep_high_stress'
  | 'short_sleep'
  | 'below_usual_sleep'
  | 'high_stress';

export function readinessHeadline(readiness: Readiness): ReadinessHeadline | null {
  const has = (reason: ReadinessReason) => readiness.reasons.includes(reason);
  if (readiness.level !== 'reduced' && readiness.level !== 'low') return null;
  if (has('very_short_sleep')) return 'very_short_sleep';
  if (has('short_sleep')) return has('high_stress') ? 'short_sleep_high_stress' : 'short_sleep';
  if (has('below_usual_sleep')) return 'below_usual_sleep';
  return has('high_stress') ? 'high_stress' : null;
}

/** What the adjustment removes from a routine session (AC7). */
export interface SessionCut {
  /** One set from every exercise with 3 or more. */
  sets: boolean;
  /** The last exercise (low days, more than 4 exercises). */
  exercise: boolean;
}

/** `setCounts`: the sets of each exercise, in session order. */
export function sessionCut(setCounts: readonly number[], level: ReadinessLevel): SessionCut {
  if (level !== 'reduced' && level !== 'low') return { sets: false, exercise: false };
  const exercise = level === 'low' && setCounts.length > READINESS_RULES.minExercises;
  const kept = exercise ? setCounts.slice(0, -1) : setCounts;
  return {
    sets: kept.some((sets) => sets > READINESS_RULES.minSetsPerExercise),
    exercise,
  };
}

/**
 * A routine session as the live session will start it (`sessionFromProgram` leaves out the exercises
 * that lost their catalog entry), so the line says what the adjustment will really remove.
 */
export function readinessPlanSession(session: Pick<ProgramSession, 'exercises'>): {
  exercises: { sets: number }[];
} {
  return {
    exercises: session.exercises
      .filter((e) => e.exerciseId !== null)
      .map((e) => ({ sets: e.sets })),
  };
}

/** Today's plan as the readiness line needs it. */
export interface ReadinessPlan {
  /** The routine session due today (spec 010 AC17), or null. */
  session: { exercises: readonly { sets: number }[] } | null;
  /** The activities planned today; `isMatch` when today is a match (spec 010 AC2). */
  activities: readonly { isMatch: boolean }[];
}

/**
 * Today's plan when the weekly planner has sessions for today (spec 013 AC15): the pending planned
 * routine session is today's session (the readiness adjusts it exactly as the rotation's), the pending
 * planned activities count with their match, and a pending free or repeated gym session counts as
 * training without a session to cut. What was already done today is left out. Without planned
 * sessions today, `base` (the rotation and the typical week, spec 010 AC17) is kept.
 */
export function withTodayPlan(
  base: ReadinessPlan,
  input: {
    today: string;
    planned: readonly PlannedWorkout[];
    workouts: readonly Pick<Workout, 'plannedWorkoutId'>[];
    program: Pick<Program, 'sessions'> | null;
  },
): ReadinessPlan {
  const ofToday = input.planned.filter((p) => p.localDate === input.today);
  if (ofToday.length === 0) return base;
  let session: ReadinessPlan['session'] = null;
  const activities: { isMatch: boolean }[] = [];
  for (const planned of sortPlannedSessions(pendingPlannedWorkouts(ofToday, input.workouts))) {
    const start = resolvePlannedSession(planned, input.program);
    if (start.type === 'program' && session === null) {
      session = readinessPlanSession(start.session);
    } else {
      activities.push({ isMatch: planned.isMatch });
    }
  }
  return { session, activities };
}

/**
 * The line on Today once the check-in is saved (AC4, AC9), as keys for the copy:
 * - `checkin`: "Check-in de hoy · Cambiar" (unknown readiness, a normal day without training, or a
 *   normal day without a sleep answer: stress alone does not say all is fine);
 * - `ready`: "Todo en orden para entrenar";
 * - `routine`: the reason and what the routine session loses;
 * - `activity`: the reason and "Hoy, mejor a ritmo suave" (or the match warm-up line);
 * - `reason`: only the reason (nothing planned, or nothing to remove).
 */
export type ReadinessLine =
  | { type: 'checkin' }
  | { type: 'ready' }
  | { type: 'routine'; headline: ReadinessHeadline; cut: SessionCut }
  | { type: 'activity'; headline: ReadinessHeadline; match: boolean }
  | { type: 'reason'; headline: ReadinessHeadline };

export function readinessLine(
  readiness: Readiness,
  plan: ReadinessPlan,
  /** Whether the check-in has a sleep answer. */
  sleepAnswered: boolean,
): ReadinessLine {
  const trains = plan.session !== null || plan.activities.length > 0;
  const headline = readinessHeadline(readiness);
  if (headline === null) {
    return readiness.level === 'normal' && trains && sleepAnswered
      ? { type: 'ready' }
      : { type: 'checkin' };
  }
  if (plan.session) {
    const cut = sessionCut(
      plan.session.exercises.map((e) => e.sets),
      readiness.level,
    );
    if (cut.sets || cut.exercise) return { type: 'routine', headline, cut };
    return { type: 'reason', headline };
  }
  if (plan.activities.length > 0) {
    return { type: 'activity', headline, match: plan.activities.some((a) => a.isMatch) };
  }
  return { type: 'reason', headline };
}

/**
 * The quiet pattern notice (AC13): sleep under 6 h on 4 of the last 7 days, or high stress on 5 of
 * them, today included. Sleep first when both fire. It never names a condition.
 */
export function sleepStressNotice(
  checkins: readonly (SleepAndStress & Pick<DailyCheckin, 'localDate'> & { recordedAt?: string })[],
  today: string,
): 'short_sleep' | 'high_stress' | null {
  const recent = latestPerDay(checkins).filter((c) => {
    const age = daysBetween(c.localDate, today);
    return age >= 0 && age < READINESS_RULES.patternDays;
  });
  const shortNights = recent.filter(
    (c) => c.sleepMinutes !== null && c.sleepMinutes < READINESS_RULES.shortSleepMinutes,
  ).length;
  if (shortNights >= READINESS_RULES.patternShortNights) return 'short_sleep';
  const stressDays = recent.filter((c) => c.stress === 'high').length;
  return stressDays >= READINESS_RULES.patternHighStressDays ? 'high_stress' : null;
}
